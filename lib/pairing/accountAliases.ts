/**
 * Account-alias extraction — recognize transfer-route hints in merchant text.
 *
 * Plan: plans/during-the-process-of-radiant-hanrahan.md Part 5.
 *
 * When a bank statement description says "Transfer from Aba/Contr Bnk-021000021"
 * the routing number (021000021 = JPMorgan Chase) tells us the source bank
 * even though TaxLens has no separate "routing number" column. Similarly
 * "ONLINE TRANSFER FROM ADV PLUS BANKING" identifies Bank of America's product
 * line, and "Transfer To Checking 7403" embeds the destination mask.
 *
 * These hints are the missing signal that lets us:
 *   (a) tighten transfer-pair scoring when the candidate account's
 *       institution matches the extracted hint (catches Wise top-ups where
 *       wire fees broke exact-amount pairing)
 *   (b) classify unpaired transfers as OWNER_EQUITY (Sole Prop) when the
 *       hint points to an institution that's tracked but the SPECIFIC source
 *       account isn't (= owner's personal Chase moving money to business
 *       Chase)
 *   (c) flag PAYMENT to "CC ending in NNNN" against FinancialAccount.mask
 *       so unmatched-mask payments surface as candidate owner draws
 *
 * Pure functions. No DB. Static lookup maps.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Routing number → institution
// ─────────────────────────────────────────────────────────────────────────────
//
// Major US bank ABA routing numbers. The full registry is huge; this is the
// pragmatic short-list of institutions our tested clients touch. Add entries
// as new clients introduce new banks.

export const ROUTING_NUMBER_INSTITUTIONS: Readonly<Record<string, string>> = {
  // JPMorgan Chase — multiple regional routing numbers, all map to "Chase"
  "021000021": "Chase",
  "022300173": "Chase",
  "044000037": "Chase",
  "051900366": "Chase",
  "071000013": "Chase",
  "072000326": "Chase",
  "074000010": "Chase",
  "075000019": "Chase",
  "083000137": "Chase",
  "111000614": "Chase",
  "267084131": "Chase",
  "322271627": "Chase",

  // Bank of America
  "026009593": "Bank of America",
  "051000017": "Bank of America",
  "052001633": "Bank of America",
  "053000196": "Bank of America",
  "054001204": "Bank of America",
  "063000047": "Bank of America",
  "061000052": "Bank of America",
  "064000020": "Bank of America",
  "081904808": "Bank of America",
  "111000025": "Bank of America",
  "121000358": "Bank of America",

  // Wells Fargo
  "121000248": "Wells Fargo",
  "102000076": "Wells Fargo",
  "053207766": "Wells Fargo",
  "121042882": "Wells Fargo",

  // Citi
  "021000089": "Citibank",
  "254070116": "Citibank",
  "266086554": "Citibank",

  // US Bank
  "081000210": "US Bank",
  "091000022": "US Bank",
  "121122676": "US Bank",

  // Capital One
  "031176110": "Capital One",
  "065000090": "Capital One",
  "056073502": "Capital One",
  "065404916": "Capital One",

  // Money-mover / fintech (covered separately by isMoneyMoverOutflow, but
  // listed here for completeness)
  "026073150": "Wise",
  "031101279": "Stripe",
  "021214891": "PayPal",
}

// ─────────────────────────────────────────────────────────────────────────────
// Bank product-name patterns → institution
// ─────────────────────────────────────────────────────────────────────────────
//
// Bank statements often reference the other side of a transfer by the bank's
// product name rather than its corporate brand ("ADV PLUS BANKING" instead of
// "Bank of America"). Pattern is a case-insensitive substring; institution is
// the canonical name we use in FinancialAccount.institution.

interface ProductPattern {
  readonly pattern: RegExp
  readonly institution: string
}

export const BANK_PRODUCT_PATTERNS: readonly ProductPattern[] = [
  // Bank of America
  { pattern: /\badv(antage)?\s+plus\s+banking\b/i, institution: "Bank of America" },
  { pattern: /\bbank\s+of\s+america\b/i, institution: "Bank of America" },
  { pattern: /\bbofa\b/i, institution: "Bank of America" },
  { pattern: /\bb\s*of\s*a\b/i, institution: "Bank of America" },

  // Chase
  { pattern: /\bchase\b/i, institution: "Chase" },
  { pattern: /\bjpmorgan\b/i, institution: "Chase" },
  { pattern: /\btotal\s+checking\b/i, institution: "Chase" },
  { pattern: /\bchase\s+business\b/i, institution: "Chase" },

  // Wells Fargo
  { pattern: /\bwells\s+fargo\b/i, institution: "Wells Fargo" },
  { pattern: /\bwf\s+bank\b/i, institution: "Wells Fargo" },

  // Citi
  { pattern: /\bciti(bank)?\b/i, institution: "Citibank" },

  // Discover
  { pattern: /\bdiscover\s+bank\b/i, institution: "Discover" },

  // Chime
  { pattern: /\bchime\b/i, institution: "Chime" },

  // Money movers (FYI — these usually go through the money-mover handler)
  { pattern: /\bwise\b/i, institution: "Wise" },
  { pattern: /\bpaypal\b/i, institution: "PayPal" },
  { pattern: /\bvenmo\b/i, institution: "Venmo" },
]

// ─────────────────────────────────────────────────────────────────────────────
// Extractors
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract a 9-digit routing number from merchant text. Looks for either:
 *   - A bare 9-digit run with word-boundary on both sides
 *   - "ABA-NNNNNNNNN", "Routing NNNNNNNNN", "Bnk-NNNNNNNNN", etc.
 *
 * Returns the routing number if found AND it's in our known-bank map.
 * Returns null otherwise — better to under-detect than to mis-classify a
 * 9-digit alphanumeric run (e.g., a transaction ID) as a routing number.
 */
export function parseRoutingNumber(merchantRaw: string | null | undefined): {
  routing: string
  institution: string
} | null {
  if (!merchantRaw) return null
  // Match 9-digit runs preceded by a separator (-, space, /, "Bnk", "ABA")
  // OR at word boundary. Avoids matching 9 digits embedded inside longer runs.
  const matches = merchantRaw.match(/(?:[^0-9]|^)(\d{9})(?:[^0-9]|$)/g)
  if (!matches) return null
  for (const m of matches) {
    const routing = m.replace(/[^0-9]/g, "")
    const institution = ROUTING_NUMBER_INSTITUTIONS[routing]
    if (institution) return { routing, institution }
  }
  return null
}

/**
 * Match merchant text against bank product-name patterns. Returns the first
 * matching institution. Used as a fallback when no routing number is present.
 */
export function parseBankProductHint(
  merchantRaw: string | null | undefined,
): { institution: string; pattern: string } | null {
  if (!merchantRaw) return null
  for (const p of BANK_PRODUCT_PATTERNS) {
    if (p.pattern.test(merchantRaw)) {
      return { institution: p.institution, pattern: p.pattern.source }
    }
  }
  return null
}

/**
 * Parse a 4-digit account mask hint from merchant text. Looks for explicit
 * markers: "ending in NNNN", "ENDING IN NNNN", "CC NNNN", "Checking NNNN",
 * "Card NNNN", "x-NNNN", "...NNNN". Won't match arbitrary 4-digit runs.
 *
 * Used to match transfer descriptions like "TRANSFER TO CC ENDING IN 1206"
 * against FinancialAccount.mask.
 */
export function parseAccountMaskHint(merchantRaw: string | null | undefined): string | null {
  if (!merchantRaw) return null
  const patterns: RegExp[] = [
    /ending\s+in\s+(\d{4})\b/i,
    /\bcc\s+(\d{4})\b/i,
    /\bcc\s*\.{2,}\s*(\d{4})\b/i,
    /\bcard\s+(\d{4})\b/i,
    /\bchecking\s+(\d{4})\b/i,
    /\bsavings\s+(\d{4})\b/i,
    /\baccount\s+(\d{4})\b/i,
    /\bacct\s+(\d{4})\b/i,
    /\bx[-\s](\d{4})\b/i,
    /\.{3,}\s*(\d{4})\b/i,
    /…\s*(\d{4})\b/u, // Unicode horizontal ellipsis (U+2026) — bank statements often render mask hints with this char
  ]
  for (const p of patterns) {
    const m = merchantRaw.match(p)
    if (m && m[1]) return m[1]
  }
  return null
}

/**
 * Convenience aggregator: extract every alias hint from one merchant string.
 * Used by transfer-pair scoring + CPA audit detection.
 */
export interface TransferHints {
  /** Routing number found AND matched to a known institution. */
  routingInstitution: string | null
  /** Institution inferred from a bank-product-name pattern (BofA "ADV PLUS BANKING"). */
  productInstitution: string | null
  /** 4-digit mask hint (the other account's last 4). */
  maskHint: string | null
  /** Best single inferred institution (routing wins over product). */
  inferredInstitution: string | null
}

export function extractTransferHints(merchantRaw: string | null | undefined): TransferHints {
  const routing = parseRoutingNumber(merchantRaw)
  const product = parseBankProductHint(merchantRaw)
  const mask = parseAccountMaskHint(merchantRaw)
  return {
    routingInstitution: routing?.institution ?? null,
    productInstitution: product?.institution ?? null,
    maskHint: mask,
    inferredInstitution: routing?.institution ?? product?.institution ?? null,
  }
}

/**
 * Match a transfer hint against the user's tracked FinancialAccounts. Returns
 * the matching account's id, or null when:
 *   - No hint extracted from the merchant text, OR
 *   - Hint points to an institution that the user DOESN'T have a tracked
 *     account for (= external / personal account / owner-equity candidate)
 *
 * `excludeAccountId` is the source-side account (don't match a transfer to
 * itself).
 */
export interface AccountForMatching {
  id: string
  institution: string
  mask: string | null
  nickname: string | null
}

export function matchHintToAccount(
  hints: TransferHints,
  accounts: readonly AccountForMatching[],
  excludeAccountId: string | null,
): { accountId: string; reason: string } | null {
  if (!hints.inferredInstitution && !hints.maskHint) return null

  // Strongest signal: mask + institution match
  if (hints.maskHint && hints.inferredInstitution) {
    const exact = accounts.find(
      (a) =>
        a.id !== excludeAccountId &&
        a.mask === hints.maskHint &&
        normalizeInstitution(a.institution) === normalizeInstitution(hints.inferredInstitution!),
    )
    if (exact) return { accountId: exact.id, reason: `mask+institution match (${hints.maskHint}/${hints.inferredInstitution})` }
  }

  // Mask-only match
  if (hints.maskHint) {
    const maskOnly = accounts.find((a) => a.id !== excludeAccountId && a.mask === hints.maskHint)
    if (maskOnly) return { accountId: maskOnly.id, reason: `mask match (${hints.maskHint})` }
  }

  // Institution-only match — only safe when the user has exactly ONE
  // tracked account at that institution total (across the whole user, not
  // just "other than source"). If the user has multiple accounts at the
  // same bank, the institution hint alone can't distinguish between (a) the
  // source account itself, (b) another tracked account at that institution,
  // and (c) an UNTRACKED account at that institution (= owner activity).
  // Bias toward owner-equity classification when ambiguous.
  if (hints.inferredInstitution) {
    const sameInst = accounts.filter(
      (a) =>
        normalizeInstitution(a.institution) === normalizeInstitution(hints.inferredInstitution!),
    )
    if (sameInst.length === 1 && sameInst[0]!.id !== excludeAccountId) {
      return { accountId: sameInst[0]!.id, reason: `institution match (${hints.inferredInstitution})` }
    }
  }

  return null
}

/**
 * Normalize institution names for fuzzy comparison. "Chase" / "Chase Bank" /
 * "JPMorgan Chase" all reduce to "chase".
 */
function normalizeInstitution(name: string): string {
  return name
    .toLowerCase()
    .replace(/\b(bank|jpmorgan|j\.?p\.?\s*morgan|n\.?a\.?|inc|corp|holdings)\b/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim()
}
