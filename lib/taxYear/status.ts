import { prisma } from "@/lib/db"
import type { TaxYearStatus } from "@/app/generated/prisma/client"
import { inYearWindow } from "@/lib/queries/yearWindow"

export interface YearCounts {
  totalTx: number
  classifiedTx: number
  pendingStops: number
  /** Rows the canonical filter excludes (out-of-year, stale, split-parents,
   *  duplicates). Optional so tests using minimal fixtures still type-check.
   *  Useful for a debug breakdown when a CPA asks why "536 transactions"
   *  turned into "485 on the ledger". */
  hiddenTx?: number
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
 * Canonical year-state counts. **Single source of truth** for "how many
 * transactions / classifications does this year have?" — every status pill,
 * stat card, and derived stage routes through here.
 *
 * Filter rationale (the "ledger filter"):
 *   isDuplicateOf == null   exclude duplicate rows that the de-dupe pass merged
 *   isSplit       == false  split parents are represented by their children
 *   isStale       == false  parser re-extraction superseded these rows
 *   inYearWindow  == true   posted-date inside the tax year (handles fiscal
 *                            edges and statement-cut-off carryovers)
 *
 * This matches what `/years/[year]/ledger`, `lib/risk/score.ts`, and the
 * assertions in `lib/validation/assertions.ts` already use. Prior to B-04
 * the year hub and pipeline page used a looser filter (`isDuplicateOf` only),
 * which produced a 536 vs 485 mismatch on Atif's prod data.
 *
 * `hiddenTx` returns the gap so the risk page can render a breakdown card
 * ("536 raw / 485 active / 51 hidden").
 */
export async function getYearCounts(taxYearId: string): Promise<YearCounts> {
  const taxYear = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { year: true },
  })
  const yearWindow = taxYear ? inYearWindow(taxYear.year) : {}

  const canonicalWhere = {
    taxYearId,
    isDuplicateOf: null,
    isSplit: false,
    isStale: false,
    ...yearWindow,
  }

  const [totalTx, rawTx, classifiedTx, pendingStops] = await Promise.all([
    prisma.transaction.count({ where: canonicalWhere }),
    prisma.transaction.count({ where: { taxYearId } }),
    prisma.classification.count({
      where: {
        transaction: canonicalWhere,
        isCurrent: true,
      },
    }),
    prisma.stopItem.count({ where: { taxYearId, state: "PENDING" } }),
  ])

  return {
    totalTx,
    classifiedTx,
    pendingStops,
    hiddenTx: rawTx - totalTx,
  }
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
