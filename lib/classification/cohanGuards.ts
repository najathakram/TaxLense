/**
 * §274(d) hard rail — shared invariant for Cohan reconstruction.
 *
 * Cohan v. Commissioner (39 F.2d 540, 2d Cir. 1930) permits reasonable
 * estimation of business expenses under §162 when contemporaneous records
 * are incomplete. §274(d) carved out a contemporaneous-substantiation
 * requirement for meals, travel, vehicle, gifts, and listed property —
 * categories where the IRS will NOT accept Cohan reconstruction.
 *
 * This module is the single source of truth that enforces "no Cohan on
 * §274(d)" across the auto-CPA pipeline. Every code path that would set
 * `cohanFlag=true` or promote a row's evidence tier must call
 * `assertNot274dCohan` first and short-circuit on rejection.
 *
 * Used by:
 *   - lib/ai/cohanSweep.ts (filters candidate rows before prompting Sonnet)
 *   - lib/findings/apply.ts (gates findings before flip-and-insert)
 *   - app/(app)/years/[year]/findings/actions.ts (UI accept path)
 */

import type { TransactionCode } from "@/app/generated/prisma/client"

/**
 * Codes that ARE §274(d) categories. Never eligible for Cohan reconstruction
 * — they require contemporaneous substantiation (attendees, purpose, place).
 */
export const SECTION_274D_CODES: TransactionCode[] = [
  "MEALS_50",
  "MEALS_100",
  "WRITE_OFF_TRAVEL",
]

/**
 * Merchant keyword fragments that signal a §274(d) category even when the
 * proposed code is generic (e.g. WRITE_OFF on a hotel charge). Case-insensitive
 * substring match against merchantRaw or merchantNormalized.
 *
 * Curated from Atif's prod ledger + the standard IRS publication 463 list.
 * Future additions: add the fragment and a test in tests/ai-cohan-sweep.test.ts.
 */
export const SECTION_274D_MERCHANT_FRAGMENTS: readonly string[] = [
  // Vehicle / fuel
  "UBER",
  "LYFT",
  "GAS ",
  "FUEL",
  "EXXON",
  "CHEVRON",
  "SHELL ",
  "ARCO",
  "MOBIL",
  "BP ",
  "76 ",
  "SUNOCO",
  "VALERO",
  "RENTAL CAR",
  "HERTZ",
  "AVIS",
  "ENTERPRISE",
  "BUDGET RENT",
  "NATIONAL CAR",
  // Air travel
  "AIRLINES",
  "AIRWAYS",
  "DELTA AIR",
  "UNITED AIR",
  "AMERICAN AIR",
  "SOUTHWEST AIR",
  "ALASKA AIR",
  "JETBLUE",
  "FRONTIER AIR",
  "SPIRIT AIR",
  // Hotels / lodging
  "HOTEL",
  "MARRIOTT",
  "HILTON",
  "HYATT",
  "RAMADA",
  "HOLIDAY INN",
  "BEST WESTERN",
  "MOTEL",
  "AIRBNB",
  "VRBO",
  "BOOKING.COM",
  "EXPEDIA",
  // Meals / restaurants
  "RESTAURANT",
  "STARBUCKS",
  "CHIPOTLE",
  "MCDONALDS",
  "MCDONALD'S",
  "DOORDASH",
  "UBER EATS",
  "GRUBHUB",
  "POSTMATES",
  "CAVIAR",
  // Gifts
  "GIFT",
  "FLOWERS",
  "FTD",
  "1-800-FLOWERS",
  "EDIBLE ARRANGE",
]

export interface CohanProposal {
  code: TransactionCode
  merchantRaw?: string | null
  merchantNormalized?: string | null
  ircCitations?: string[]
  scheduleCLine?: string | null
}

export interface CohanGuardResult {
  allowed: boolean
  reason?: string
  matchedFragment?: string
}

/**
 * Hard rail check. Returns `{ allowed: false, reason }` when the proposal
 * would set `cohanFlag=true` on a §274(d) row. Callers MUST short-circuit on
 * rejection and persist the rejection as a DISMISSED LedgerFinding with the
 * `COHAN_FORBIDDEN_REJECTED` AuditEvent.
 *
 * Order matters — code check first (cheapest); then citation check (handles
 * the case where a WRITE_OFF row carries §274(d) explicitly); then merchant
 * fragment check (catches "WRITE_OFF on a STARBUCKS charge" style false
 * positives).
 */
export function assertNot274dCohan(proposal: CohanProposal): CohanGuardResult {
  // 1. Code bright line
  if (SECTION_274D_CODES.includes(proposal.code)) {
    return {
      allowed: false,
      reason: `Code ${proposal.code} is §274(d); Cohan estimation is denied. Substantiate (attendees, purpose) or leave PERSONAL.`,
    }
  }

  // 2. Citation bright line
  const cites = proposal.ircCitations ?? []
  if (cites.some((c) => c.includes("§274(d)"))) {
    return {
      allowed: false,
      reason: `Classification cites §274(d); contemporaneous records required. Cohan denied.`,
    }
  }

  // 3. Schedule C line bright line — Line 24a/24b are the §274(d) lines.
  const line = proposal.scheduleCLine ?? ""
  if (line.startsWith("Line 24a") || line.startsWith("Line 24b") || line.startsWith("Line 9")) {
    return {
      allowed: false,
      reason: `Schedule C ${line} is a §274(d) line (travel/meals/car). Cohan denied.`,
    }
  }

  // 4. Merchant fragment match — catches the "looks like a §274(d) txn but
  //    was coded WRITE_OFF" pattern.
  const m = (proposal.merchantRaw ?? proposal.merchantNormalized ?? "").toUpperCase()
  for (const fragment of SECTION_274D_MERCHANT_FRAGMENTS) {
    if (m.includes(fragment)) {
      return {
        allowed: false,
        reason: `Merchant "${m}" matches §274(d) fragment "${fragment.trim()}"; Cohan denied.`,
        matchedFragment: fragment,
      }
    }
  }

  return { allowed: true }
}

/**
 * Helper for the SUBSTANTIATION_QUEUE: identifies §274(d) candidates that
 * the queue should surface for human-supplied facts. Returns true when the
 * txn LOOKS like a §274(d) row that's currently sitting in PERSONAL — exactly
 * the rows the substantiation form addresses.
 */
export function isSection274dCandidate(merchantRaw: string | null | undefined): boolean {
  const m = (merchantRaw ?? "").toUpperCase()
  if (!m) return false
  return SECTION_274D_MERCHANT_FRAGMENTS.some((fragment) => m.includes(fragment))
}
