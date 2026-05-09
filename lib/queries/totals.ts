/**
 * Single source of truth for "how much money did this taxpayer take in / spend
 * / claim as a deduction this year?"
 *
 * Pre-B-05 these aggregates were computed independently in:
 *   - lib/analytics/build.ts        (Analytics page Gross Receipts card)
 *   - lib/validation/assertions.ts  (A04 Gross Receipts, A03 Schedule C, A13 deposits)
 *   - lib/risk/score.ts             (Risk dashboard Estimated Deductions card)
 *   - lib/reports/financialStatements.ts  (Schedule C totals XLSX)
 *
 * Each had a slightly different filter combination — most painfully, Analytics
 * counted any `BIZ_INCOME`-coded transaction (regardless of sign or transfer-
 * pairing) while A04 strictly required an inflow that wasn't transfer-paired.
 * On Atif's TY2025 prod data the Analytics card showed $24,811 in Gross
 * Receipts while A04 / A13 / Finalize showed $18,313.22 — a $6,498 gap.
 *
 * This module provides one definition that every caller routes through.
 */

import type { Prisma, TransactionCode } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/db"
import { computeDeductibleAmt } from "@/lib/classification/deductible"
import { inYearWindow } from "@/lib/queries/yearWindow"

const DEDUCTIBLE_CODES: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

/**
 * Build the canonical Prisma `where` clause for an in-year, ledger-eligible
 * transaction. Mirrors `lib/taxYear/status.ts:getYearCounts` and the ledger
 * page's filter so headline numbers across the app agree.
 */
export async function ledgerWhere(taxYearId: string): Promise<Prisma.TransactionWhereInput> {
  const ty = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { year: true },
  })
  return {
    taxYearId,
    isSplit: false,
    isStale: false,
    isDuplicateOf: null,
    ...(ty ? inYearWindow(ty.year) : {}),
  }
}

export interface YearTotals {
  /** Sum of `Math.abs(amount)` over inflow rows classified `BIZ_INCOME` that
   *  are NOT transfer-paired. Matches A04 / Schedule C P&L gross revenue. */
  grossReceiptsCents: number
  /** Sum of `computeDeductibleAmt(...)` over deductible-coded rows. Matches
   *  A03 and Schedule C "Total expenses". */
  totalDeductibleCents: number
  /** Sum of `Math.abs(amount)` over inflows that are unclassified or
   *  classified `NEEDS_CONTEXT`, excluding transfer-paired. Matches A13's
   *  "unclassified" bucket. */
  unclassifiedInflowsCents: number
}

/**
 * Compute every headline dollar figure for a tax year in one pass.
 *
 * Callers MUST go through this helper. Adding inline aggregation in a page or
 * report is a regression — the tradeoff in B-05 was: the gain is "every page
 * agrees on Atif's $18,313", the cost is "one round-trip to the DB and a
 * single in-memory loop per page". Both are negligible.
 */
export async function getYearTotals(taxYearId: string): Promise<YearTotals> {
  const where = await ledgerWhere(taxYearId)
  const rows = await prisma.transaction.findMany({
    where,
    select: {
      amountNormalized: true,
      isTransferPairedWith: true,
      classifications: {
        where: { isCurrent: true },
        select: { code: true, businessPct: true },
        take: 1,
      },
    },
  })

  let grossReceiptsCents = 0
  let totalDeductibleCents = 0
  let unclassifiedInflowsCents = 0

  for (const r of rows) {
    const amt = Number(r.amountNormalized.toString())
    const c = r.classifications[0]

    if (c && DEDUCTIBLE_CODES.includes(c.code)) {
      totalDeductibleCents += Math.round(
        computeDeductibleAmt(amt, c.code, c.businessPct) * 100,
      )
    }

    // Inflow-only fields below.
    if (amt >= 0) continue
    if (r.isTransferPairedWith) continue

    const absCents = Math.round(Math.abs(amt) * 100)
    if (c?.code === "BIZ_INCOME") {
      grossReceiptsCents += absCents
    } else if (!c || c.code === "NEEDS_CONTEXT") {
      unclassifiedInflowsCents += absCents
    }
  }

  return {
    grossReceiptsCents,
    totalDeductibleCents,
    unclassifiedInflowsCents,
  }
}
