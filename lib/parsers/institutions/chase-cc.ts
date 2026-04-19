/**
 * Chase Credit Card — CSV parser
 *
 * Sign convention in source: charges NEGATIVE, payments POSITIVE
 * Normalisation: amountNormalized = -amountOriginal
 * (outflows become +, inflows become −)
 *
 * CSV headers (7 columns):
 *   Transaction Date, Post Date, Description, Category, Type, Amount, Memo
 */

import { parseDollar, parseDateFlex } from "../csv-extractor"
import type { RawTx, ParseResult } from "../types"

export const CHASE_CC_HEADERS = [
  "Transaction Date",
  "Post Date",
  "Description",
  "Category",
  "Type",
  "Amount",
]

export function parseChaseCc(
  rows: Record<string, string>[],
): ParseResult {
  const transactions: RawTx[] = []
  const errors: string[] = []

  for (const [i, row] of rows.entries()) {
    const postedRaw = row["Post Date"] ?? row["Transaction Date"] ?? ""
    const transRaw = row["Transaction Date"] ?? ""
    const descRaw = row["Description"] ?? ""
    const amtRaw = row["Amount"] ?? ""

    const postedDate = parseDateFlex(postedRaw)
    if (!postedDate) { errors.push(`Row ${i + 1}: invalid date "${postedRaw}"`); continue }

    const amountOriginal = parseDollar(amtRaw)
    if (amountOriginal === null) { errors.push(`Row ${i + 1}: invalid amount "${amtRaw}"`); continue }

    // Chase CC: charges negative → flip to positive (outflow)
    const amountNormalized = -amountOriginal

    transactions.push({
      postedDate,
      transactionDate: parseDateFlex(transRaw) ?? undefined,
      amountOriginal,
      amountNormalized,
      merchantRaw: descRaw || "UNKNOWN",
      descriptionRaw: row["Memo"] ?? undefined,
    })
  }

  return buildResult(transactions, errors, "chase-cc")
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
    reconciliation: { ok: true }, // CSV: no external total to compare
    parseConfidence: errors.length === 0 ? 0.95 : 0.7,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  }
}
