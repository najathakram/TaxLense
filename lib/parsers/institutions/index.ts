/**
 * TaxLens — Institution registry + auto-detection
 *
 * detectInstitution() inspects CSV headers (and optionally the raw text for OFX)
 * and returns the best-matching institution key.
 *
 * Detection order (most-specific first):
 *   1. OFX/QFX text marker
 *   2. Robinhood (unique "Trans Code" + "Instrument" headers)
 *   3. Chase CC (unique "Post Date" + "Type" headers + 7-col layout)
 *   4. Chase Checking (unique "Details" + "Posting Date" headers)
 *   5. Costco Citi (unique "Status" + "Debit" + "Credit" headers)
 *   6. Amex (unique "Card Member" + "Account #" headers)
 *   7. Generic fallback
 */

import { CHASE_CC_HEADERS, parseChaseCc } from "./chase-cc"
import { CHASE_CHECKING_HEADERS, parseChaseChecking } from "./chase-checking"
import { AMEX_HEADERS, parseAmex } from "./amex"
import { COSTCO_CITI_HEADERS, parseCostcoCiti } from "./costco-citi"
import { parseRobinhood } from "./robinhood"
import { parseGeneric } from "./generic"
import { parseOfxGeneric } from "./ofx-generic"
import type { ParseResult } from "../types"

export type InstitutionKey =
  | "chase-cc"
  | "chase-checking"
  | "amex"
  | "costco-citi"
  | "robinhood"
  | "ofx-generic"
  | "generic"

/** Returns true if every requiredHeader (case-insensitive) is present in actualHeaders */
function hasHeaders(actualHeaders: string[], requiredHeaders: string[]): boolean {
  const lower = actualHeaders.map((h) => h.toLowerCase())
  return requiredHeaders.every((r) => lower.includes(r.toLowerCase()))
}

/**
 * Detect institution from CSV headers (and raw text for OFX).
 * Returns the institution key string.
 */
export function detectInstitution(
  headers: string[],
  rawText?: string,
): InstitutionKey {
  // 1. OFX/QFX: look for OFX marker in raw text
  if (rawText) {
    const upper = rawText.slice(0, 512).toUpperCase()
    if (upper.includes("OFXHEADER") || upper.includes("<OFX>") || upper.includes("<STMTTRN>")) {
      return "ofx-generic"
    }
  }

  // 2. Robinhood: "Trans Code" + "Instrument" headers are unique
  if (hasHeaders(headers, ["Trans Code", "Instrument", "Activity Date"])) {
    return "robinhood"
  }

  // 3. Chase CC: "Post Date" + "Type" + "Category" — Chase CC has all three
  if (hasHeaders(headers, ["Post Date", "Type", "Category", "Transaction Date"])) {
    return "chase-cc"
  }

  // 4. Chase Checking: "Posting Date" + "Details" (no "Post Date" / "Type")
  if (hasHeaders(headers, ["Posting Date", "Details"])) {
    return "chase-checking"
  }

  // 5. Costco Citi: "Status" + "Debit" + "Credit"
  if (hasHeaders(headers, ["Status", "Debit", "Credit"])) {
    return "costco-citi"
  }

  // 6. Amex: "Card Member" + "Account #"
  if (hasHeaders(headers, ["Card Member", "Account #"])) {
    return "amex"
  }

  // 7. Generic fallback
  return "generic"
}

/**
 * Dispatch parsed rows to the correct institution parser.
 */
export function dispatchCsvParse(
  institution: InstitutionKey,
  rows: Record<string, string>[],
  headers: string[],
): ParseResult {
  switch (institution) {
    case "chase-cc":
      return parseChaseCc(rows)
    case "chase-checking":
      return parseChaseChecking(rows)
    case "amex":
      return parseAmex(rows)
    case "costco-citi":
      return parseCostcoCiti(rows)
    case "robinhood":
      return parseRobinhood(rows)
    case "generic":
    default:
      return parseGeneric(rows, headers)
  }
}

/** All known institution keys with display names */
export const INSTITUTION_DISPLAY: Record<InstitutionKey, string> = {
  "chase-cc": "Chase Credit Card",
  "chase-checking": "Chase Checking",
  "amex": "American Express",
  "costco-citi": "Costco Anywhere Visa (Citi)",
  "robinhood": "Robinhood",
  "ofx-generic": "OFX/QFX",
  "generic": "Generic CSV",
}
