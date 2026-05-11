"use server"

/**
 * Phase I — engagement workflow server actions.
 *
 *   draftEngagementLetter   — create or update the markdown body + signer info
 *   markEngagementSigned    — flip signatureStatus to SIGNED (CPA or client)
 *   generate8879            — build the Form 8879 row from locked Schedule C totals
 *   markForm8879Signed      — flip signature status, store PINs
 *   recordFilingMilestone   — append-only filing-lifecycle event
 */

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { randomBytes } from "node:crypto"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { Prisma } from "@/app/generated/prisma/client"
import { ENGAGEMENT_DEFAULT_BODY } from "@/lib/reports/pdf/engagement"
import { inYearWindow } from "@/lib/queries/yearWindow"

async function resolveTaxYear(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  if (!taxYear) throw new Error("Tax year not found")
  return { taxYear, userId }
}

const DraftEngagementSchema = z.object({
  year: z.number().int(),
  bodyMarkdown: z.string().min(50),
  clientName: z.string().min(1),
  clientEmail: z.string().email(),
})

export async function draftEngagementLetter(
  input: z.infer<typeof DraftEngagementSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = DraftEngagementSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const { year, bodyMarkdown, clientName, clientEmail } = parsed.data
  const { taxYear, userId } = await resolveTaxYear(year)

  await prisma.$transaction(async (tx) => {
    await tx.engagementLetter.upsert({
      where: { taxYearId: taxYear.id },
      create: {
        taxYearId: taxYear.id,
        bodyMarkdown,
        cpaUserId: userId,
        clientName,
        clientEmail,
        signatureStatus: "NOT_REQUESTED",
      },
      update: {
        bodyMarkdown,
        clientName,
        clientEmail,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: "ENGAGEMENT_DRAFTED",
        entityType: "EngagementLetter",
        entityId: taxYear.id,
        afterState: { clientName, clientEmail, bodyLen: bodyMarkdown.length },
      },
    })
  })
  revalidatePath(`/years/${year}/engagement`)
  return { ok: true }
}

export async function defaultEngagementBody(year: number): Promise<string> {
  const { taxYear } = await resolveTaxYear(year)
  return ENGAGEMENT_DEFAULT_BODY(year, taxYear.user.name ?? taxYear.user.email)
}

export async function requestEngagementSignature(
  year: number,
): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const { taxYear } = await resolveTaxYear(year)
  const existing = await prisma.engagementLetter.findUnique({
    where: { taxYearId: taxYear.id },
  })
  if (!existing) return { ok: false, error: "Draft the letter first" }
  const token = randomBytes(24).toString("base64url")
  await prisma.engagementLetter.update({
    where: { taxYearId: taxYear.id },
    data: { signatureStatus: "REQUESTED", signatureToken: token },
  })
  await prisma.auditEvent.create({
    data: {
      userId: taxYear.userId,
      actorType: "USER",
      eventType: "ENGAGEMENT_SIGNATURE_REQUESTED",
      entityType: "EngagementLetter",
      entityId: taxYear.id,
      afterState: { token: token.slice(0, 8) + "…" },
    },
  })
  revalidatePath(`/years/${year}/engagement`)
  return { ok: true, token }
}

export async function markEngagementSigned(
  year: number,
  who: "CPA" | "CLIENT",
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { taxYear } = await resolveTaxYear(year)
  const existing = await prisma.engagementLetter.findUnique({
    where: { taxYearId: taxYear.id },
  })
  if (!existing) return { ok: false, error: "No engagement letter on file" }

  await prisma.$transaction(async (tx) => {
    await tx.engagementLetter.update({
      where: { taxYearId: taxYear.id },
      data: {
        cpaSignedAt: who === "CPA" ? new Date() : existing.cpaSignedAt,
        clientSignedAt: who === "CLIENT" ? new Date() : existing.clientSignedAt,
        signatureStatus:
          who === "CLIENT" ? "SIGNED" : existing.signatureStatus === "REQUESTED" ? "REQUESTED" : "REQUESTED",
      },
    })
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: who === "CPA" ? "ENGAGEMENT_CPA_SIGNED" : "ENGAGEMENT_CLIENT_SIGNED",
        entityType: "EngagementLetter",
        entityId: taxYear.id,
      },
    })
    if (who === "CLIENT") {
      // Cascade: client signing also records a FilingMilestone
      await tx.filingMilestone.create({
        data: {
          taxYearId: taxYear.id,
          status: "ENGAGEMENT_SIGNED",
          recordedBy: taxYear.userId,
        },
      })
    }
  })
  revalidatePath(`/years/${year}/engagement`)
  revalidatePath(`/years/${year}/finalize`)
  return { ok: true }
}

const Generate8879Schema = z.object({
  year: z.number().int(),
  taxableIncome: z.number(),
  totalTax: z.number().min(0),
  refundOrDue: z.number(),
  eroPin: z
    .string()
    .regex(/^\d{5}$/, "ERO PIN must be 5 digits")
    .optional()
    .nullable(),
  taxpayerPin: z
    .string()
    .regex(/^\d{5}$/, "Taxpayer PIN must be 5 digits")
    .refine((v) => v !== "00000", "Taxpayer PIN cannot be all zeros (Pub 1345)")
    .optional()
    .nullable(),
})

export async function generate8879(
  input: z.infer<typeof Generate8879Schema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = Generate8879Schema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const { year, taxableIncome, totalTax, refundOrDue, eroPin, taxpayerPin } = parsed.data
  const { taxYear } = await resolveTaxYear(year)

  // Aggregate income from locked ledger to populate Form 8879 Part I
  const txns = await prisma.transaction.findMany({
    where: { taxYearId: taxYear.id, isSplit: false, isStale: false, ...inYearWindow(year) },
    select: {
      amountNormalized: true,
      classifications: { where: { isCurrent: true }, take: 1, select: { code: true } },
    },
  })
  let totalIncome = 0
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    if (c.code === "BIZ_INCOME") totalIncome += Math.abs(Number(t.amountNormalized.toString()))
  }

  await prisma.$transaction(async (tx) => {
    await tx.form8879.upsert({
      where: { taxYearId: taxYear.id },
      create: {
        taxYearId: taxYear.id,
        totalIncomeUsd: new Prisma.Decimal(totalIncome),
        taxableIncomeUsd: new Prisma.Decimal(taxableIncome),
        totalTaxUsd: new Prisma.Decimal(totalTax),
        refundOrAmtDue: new Prisma.Decimal(refundOrDue),
        eroPin: eroPin ?? null,
        taxpayerPin: taxpayerPin ?? null,
        signatureStatus: "NOT_REQUESTED",
      },
      update: {
        totalIncomeUsd: new Prisma.Decimal(totalIncome),
        taxableIncomeUsd: new Prisma.Decimal(taxableIncome),
        totalTaxUsd: new Prisma.Decimal(totalTax),
        refundOrAmtDue: new Prisma.Decimal(refundOrDue),
        eroPin: eroPin ?? null,
        taxpayerPin: taxpayerPin ?? null,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: "FORM_8879_GENERATED",
        entityType: "Form8879",
        entityId: taxYear.id,
        afterState: { totalIncome, taxableIncome, totalTax, refundOrDue },
      },
    })
  })
  revalidatePath(`/years/${year}/engagement`)
  return { ok: true }
}

export async function markForm8879Signed(
  year: number,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { taxYear } = await resolveTaxYear(year)
  const f = await prisma.form8879.findUnique({ where: { taxYearId: taxYear.id } })
  if (!f) return { ok: false, error: "Generate Form 8879 first" }
  await prisma.$transaction(async (tx) => {
    await tx.form8879.update({
      where: { taxYearId: taxYear.id },
      data: { signatureStatus: "SIGNED", signedAt: new Date() },
    })
    await tx.filingMilestone.create({
      data: {
        taxYearId: taxYear.id,
        status: "TAXPAYER_8879_SIGNED",
        recordedBy: taxYear.userId,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: "FORM_8879_SIGNED",
        entityType: "Form8879",
        entityId: taxYear.id,
      },
    })
  })
  revalidatePath(`/years/${year}/engagement`)
  revalidatePath(`/years/${year}/finalize`)
  return { ok: true }
}

const FilingMilestoneSchema = z.object({
  year: z.number().int(),
  status: z.enum([
    "EFILED",
    "ACCEPTED_BY_IRS",
    "REJECTED_BY_IRS",
    "PAPER_FILED",
    "REFUND_RECEIVED",
    "BALANCE_PAID",
  ]),
  notes: z.string().optional().nullable(),
  externalRef: z.string().optional().nullable(),
})

export async function recordFilingMilestone(
  input: z.infer<typeof FilingMilestoneSchema>,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = FilingMilestoneSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const { year, status, notes, externalRef } = parsed.data
  const { taxYear } = await resolveTaxYear(year)
  await prisma.$transaction(async (tx) => {
    await tx.filingMilestone.create({
      data: {
        taxYearId: taxYear.id,
        status,
        notes: notes ?? null,
        externalRef: externalRef ?? null,
        recordedBy: taxYear.userId,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: "FILING_MILESTONE_RECORDED",
        entityType: "TaxYear",
        entityId: taxYear.id,
        afterState: { status, notes, externalRef },
      },
    })
  })
  revalidatePath(`/years/${year}/engagement`)
  revalidatePath(`/years/${year}/finalize`)
  return { ok: true }
}
