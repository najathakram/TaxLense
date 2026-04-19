/**
 * Deterministic merchant normalization — spec §4.3 Phase 2.
 *
 * key  = uppercase canonical — used for MerchantRule lookup
 * display = title-cased — used in UI
 *
 * Pipeline order matters: location suffixes stripped first so *REF patterns
 * that include location aren't confused with brand names.
 */

// --------------------------------------------------------------------------
// Title-case helper
// --------------------------------------------------------------------------
const ALWAYS_UPPER = new Set(["LLC", "LLP", "USA", "US", "TSA", "ATM", "IRS", "SBA", "USPS", "UPS", "DHL"])
const ALWAYS_LOWER = new Set(["a", "an", "and", "at", "but", "by", "for", "in", "nor", "of", "on", "or", "so", "the", "to", "up", "via", "yet"])

function toTitleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/\s+/)
    .map((word, i) => {
      if (ALWAYS_UPPER.has(word.toUpperCase())) return word.toUpperCase()
      if (i > 0 && ALWAYS_LOWER.has(word)) return word
      return word.charAt(0).toUpperCase() + word.slice(1)
    })
    .join(" ")
}

// --------------------------------------------------------------------------
// Core normalizer
// --------------------------------------------------------------------------

export interface NormalizedMerchant {
  /** Uppercase canonical key — used for MerchantRule lookup */
  key: string
  /** Title-cased display name — shown in UI */
  display: string
}

export function normalizeMerchant(raw: string): NormalizedMerchant {
  let s = raw.trim()

  if (!s) return { key: "UNKNOWN", display: "Unknown" }

  // Step 1: Strip processor prefix (SQ *, TST*, PAYPAL *, SP *, POS, etc.)
  s = s
    .replace(
      /^(SQ\s?\*|TST\*?\s*|PAYPAL\s?\*|SP\s?\*|IC\*|PY\s?\*|POS\s+(?:PURCHASE\s+)?|DEBIT\s+PURCHASE\s+|CKCARD\s+|ACH\s+DEBIT\s+|POINT\s+OF\s+SALE\s+|PREAUTHORIZED\s+CREDIT\s+|RECURRING\s+CHARGE\s+)/i,
      ""
    )
    .trim()

  // Step 2: Strip trailing phone — optionally followed by 2-letter state
  // Covers: 555-555-5555, (555)555-5555, and Amex-style 402-9357733
  s = s
    .replace(
      /\s+(?:\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}|\d{3}-\d{7})(?:\s+[A-Z]{2})?\s*$/,
      ""
    )
    .trim()

  // Step 3: Strip trailing ZIP (with optional trailing state)
  s = s.replace(/\s+\d{5}(?:-\d{4})?(?:\s+[A-Z]{2})?\s*$/, "").trim()

  // Step 4: Strip single-word city + state suffix.
  // Require city word ≥6 chars to avoid stripping brand words like "KING" (4), "ROOM" (4).
  // Real cities like ANCHORAGE (9), CHARLESTON (10), VALDEZ (6) pass; "KING TX" doesn't.
  // Two-word cities (LAS VEGAS, NEW YORK) are handled imperfectly — state-only strip below catches the state.
  s = s.replace(/\s+[A-Z][A-Za-z.'-]{5,}\s+[A-Z]{2}\s*$/, "").trim()

  // Step 5: Strip any remaining trailing 2-letter state abbreviation
  s = s.replace(/\s+[A-Z]{2}\s*$/, "").trim()

  // Step 6: Strip trailing MM/DD date
  s = s.replace(/\s+\d{2}\/\d{2}\s*$/, "").trim()

  // Step 7: Strip *REF suffix (now that location is gone)
  // e.g. "AMAZON.COM*8W9PNDMS" → "AMAZON.COM"
  // Only strip when ref after * has no vowels (clearly a code, not a real word)
  s = s
    .replace(/\*([A-Z0-9]{4,})\s*$/i, (_, ref) =>
      /[AEIOU]/i.test(ref) ? `*${ref}` : ""
    )
    .trim()

  // Step 8: Strip space-separated alphanum ref suffix (last token, no vowels, 6+ chars)
  // e.g. "NETFLIX.COM 8F3B2D" → "NETFLIX.COM"; "SHELL OIL 12345678901" → "SHELL OIL"
  {
    const parts = s.split(/\s+/)
    const last = parts.at(-1) ?? ""
    if (
      parts.length > 1 &&
      last.length >= 6 &&
      /^[A-Z0-9]+$/i.test(last) &&
      !/[AEIOU]/i.test(last)
    ) {
      s = parts.slice(0, -1).join(" ").trim()
    }
  }

  // Step 9: Strip trailing "#XXXXX" where XXXXX is 5+ digits (ref number, not store number)
  // #0147 (4 digits) is kept as a store number; #00293847 (8 digits) is stripped
  s = s.replace(/\s+#\d{5,}\s*$/, "").trim()

  // Step 10: Strip dangling trailing asterisk
  s = s.replace(/\*\s*$/, "").trim()

  // Step 11: Normalize internal whitespace
  s = s.replace(/\s+/g, " ").trim()

  // Fallback: if result collapsed to <2 chars, use original
  if (s.length < 2) {
    const fallback = raw.trim().replace(/\s+/g, " ")
    if (!fallback) return { key: "UNKNOWN", display: "Unknown" }
    return { key: fallback.toUpperCase(), display: toTitleCase(fallback) }
  }

  return {
    key: s.toUpperCase(),
    display: toTitleCase(s),
  }
}
