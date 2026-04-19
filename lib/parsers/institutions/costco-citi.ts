/**
 * Costco Anywhere Visa (Citi) — CSV parser
 *
 * Sign convention in source: charges POSITIVE, credits NEGATIVE
 * (Citi uses the same Amex-style sign convention)
 * Normalisation: amountNormalized = amountOriginal (no flip needed)
 *
 * CSV headers:
 *   Status, Date, Description, Debit, Credit
 *
 * Note: Citi exports a Debit column (positive charges) and Credit column (positive credits).
 * We read whichever is populated; Debit = outflow (+), Credit = inflow (−).
 */

import { parseDollar, parseDateFlex } from "../csv-extractor"
import type { RawTx, ParseResult } from "../types"

export const COSTCO_CITI_HEADERS = [
  "Status",
  "Date",
  "Description",
  "Debit",
  "Credit",
]

export function parseCostcoCiti(
  rows: Record<string, string>[],
): ParseResult {
  const transactions: RawTx[] = []
  const errors: string[] = []

  for (const [i, row] of rows.entries()) {
    const postedRaw = row["Date"] ?? ""
    const descRaw = row["Description"] ?? ""
    const debitRaw = row["Debit"] ?? ""
    const creditRaw = row["Credit"] ?? ""

    const postedDate = parseDateFlex(postedRaw)
    if (!postedDate) { errors.push(`Row ${i + 1}: invalid date "${postedRaw}"`); continue }

    // Prefer Debit/Credit split columns; fall back to a single Amount column if present
    let amountOriginal: number | null = null
    let amountNormalized: number

    if (debitRaw || creditRaw) {
      const debit = debitRaw ? parseDollar(debitRaw) : null
      const credit = creditRaw ? parseDollar(creditRaw) : null

      if (debit !== null && debit !== 0) {
        amountOriginal = debit
        amountNormalized = debit // outflow +
      } else if (credit !== null && credit !== 0) {
        amountOriginal = credit
        amountNormalized = -credit // inflow −
      } else {
        errors.push(`Row ${i + 1}: both Debit and Credit empty or zero`)
        continue
      }
    } else {
      // Fallback: single Amount column (charges positive, credits negative — Amex-style)
      const amtRaw = row["Amount"] ?? ""
      amountOriginal = parseDollar(amtRaw)
      if (amountOriginal === null) { errors.push(`Row ${i + 1}: invalid amount "${amtRaw}"`); continue }
      amountNormalized = amountOriginal
    }

    transactions.push({
      postedDate,
      amountOriginal,
      amountNormalized,
      merchantRaw: descRaw || "UNKNOWN",
    })
  }

  return buildResult(transactions, errors, "costco-citi")
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
