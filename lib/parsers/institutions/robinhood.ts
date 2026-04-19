/**
 * Robinhood — CSV parser
 *
 * Sign convention in source: withdrawals/purchases NEGATIVE, deposits/dividends POSITIVE
 * Normalisation: amountNormalized = -amountOriginal
 * (outflows become +, inflows become −)
 *
 * CSV headers:
 *   Activity Date, Process Date, Settle Date, Instrument, Description, Trans Code, Quantity, Price, Amount
 *
 * Note: Robinhood brokerage statements include securities transactions (BUY/SELL) and
 * cash flows (CDIV dividend, ACH deposit/withdrawal). All rows are ingested; the
 * Merchant Intelligence Agent classifies by Trans Code + Description.
 */

import { parseDollar, parseDateFlex } from "../csv-extractor"
import type { RawTx, ParseResult } from "../types"

export const ROBINHOOD_HEADERS = [
  "Activity Date",
  "Process Date",
  "Settle Date",
  "Instrument",
  "Description",
  "Trans Code",
  "Quantity",
  "Price",
  "Amount",
]

export function parseRobinhood(
  rows: Record<string, string>[],
): ParseResult {
  const transactions: RawTx[] = []
  const errors: string[] = []

  for (const [i, row] of rows.entries()) {
    const activityRaw = row["Activity Date"] ?? ""
    const processRaw = row["Process Date"] ?? row["Settle Date"] ?? ""
    const descRaw = row["Description"] ?? ""
    const instrRaw = row["Instrument"] ?? ""
    const transCode = row["Trans Code"] ?? ""
    const amtRaw = row["Amount"] ?? ""

    // Skip rows with no amount (header-only or summary rows)
    if (!amtRaw) continue

    const postedDate = parseDateFlex(processRaw || activityRaw)
    if (!postedDate) { errors.push(`Row ${i + 1}: invalid date "${processRaw || activityRaw}"`); continue }

    const transactionDate = parseDateFlex(activityRaw) ?? undefined

    const amountOriginal = parseDollar(amtRaw)
    if (amountOriginal === null) { errors.push(`Row ${i + 1}: invalid amount "${amtRaw}"`); continue }

    // Robinhood: withdrawals/purchases negative → flip to positive (outflow)
    const amountNormalized = -amountOriginal

    // Build merchant string from instrument + description + trans code
    const merchantParts = [instrRaw, descRaw, transCode].filter(Boolean)
    const merchantRaw = merchantParts.join(" ").trim() || "UNKNOWN"

    transactions.push({
      postedDate,
      transactionDate,
      amountOriginal,
      amountNormalized,
      merchantRaw,
      descriptionRaw: descRaw || undefined,
    })
  }

  return buildResult(transactions, errors, "robinhood")
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
