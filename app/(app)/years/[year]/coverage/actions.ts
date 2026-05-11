"use server"

/**
 * Coverage page server actions — attest an account-month as inactive
 * (so A14 stops flagging it as a gap), and clear an attestation.
 */

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

const AttestSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  accountId: z.string().min(1),
  month: z.number().int().min(1).max(12),
  reason: z.string().min(10, "Reason must be at least 10 characters").max(500),
})

export type AttestInactiveMonthResult =
  | { ok: true }
  | { ok: false; error: string }

export async function attestInactiveMonth(
  input: z.infer<typeof AttestSchema>,
): Promise<AttestInactiveMonthResult> {
  const userId = await getCurrentUserId()
  const parsed = AttestSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const { year, accountId, month, reason } = parsed.data

  // Resolve the account → tax year (the year on the account record may not
  // match the URL year; we use the URL year as the source of truth).
  const account = await prisma.financialAccount.findUnique({
    where: { id: accountId },
    select: { id: true, userId: true, taxYearId: true, institution: true, nickname: true, mask: true },
  })
  if (!account) return { ok: false, error: "Account not found" }

  // Find the TaxYear matching the URL year for the account's owner.
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId: account.userId, year } },
    select: { id: true, status: true },
  })
  if (!taxYear) return { ok: false, error: "Tax year not found" }
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }

  await prisma.$transaction(async (tx) => {
    // Idempotent upsert: same (account, year, month) → update reason+timestamp.
    await tx.accountInactiveMonth.upsert({
      where: { accountId_year_month: { accountId, year, month } },
      create: {
        accountId,
        taxYearId: taxYear.id,
        year,
        month,
        reason: reason.trim(),
        attestedBy: userId,
      },
      update: {
        reason: reason.trim(),
        attestedBy: userId,
        attestedAt: new Date(),
      },
    })
    await tx.auditEvent.create({
      data: {
        userId: account.userId,
        actorType: "USER",
        eventType: "ACCOUNT_MONTH_ATTESTED_INACTIVE",
        entityType: "FinancialAccount",
        entityId: accountId,
        rationale: reason.trim(),
        afterState: { year, month, accountInstitution: account.institution },
      },
    })
  })

  revalidatePath(`/years/${year}/coverage`)
  revalidatePath(`/years/${year}/risk`)
  revalidatePath(`/years/${year}/finalize`)
  return { ok: true }
}

const ClearSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  accountId: z.string().min(1),
  month: z.number().int().min(1).max(12),
})

export async function clearInactiveAttestation(
  input: z.infer<typeof ClearSchema>,
): Promise<AttestInactiveMonthResult> {
  const userId = await getCurrentUserId()
  const parsed = ClearSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const { year, accountId, month } = parsed.data

  const account = await prisma.financialAccount.findUnique({
    where: { id: accountId },
    select: { userId: true, institution: true },
  })
  if (!account) return { ok: false, error: "Account not found" }

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId: account.userId, year } },
    select: { id: true, status: true },
  })
  if (!taxYear) return { ok: false, error: "Tax year not found" }
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }

  await prisma.$transaction(async (tx) => {
    const existing = await tx.accountInactiveMonth.findUnique({
      where: { accountId_year_month: { accountId, year, month } },
    })
    if (!existing) return
    await tx.accountInactiveMonth.delete({
      where: { accountId_year_month: { accountId, year, month } },
    })
    await tx.auditEvent.create({
      data: {
        userId: account.userId,
        actorType: "USER",
        eventType: "ACCOUNT_MONTH_INACTIVE_CLEARED",
        entityType: "FinancialAccount",
        entityId: accountId,
        beforeState: { year, month, reason: existing.reason },
      },
    })
  })

  revalidatePath(`/years/${year}/coverage`)
  revalidatePath(`/years/${year}/risk`)
  revalidatePath(`/years/${year}/finalize`)
  return { ok: true }
}
