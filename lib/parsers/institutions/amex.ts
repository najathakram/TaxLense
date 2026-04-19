/**
 * American Express — CSV parser
 *
 * Sign convention in source: charges POSITIVE, payments/credits NEGATIVE
 * Normalisation: amountNormalized = amountOriginal (no flip needed)
 * (outflows already +, inflows already −)
 *
 * CSV headers:
 *   Date, Description, Card Member, Account #, Amount
 */

import { parseDollar, parseDateFlex } from "../csv-extractor"
import type { RawTx, ParseResult } from "../types"

export const AMEX_HEADERS = [
  "Date",
  "Description",
  "Card Member",
  "Account #",
  "Amount",
]

export function parseAmex(
  rows: Record<string, string>[],
): ParseResult {
  const transactions: RawTx[] = []
  const errors: string[] = []

  for (const [i, row] of rows.entries()) {
    const postedRaw = row["Date"] ?? ""
    const descRaw = row["Description"] ?? ""
    const amtRaw = row["Amount"] ?? ""

    const postedDate = parseDateFlex(postedRaw)
    if (!postedDate) { errors.push(`Row ${i + 1}: invalid date "${postedRaw}"`); continue }

    const amountOriginal = parseDollar(amtRaw)
    if (amountOriginal === null) { errors.push(`Row ${i + 1}: invalid amount "${amtRaw}"`); continue }

    // Amex: charges already positive — no flip
    const amountNormalized = amountOriginal

    transactions.push({
      postedDate,
      amountOriginal,
      amountNormalized,
      merchantRaw: descRaw || "UNKNOWN",
    })
  }

  return buildResult(transactions, errors, "amex")
}

function buildResult(transactions: RawTx[], errors: string[], institution: string): ParseResult {
  if (transactions.length === 0) {
    return {
      ok: false,
      error: errors[0] ?? "No transactions parsed",
      institution,
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: true },
      parseConfidence: 0,
    }
  }

  const dates = transactions.map((t) => t.postedDate.getTime())
  const totalOutflows = transactions.reduce((s, t) => s + Math.max(0, t.amountNormalized), 0)
  const totalInflows = transactions.reduce((s, t) => s + Math.abs(Math.min(0, t.amountNormalized)), 0)

  return {
    ok: true,
    institution,
    periodStart: new Date(Math.min(...dates)),
    periodEnd: new Date(Math.max(...dates)),
    transactions,
    totalInflows,
    totalOutflows,
    reconciliation: { ok: true },
    parseConfidence: errors.length === 0 ? 0.95 : 0.7,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  }
}
