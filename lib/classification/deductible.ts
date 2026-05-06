/**
 * Single source of truth for "Schedule C deductible amount" per transaction.
 *
 * Used by:
 *  - app/(app)/years/[year]/ledger/page.tsx  (header + per-row column)
 *  - lib/reports/financialStatements.ts      (Schedule C totals)
 *  - lib/risk/score.ts                       (estimatedDeductions card)
 *  - lib/validation/assertions.ts            (A03 SCHEDULE_C_SUM)
 *  - lib/reports/auditPacket.ts              (audit packet exports)
 *
 * If any of these compute differently they will disagree with A03 and a CPA
 * will lose trust. Keep this function the canonical formula.
 */
import type { TransactionCode } from "@/app/generated/prisma/client"

export const DEDUCTIBLE_CODES: readonly TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
] as const

export function isDeductibleCode(code: TransactionCode): boolean {
  return (DEDUCTIBLE_CODES as readonly TransactionCode[]).includes(code)
}

/**
 * Deductible dollar amount for one transaction row.
 *
 * - Inflows (amountNormalized < 0) deduct nothing.
 * - PERSONAL / TRANSFER / PAYMENT / BIZ_INCOME / NEEDS_CONTEXT → 0.
 * - businessPct of 0..100 prorates the outflow.
 * - MEALS_50 applies the §274(n)(1) 50% multiplier on top of businessPct.
 */
export function computeDeductibleAmt(
  amountNormalized: number,
  code: TransactionCode,
  businessPct: number,
): number {
  if (!isDeductibleCode(code)) return 0
  const outflow = Math.max(0, amountNormalized)
  let dedAmt = outflow * (businessPct / 100)
  if (code === "MEALS_50") dedAmt = dedAmt * 0.5
  return dedAmt
}
