"use server"

import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { runLockAssertions, type AssertionRunResult } from "@/lib/validation/assertions"
import { computeRiskScore, type RiskReport } from "@/lib/risk/score"
import { computeLedgerHash } from "@/lib/lock/hash"

export interface LockAttemptResult {
  blocked: boolean
  reasons: string[]
  assertions: AssertionRunResult
  risk: RiskReport
}

async function resolveTaxYear(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({ where: { userId_year: { userId, year } } })
  if (!taxYear) throw new Error("TaxYear not found")
  return { taxYear, userId }
}

export async function attemptLock(year: number): Promise<LockAttemptResult> {
  const { taxYear } = await resolveTaxYear(year)

  const [assertions, risk] = await Promise.all([
    runLockAssertions(taxYear.id),
    computeRiskScore(taxYear.id),
  ])

  const reasons: string[] = []
  for (const f of assertions.blockingFailures) reasons.push(`[${f.id}] ${f.name} — ${f.details}`)
  for (const c of risk.critical) if (c.blocking) reasons.push(`[CRITICAL] ${c.title} — ${c.details}`)

  return { blocked: reasons.length > 0, reasons, assertions, risk }
}

export async function confirmLock(year: number): Promise<void> {
  const { taxYear, userId } = await resolveTaxYear(year)
  if (taxYear.status === "LOCKED") throw new Error("Tax year already locked")

  const result = await attemptLock(year)
  if (result.blocked) {
    throw new Error(`Lock blocked: ${result.reasons.join("; ")}`)
  }

  const hash = await computeLedgerHash(taxYear.id)

  await prisma.$transaction(async (tx) => {
    await tx.taxYear.update({
      where: { id: taxYear.id },
      data: {
        status: "LOCKED",
        lockedAt: new Date(),
        lockedSnapshotHash: hash,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "TAXYEAR_LOCKED",
        entityType: "TaxYear",
        entityId: taxYear.id,
        afterState: {
          hash,
          score: result.risk.score,
          band: result.risk.band,
          estimatedDeductions: result.risk.estimatedDeductions,
        },
      },
    })
  })

  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/lock`)
  revalidatePath(`/years/${year}/risk`)
  redirect(`/years/${year}/lock`)
}

export async function unlockTaxYear(year: number, rationale: string): Promise<void> {
  const { taxYear, userId } = await resolveTaxYear(year)
  if (taxYear.status !== "LOCKED") throw new Error("Tax year is not locked")
  if (!rationale || rationale.trim().length < 10) {
    throw new Error("Unlock rationale required (minimum 10 characters)")
  }

  await prisma.$transaction(async (tx) => {
    await tx.taxYear.update({
      where: { id: taxYear.id },
      data: { status: "REVIEW" },
    })
    await tx.report.updateMany({
      where: { taxYearId: taxYear.id, isCurrent: true },
      data: { isCurrent: false },
    })
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "TAXYEAR_UNLOCKED",
        entityType: "TaxYear",
        entityId: taxYear.id,
        rationale: rationale.trim(),
        beforeState: { priorHash: taxYear.lockedSnapshotHash },
      },
    })
  })

  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/lock`)
}
