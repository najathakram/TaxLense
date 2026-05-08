import { prisma } from "@/lib/db"
import type { TaxYearStatus } from "@/app/generated/prisma/client"

export interface YearCounts {
  totalTx: number
  classifiedTx: number
  pendingStops: number
}

export interface DeriveStageInput {
  status: TaxYearStatus
  lockedAt: Date | null
}

/**
 * Pure stage derivation — given a tax year and its row counts, return the
 * stage the user is actually in. Used by the status chip everywhere; never
 * mutates state on its own (see recomputeStatus for the writeback).
 *
 * Stages map onto the existing TaxYearStatus enum:
 *   CREATED         — opened but no uploads yet
 *   INGESTION       — uploads have begun, no classifications yet
 *   CLASSIFICATION  — classification in progress (some rows classified)
 *   REVIEW          — every row classified AND no pending STOPs (lock-ready)
 *   LOCKED          — terminal, set by the lock action
 *   ARCHIVED        — terminal, set elsewhere; never auto-derived
 */
export function deriveStage(
  year: DeriveStageInput,
  counts: YearCounts,
): TaxYearStatus {
  if (year.lockedAt || year.status === "LOCKED") return "LOCKED"
  if (year.status === "ARCHIVED") return "ARCHIVED"

  if (counts.totalTx === 0) {
    return year.status === "CREATED" ? "CREATED" : "INGESTION"
  }

  if (counts.classifiedTx >= counts.totalTx && counts.pendingStops === 0) {
    return "REVIEW"
  }

  if (counts.classifiedTx > 0 || counts.pendingStops > 0) return "CLASSIFICATION"
  return "INGESTION"
}

/**
 * Three counts that drive every pipeline-stage decision. Matches the
 * denominators already used in app/(app)/years/[year]/pipeline/page.tsx so the
 * stat cards there and the derived stage agree on what "classified" means.
 */
export async function getYearCounts(taxYearId: string): Promise<YearCounts> {
  const [totalTx, classifiedTx, pendingStops] = await Promise.all([
    prisma.transaction.count({
      where: { taxYearId, isDuplicateOf: null },
    }),
    prisma.classification.count({
      where: {
        transaction: { taxYearId, isDuplicateOf: null },
        isCurrent: true,
      },
    }),
    prisma.stopItem.count({
      where: { taxYearId, state: "PENDING" },
    }),
  ])
  return { totalTx, classifiedTx, pendingStops }
}

export interface RecomputeResult {
  previous: TaxYearStatus
  current: TaxYearStatus
  changed: boolean
}

/**
 * Read counts + status, compute the derived stage, write back if it changed.
 * Cheap and idempotent — safe to call at the end of every server action that
 * mutates transactions, classifications, or stops. LOCKED / ARCHIVED short-
 * circuit so we never demote a finalized year.
 */
export async function recomputeStatus(
  taxYearId: string,
): Promise<RecomputeResult | null> {
  const year = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { status: true, lockedAt: true },
  })
  if (!year) return null

  if (year.status === "LOCKED" || year.status === "ARCHIVED") {
    return { previous: year.status, current: year.status, changed: false }
  }

  const counts = await getYearCounts(taxYearId)
  const next = deriveStage(year, counts)

  if (next === year.status) {
    return { previous: year.status, current: next, changed: false }
  }

  await prisma.taxYear.update({
    where: { id: taxYearId },
    data: { status: next },
  })

  return { previous: year.status, current: next, changed: true }
}
