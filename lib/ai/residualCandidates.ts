/**
 * Residual candidate selector — spec §3.3 Phase 4, §6.2.
 *
 * Identifies transactions that can't be confidently classified at the merchant
 * level and need single-transaction AI reasoning. Three gates:
 *
 *  (a) Multi-candidate merchant: the MerchantRule is GRAY with confidence < 0.85
 *  (b) Amount outlier: txn amount > 3σ from the mean of same-merchant charges
 *      (requires ≥5 samples to compute)
 *  (c) Gray + trip-ambiguous: GRAY code, |amount| > $500, posted within ±2 days
 *      of a confirmed trip boundary (enter or exit day)
 *
 * Exclusions: PERSONAL, TRANSFER, PAYMENT, split parents, classifications
 * whose source is USER or AI_USER_CONFIRMED (user already decided).
 */

import { prisma } from "@/lib/db"
import type { Prisma } from "@/app/generated/prisma/client"

export type ResidualReason = "MULTI_CANDIDATE" | "AMOUNT_OUTLIER" | "TRIP_AMBIGUOUS"

export interface ResidualCandidate {
  transactionId: string
  reasons: ResidualReason[]
  merchantKey: string
}

const TRIP_BOUNDARY_DAYS = 2
const TRIP_AMBIGUOUS_MIN_AMOUNT = 500
const OUTLIER_SIGMA = 3
const OUTLIER_MIN_SAMPLES = 5
const MULTI_CANDIDATE_MAX_CONFIDENCE = 0.85

function daysBetween(a: Date, b: Date): number {
  return Math.abs(a.getTime() - b.getTime()) / 86_400_000
}

export async function selectResidualCandidates(
  taxYearId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<ResidualCandidate[]> {
  const [rules, trips, txns] = await Promise.all([
    db.merchantRule.findMany({ where: { taxYearId } }),
    db.trip.findMany({ where: { profile: { taxYearId }, isConfirmed: true } }),
    db.transaction.findMany({
      where: {
        taxYearId,
        isSplit: false,
        splitOfId: null,
        isDuplicateOf: null,
        isTransferPairedWith: null,
        isPaymentPairedWith: null,
        merchantNormalized: { not: null },
      },
      include: {
        classifications: { where: { isCurrent: true }, take: 1 },
      },
    }),
  ])

  const ruleByKey = new Map(rules.map((r) => [r.merchantKey.toUpperCase(), r]))

  // Compute amount stats per merchant (for outlier detection)
  const amountsByMerchant = new Map<string, number[]>()
  for (const t of txns) {
    const key = t.merchantNormalized!.toUpperCase()
    const arr = amountsByMerchant.get(key) ?? []
    arr.push(Math.abs(Number(t.amountNormalized)))
    amountsByMerchant.set(key, arr)
  }
  const statsByMerchant = new Map<string, { mean: number; sigma: number; n: number }>()
  for (const [key, amounts] of amountsByMerchant) {
    const n = amounts.length
    if (n < OUTLIER_MIN_SAMPLES) continue
    const mean = amounts.reduce((a, b) => a + b, 0) / n
    const variance = amounts.reduce((acc, x) => acc + (x - mean) ** 2, 0) / n
    const sigma = Math.sqrt(variance)
    statsByMerchant.set(key, { mean, sigma, n })
  }

  const candidates: ResidualCandidate[] = []

  for (const t of txns) {
    const key = t.merchantNormalized!.toUpperCase()
    const rule = ruleByKey.get(key)
    const current = t.classifications[0]

    // Skip if user already decided
    if (current && (current.source === "USER" || current.source === "AI_USER_CONFIRMED")) continue
    // Skip uninteresting final codes
    if (current && (current.code === "PERSONAL" || current.code === "TRANSFER" || current.code === "PAYMENT")) continue

    const reasons: ResidualReason[] = []

    // (a) multi-candidate: GRAY rule under 0.85 confidence
    if (rule && rule.code === "GRAY" && rule.confidence < MULTI_CANDIDATE_MAX_CONFIDENCE) {
      reasons.push("MULTI_CANDIDATE")
    }

    // (b) amount outlier
    const stats = statsByMerchant.get(key)
    if (stats && stats.sigma > 0) {
      const absAmt = Math.abs(Number(t.amountNormalized))
      const z = (absAmt - stats.mean) / stats.sigma
      if (z > OUTLIER_SIGMA) reasons.push("AMOUNT_OUTLIER")
    }

    // (c) gray + trip-ambiguous (within ±2 days of any trip boundary)
    const isGray = current?.code === "GRAY" || rule?.code === "GRAY"
    const absAmt = Math.abs(Number(t.amountNormalized))
    if (isGray && absAmt > TRIP_AMBIGUOUS_MIN_AMOUNT) {
      for (const trip of trips) {
        if (
          daysBetween(t.postedDate, trip.startDate) <= TRIP_BOUNDARY_DAYS ||
          daysBetween(t.postedDate, trip.endDate) <= TRIP_BOUNDARY_DAYS
        ) {
          reasons.push("TRIP_AMBIGUOUS")
          break
        }
      }
    }

    if (reasons.length > 0) {
      candidates.push({ transactionId: t.id, reasons, merchantKey: key })
    }
  }

  return candidates
}
