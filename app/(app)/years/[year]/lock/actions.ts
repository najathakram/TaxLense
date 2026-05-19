"use server"

import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { runLockAssertions, type AssertionRunResult } from "@/lib/validation/assertions"
import { computeRiskScore, type RiskReport } from "@/lib/risk/score"
import { computeLedgerHash } from "@/lib/lock/hash"
import { recomputeStatus } from "@/lib/taxYear/status"
import { maybePopulateCarryforwardOnLock } from "@/lib/carryforward/compute"
import {
  runRelockVerify,
  computePerLineTotals,
  DriftApprovalRequiredError,
  type RelockDriftReport,
} from "@/lib/lock/relockVerify"

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

/**
 * Confirm lock — supports an optional `driftAck` arg for re-locks where the
 * drift verifier requested user approval. When provided, RELOCK_VERIFY is
 * skipped (the user has already acknowledged via the dialog). When omitted
 * and a prior lock exists, RELOCK_VERIFY runs and may throw
 * `DriftApprovalRequiredError` — the UI catches that and surfaces the dialog.
 */
export async function confirmLock(
  year: number,
  options: { driftAck?: string } = {}
): Promise<void> {
  const { taxYear, userId } = await resolveTaxYear(year)
  if (taxYear.status === "LOCKED") throw new Error("Tax year already locked")

  const result = await attemptLock(year)
  if (result.blocked) {
    throw new Error(`Lock blocked: ${result.reasons.join("; ")}`)
  }

  // Auto-CPA: RELOCK_VERIFY drift check when a prior lock exists and the
  // user hasn't already acked. Non-blocking on first lock.
  let driftReport: RelockDriftReport | null = null
  const lastUnlock = await prisma.auditEvent.findFirst({
    where: { entityType: "TaxYear", entityId: taxYear.id, eventType: "TAXYEAR_UNLOCKED" },
    orderBy: { occurredAt: "desc" },
    select: { rationale: true },
  })
  try {
    driftReport = await runRelockVerify(taxYear.id, {
      unlockRationale: lastUnlock?.rationale ?? null,
    })
    if (driftReport.hasPriorLock && driftReport.approvalRequired && !options.driftAck) {
      throw new DriftApprovalRequiredError(driftReport)
    }
  } catch (err) {
    if (err instanceof DriftApprovalRequiredError) throw err
    // Non-DriftApproval errors are non-blocking — log and continue.
    console.error("[confirmLock] RELOCK_VERIFY error (non-blocking):", err)
  }

  const hash = await computeLedgerHash(taxYear.id)
  const perLineSnapshot = await computePerLineTotals(taxYear.id)

  // Phase 5.3 / leftover-fix: when re-locking after an unlock, chain to the
  // previous locked snapshot. The prior TAXYEAR_LOCKED event is the most
  // recent lock event for this year. Capturing parentLockedHash makes the
  // re-lock chain explicit so the LockHistory panel can render
  // 'v1 → unlock → v2 → unlock → v3' lineage.
  const priorLock = await prisma.auditEvent.findFirst({
    where: {
      entityType: "TaxYear",
      entityId: taxYear.id,
      eventType: "TAXYEAR_LOCKED",
    },
    orderBy: { occurredAt: "desc" },
    select: { afterState: true },
  })
  const parentLockedHash =
    priorLock && priorLock.afterState
      ? ((priorLock.afterState as { hash?: string }).hash ?? null)
      : null

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
          parentLockedHash, // chain link for LockHistory panel
          // Auto-CPA: persist per-line totals + gross receipts so the next
          // re-lock's RELOCK_VERIFY can compute drift without reconstructing
          // the locked ledger from the audit chain.
          perLineTotals: perLineSnapshot.perLineTotals,
          grossReceipts: perLineSnapshot.grossReceipts,
          driftAck: options.driftAck ?? null,
        },
      },
    })
    if (options.driftAck && driftReport) {
      await tx.auditEvent.create({
        data: {
          userId,
          actorType: "USER",
          eventType: "RELOCK_DRIFT_APPROVED",
          entityType: "TaxYear",
          entityId: taxYear.id,
          rationale: options.driftAck,
          afterState: {
            grossReceiptsDriftPct: driftReport.grossReceiptsDriftPct,
            totalDeductionsDriftPct: driftReport.totalDeductionsDriftPct,
            highDriftLines: driftReport.perLineDrift
              .filter((d) => d.severity === "HIGH")
              .map((d) => d.line),
          },
        },
      })
    }
  })

  // Phase G: if the next year already exists for this taxpayer, populate
  // its PriorYearContext from the now-locked snapshot. Best-effort; failure
  // is logged but doesn't roll back the lock.
  await maybePopulateCarryforwardOnLock(taxYear.id).catch((e) => {
    console.error("[confirmLock] carryforward propagation failed:", e)
  })

  // Auto-CPA framework: auto-generate every position memo the system flags
  // as needed (§183, §274(n)(2), §280A, wardrobe, and the new §162 Cohan
  // sweep memo). Failure is non-blocking — the user sees the partial set in
  // /memos and can retry generation there.
  try {
    const { generateAllPositionMemos } = await import("@/lib/ai/positionMemo")
    await generateAllPositionMemos(taxYear.id)
  } catch (e) {
    console.error("[confirmLock] position-memo auto-generation failed:", e)
  }

  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/finalize`)
  revalidatePath(`/years/${year}/risk`)
  redirect(`/years/${year}/finalize#lock`)
}

/**
 * B-23: muting a non-blocking risk signal (e.g. INCOME_SHORT — gross
 * receipts came in under expected because of currency conversion or a gig
 * cancellation). Records the user's rationale on TaxYear.acceptedRiskOverrides
 * and writes an AuditEvent. Idempotent: re-confirming overwrites the
 * stored note. Use clearRiskOverride to revert.
 */
export async function confirmRiskOverride(
  year: number,
  signalId: string,
  rationale: string,
): Promise<void> {
  const { taxYear, userId } = await resolveTaxYear(year)
  if (!signalId.trim()) throw new Error("signalId required")
  if (!rationale || rationale.trim().length < 10) {
    throw new Error("Override rationale required (minimum 10 characters)")
  }

  const current = (taxYear.acceptedRiskOverrides as Record<string, unknown> | null) ?? {}
  const next = { ...current, [signalId]: true, [`${signalId}_rationale`]: rationale.trim() }

  await prisma.$transaction(async (tx) => {
    await tx.taxYear.update({
      where: { id: taxYear.id },
      data: { acceptedRiskOverrides: next as never },
    })
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "RISK_OVERRIDE_CONFIRMED",
        entityType: "TaxYear",
        entityId: taxYear.id,
        rationale: rationale.trim(),
        afterState: { signalId },
      },
    })
  })

  revalidatePath(`/years/${year}/risk`)
  revalidatePath(`/years/${year}/finalize`)
}

export async function clearRiskOverride(year: number, signalId: string): Promise<void> {
  const { taxYear, userId } = await resolveTaxYear(year)
  const current = (taxYear.acceptedRiskOverrides as Record<string, unknown> | null) ?? {}
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { [signalId]: _, [`${signalId}_rationale`]: __, ...rest } = current

  await prisma.$transaction(async (tx) => {
    await tx.taxYear.update({
      where: { id: taxYear.id },
      data: { acceptedRiskOverrides: rest as never },
    })
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "RISK_OVERRIDE_CLEARED",
        entityType: "TaxYear",
        entityId: taxYear.id,
        afterState: { signalId },
      },
    })
  })

  revalidatePath(`/years/${year}/risk`)
  revalidatePath(`/years/${year}/finalize`)
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
      data: { status: "REVIEW", lockedAt: null, lockedSnapshotHash: null },
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

  // After unlock the seeded REVIEW value may not match reality (e.g. user
  // unlocks to fix a row, which will re-create a STOP and demote to
  // CLASSIFICATION). Reconcile to whatever the counts actually say.
  await recomputeStatus(taxYear.id)

  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/finalize`)
}
