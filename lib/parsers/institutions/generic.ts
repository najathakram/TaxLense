/**
 * Generic CSV parser — last-resort fallback
 *
 * Attempts to detect date, amount, and description columns by header name heuristics.
 * Sign convention: unknown — we try to detect from column names (Debit/Credit split
 * or single Amount column). If ambiguous, defaults to: amountNormalized = -amountOriginal.
 *
 * parseConfidence capped at 0.6 (generic fallback always uncertain).
 */

import { parseDollar, parseDateFlex } from "../csv-extractor"
import type { RawTx, ParseResult } from "../types"

/** Header name patterns for each semantic field */
const DATE_HEADERS = ["date", "transaction date", "posting date", "post date", "trans date", "value date"]
const DESC_HEADERS = ["description", "memo", "payee", "merchant", "name", "narrative", "details"]
const AMOUNT_HEADERS = ["amount", "transaction amount", "amt"]
const DEBIT_HEADERS = ["debit", "withdrawal", "withdrawals", "debit amount", "out"]
const CREDIT_HEADERS = ["credit", "deposit", "deposits", "credit amount", "in"]

function findHeader(headers: string[], candidates: string[]): string | undefined {
  const lower = headers.map((h) => h.toLowerCase())
  for (const c of candidates) {
    const idx = lower.indexOf(c)
    if (idx !== -1) return headers[idx]
  }
  return undefined
}

export function parseGeneric(
  rows: Record<string, string>[],
  suppliedHeaders?: string[],
): ParseResult {
  if (rows.length === 0) {
    return {
      ok: false,
      error: "No rows to parse",
      institution: "generic",
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: true },
      parseConfidence: 0,
    }
  }

  const headers = suppliedHeaders ?? Object.keys(rows[0])
  const dateHeader = findHeader(headers, DATE_HEADERS)
  const descHeader = findHeader(headers, DESC_HEADERS)
  const amtHeader = findHeader(headers, AMOUNT_HEADERS)
  const debitHeader = findHeader(headers, DEBIT_HEADERS)
  const creditHeader = findHeader(headers, CREDIT_HEADERS)

  if (!dateHeader) {
    return {
      ok: false,
      error: "Cannot detect date column from headers",
      institution: "generic",
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: true },
      parseConfidence: 0,
    }
  }

  if (!amtHeader && !debitHeader && !creditHeader) {
    return {
      ok: false,
      error: "Cannot detect amount column from headers",
      institution: "generic",
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: true },
      parseConfidence: 0,
    }
  }

  const transactions: RawTx[] = []
  const errors: string[] = []

  for (const [i, row] of rows.entries()) {
    const postedRaw = dateHeader ? (row[dateHeader] ?? "") : ""
    const descRaw = descHeader ? (row[descHeader] ?? "") : ""

    const postedDate = parseDateFlex(postedRaw)
    if (!postedDate) { errors.push(`Row ${i + 1}: invalid date "${postedRaw}"`); continue }

    let amountOriginal: number | null = null
    let amountNormalized: number

    if (debitHeader || creditHeader) {
      const debitRaw = debitHeader ? (row[debitHeader] ?? "") : ""
      const creditRaw = creditHeader ? (row[creditHeader] ?? "") : ""
      const debit = debitRaw ? parseDollar(debitRaw) : null
      const credit = creditRaw ? parseDollar(creditRaw) : null

      if (debit !== null && debit !== 0) {
        amountOriginal = debit
        amountNormalized = debit // debit = outflow +
      } else if (credit !== null && credit !== 0) {
        amountOriginal = credit
        amountNormalized = -credit // credit = inflow −
      } else {
        errors.push(`Row ${i + 1}: both Debit and Credit empty or zero`)
        continue
      }
    } else {
      const amtRaw = amtHeader ? (row[amtHeader] ?? "") : ""
      amountOriginal = parseDollar(amtRaw)
      if (amountOriginal === null) { errors.push(`Row ${i + 1}: invalid amount "${amtRaw}"`); continue }
      // Default assumption: negative = outflow (most banks), flip
      amountNormalized = -amountOriginal
    }

    transactions.push({
      postedDate,
      amountOriginal,
      amountNormalized,
      merchantRaw: descRaw || "UNKNOWN",
    })
  }

  if (transactions.length === 0) {
    return {
      ok: false,
      error: errors[0] ?? "No transactions parsed",
      institution: "generic",
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
    institution: "generic",
    periodStart: new Date(Math.min(...dates)),
    periodEnd: new Date(Math.max(...dates)),
    transactions,
    totalInflows,
    totalOutflows,
    reconciliation: { ok: true },
    // Generic fallback: cap confidence at 0.6
    parseConfidence: errors.length === 0 ? 0.6 : 0.4,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  }
}
