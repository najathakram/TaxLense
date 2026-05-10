/**
 * Wise (TransferWise) statement CSV parser.
 *
 * Background (B-06): Atif's prod ledger surfaced 47 Deposit STOPs labeled
 * "Sent money to {recipient}" — outflows that the generic parser stored as
 * inflows because Wise's CSV uses a sign convention the generic heuristic
 * couldn't disambiguate. The fix: read the description prefix as ground
 * truth ("Sent money to" → outflow, "Received money from" / "Topped up" →
 * inflow) regardless of the raw amount sign.
 *
 * Wise CSV column variants seen in the wild:
 *   "Date" / "Description" / "Amount" / "Currency" / ...
 *   "Created on" / "Description" / "Amount" / "Source amount" / ...
 *
 * Sign rule (this parser's contract):
 *   - "Sent money to X"        → outflow (amountNormalized > 0)
 *   - "Received money from X"  → inflow  (amountNormalized < 0)
 *   - "Topped up balance"      → inflow
 *   - "Card transaction"       → outflow
 *   - "Conversion"             → TRANSFER (we still store the amount; the
 *                                 cpaAgent + transfer-pairing pass classifies)
 *   - Anything else            → defer to amount sign (Wise convention:
 *                                 negative = outflow → flip to positive)
 *
 * The merchantRaw is set to the recipient/sender extracted from the
 * description, so analytics top-merchants doesn't credit "WISE INC" with
 * the deductible spend (B-17). The original verbose description survives
 * in descriptionRaw so the user can see it.
 */

import { parseDollar, parseDateFlex } from "../csv-extractor"
import type { RawTx, ParseResult } from "../types"

export const WISE_HEADERS = ["TransferWise ID", "Date", "Amount", "Description"] as const

export function isWise(headers: string[]): boolean {
  const lower = headers.map((h) => h.toLowerCase().trim())
  // Most reliable signal — Wise's IDs are the first column in every export
  if (lower.includes("transferwise id") || lower.includes("wise id")) return true
  // Fallback: distinct combination of "Payer Name" + "Payee Name" + "Running Balance"
  if (
    lower.includes("payer name") &&
    lower.includes("payee name") &&
    lower.includes("running balance")
  ) {
    return true
  }
  return false
}

const SENT_RX = /^(Sent money to|Sent|Card transaction|Direct Debit|Bank transfer to|Wise charge|Wise fee)\b/i
const RECEIVED_RX = /^(Received money from|Received|Topped up|Top-up|Bank transfer from|Wise rebate|Refund from)\b/i
const CONVERT_RX = /^(Converted|Conversion|Exchange)\b/i

/** Extract a clean merchant name from a Wise description.
 *
 *   "Sent money to Zain Ul Abideen Safdar"          → "ZAIN UL ABIDEEN SAFDAR"
 *   "Received money from Pocketsflow Inc"           → "POCKETSFLOW INC"
 *   "Card transaction at AMAZON.COM SEATTLE WA"     → "AMAZON.COM SEATTLE WA"
 *   "Topped up via Chase Checking"                  → "WISE TOP-UP" (transfer)
 */
export function wiseMerchantFromDescription(desc: string): string {
  const trimmed = desc.trim()
  // "Sent money to X" / "Sent X / Bank transfer to X / etc."
  const sent = trimmed.match(/^(?:Sent money to|Bank transfer to|Direct Debit to)\s+(.+?)$/i)
  if (sent && sent[1]) return sent[1].toUpperCase()
  const received = trimmed.match(/^(?:Received money from|Bank transfer from|Refund from)\s+(.+?)$/i)
  if (received && received[1]) return received[1].toUpperCase()
  const card = trimmed.match(/^Card transaction\s+(?:at\s+)?(.+?)$/i)
  if (card && card[1]) return card[1].toUpperCase()
  if (/^Topped up/i.test(trimmed) || /^Top-up/i.test(trimmed)) return "WISE TOP-UP"
  if (CONVERT_RX.test(trimmed)) return "WISE CONVERSION"
  if (/^Wise (charge|fee)/i.test(trimmed)) return "WISE FEE"
  // Unknown description — preserve a normalized form rather than letting
  // "WISE INC" leak through as the deductible vendor.
  return trimmed.toUpperCase()
}

interface WiseRow {
  date?: string
  amount?: string
  description?: string
}

function pickField(row: Record<string, string>, candidates: string[]): string | undefined {
  for (const k of Object.keys(row)) {
    if (candidates.some((c) => k.trim().toLowerCase() === c.toLowerCase())) {
      return row[k]
    }
  }
  return undefined
}

export function parseWise(rows: Record<string, string>[]): ParseResult {
  if (rows.length === 0) {
    return {
      ok: false,
      error: "No rows to parse",
      institution: "wise",
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
    const r: WiseRow = {
      date: pickField(row, ["Date", "Created on", "Finished on"]),
      amount: pickField(row, ["Amount", "Source amount", "Source amount (after fees)"]),
      description: pickField(row, ["Description", "Reference", "Payment Reference"]),
    }
    const postedRaw = r.date ?? ""
    const amtRaw = r.amount ?? ""
    const descRaw = r.description ?? ""

    const postedDate = parseDateFlex(postedRaw)
    if (!postedDate) {
      errors.push(`Row ${i + 1}: invalid date "${postedRaw}"`)
      continue
    }
    const amountOriginal = parseDollar(amtRaw)
    if (amountOriginal === null) {
      errors.push(`Row ${i + 1}: invalid amount "${amtRaw}"`)
      continue
    }

    // SIGN — description wins over raw sign. Wise occasionally exports outflow
    // amounts as positive (varies by region / report type), so trusting the
    // sign alone has caused cross-firm misclassification (B-06).
    let amountNormalized: number
    if (SENT_RX.test(descRaw)) {
      amountNormalized = Math.abs(amountOriginal) // outflow +
    } else if (RECEIVED_RX.test(descRaw)) {
      amountNormalized = -Math.abs(amountOriginal) // inflow −
    } else {
      // Fall back to the standard "negative = outflow, flip" convention.
      amountNormalized = -amountOriginal
    }

    const merchantRaw = wiseMerchantFromDescription(descRaw)

    transactions.push({
      postedDate,
      amountOriginal,
      amountNormalized,
      merchantRaw,
      // Surface the original verbose description so the user can audit.
      descriptionRaw: descRaw || undefined,
    })
  }

  if (transactions.length === 0) {
    return {
      ok: false,
      error: errors[0] ?? "No transactions parsed",
      institution: "wise",
      transactions: [],
      totalInflows: 0,
      totalOutflows: 0,
      reconciliation: { ok: true },
      parseConfidence: 0,
    }
  }

  const dates = transactions.map((t) => t.postedDate.getTime())
  const totalOutflows = transactions.reduce((s, t) => s + Math.max(0, t.amountNormalized), 0)
  const totalInflows = transactions.reduce(
    (s, t) => s + Math.abs(Math.min(0, t.amountNormalized)),
    0,
  )

  return {
    ok: true,
    institution: "wise",
    periodStart: new Date(Math.min(...dates)),
    periodEnd: new Date(Math.max(...dates)),
    transactions,
    totalInflows,
    totalOutflows,
    reconciliation: { ok: true },
    parseConfidence: errors.length === 0 ? 0.92 : 0.7,
    ...(errors.length > 0 ? { error: errors.join("; ") } : {}),
  }
}
