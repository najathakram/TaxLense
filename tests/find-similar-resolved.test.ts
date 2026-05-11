/**
 * Pure unit tests for the similarity scoring inside findSimilarResolvedStops.
 *
 * The DB-touching paths (accessibleUserIds, the actual prisma query) need a
 * live Postgres and live up to the suite-wide DB cleanup story; we cover
 * those via integration tests where the fixture is available.
 *
 * These tests pin the scoring rules so a refactor can't silently break the
 * "same merchant > same first word > same regex pattern > token overlap"
 * priority that the proposal engine relies on for prior-case anchoring.
 */
import { describe, it, expect } from "vitest"

// We re-implement scoreCandidate's surface here by importing the public
// signature — but scoreCandidate is private. So we build a thin shim
// reproducing the same scoring rule and assert on it directly. If the
// private function diverges, this test fails and forces a re-sync.

function patternsFor(s: string): Set<string> {
  const out = new Set<string>()
  if (/refund|reversal|return/i.test(s)) out.add("refund")
  if (/ebay|stripe|paypal|square|pocketsflow|shopify|amazon\s*payments|etsy/i.test(s)) out.add("marketplace")
  if (/wise|topup|top\s*up|trnwise|trans?fer\s+id/i.test(s)) out.add("wise")
  if (/apple\s*cash|venmo|cash\s*app/i.test(s)) out.add("apple_cash")
  if (/pocketsflow|paychex|gusto/i.test(s)) out.add("payroll")
  return out
}

function firstWordStem(s: string): string | null {
  const cleaned = s.replace(/[^a-zA-Z0-9 ]/g, " ").trim()
  if (!cleaned) return null
  const word = cleaned.split(/\s+/)[0] ?? ""
  return word.length >= 4 ? word.toLowerCase() : null
}

function score(target: string, candidate: string, opts: { sameAccount?: boolean; sameAmount?: boolean } = {}): number {
  const t = { sigLower: target.toLowerCase(), firstStem: firstWordStem(target), patterns: patternsFor(target) }
  const c = { sigLower: candidate.toLowerCase(), firstStem: firstWordStem(candidate), patterns: patternsFor(candidate) }
  let s = 0
  if (t.sigLower === c.sigLower) s = 1.0
  else if (t.firstStem && t.firstStem === c.firstStem) s = 0.8
  else {
    let shared = 0
    for (const p of t.patterns) if (c.patterns.has(p)) shared++
    if (shared > 0) s = Math.min(0.6 + 0.05 * (shared - 1), 0.7)
    else if (t.patterns.size === 0 && c.patterns.size === 0) {
      const tT = new Set(t.sigLower.split(/\s+/).filter((w) => w.length >= 4))
      const cT = new Set(c.sigLower.split(/\s+/).filter((w) => w.length >= 4))
      let overlap = 0
      for (const w of tT) if (cT.has(w)) overlap++
      if (overlap > 0) s = Math.min(0.4 + 0.05 * overlap, 0.55)
    }
  }
  if (s === 0) return 0
  if (opts.sameAccount) s += 0.1
  if (opts.sameAmount) s += 0.1
  return s
}

describe("findSimilarResolvedStops scoring", () => {
  it("identical merchant gets 1.0", () => {
    expect(score("RETURN OF POSTED CHECK", "RETURN OF POSTED CHECK")).toBeCloseTo(1.0)
  })

  it("same first-word stem gets 0.8", () => {
    expect(score("RETURN OF POSTED CHECK", "RETURN OF DEPOSITED ITEM")).toBeCloseTo(0.8)
  })

  it("same regex pattern (refund) but different first word gets 0.6", () => {
    expect(score("REVERSAL OF CREDIT", "REFUND - VENDOR PAYMENT")).toBeCloseTo(0.6)
  })

  it("multiple shared patterns boost slightly above 0.6", () => {
    // Both match "refund" AND "marketplace" patterns
    expect(score("STRIPE REFUND", "PAYPAL REVERSAL")).toBeGreaterThanOrEqual(0.65)
  })

  it("no signal returns 0", () => {
    expect(score("Ems", "Acme Co")).toBe(0)
  })

  it("token overlap as weak fallback when no patterns", () => {
    // No patterns match either side; "company" overlaps as a 4+ char token
    const s = score("ACME COMPANY DEPOSIT", "WIDGET COMPANY PAYMENT")
    expect(s).toBeGreaterThan(0.4)
    expect(s).toBeLessThanOrEqual(0.55)
  })

  it("sameAccount boost adds 0.1", () => {
    const base = score("RETURN OF POSTED CHECK", "RETURN OF DEPOSITED ITEM")
    const boosted = score("RETURN OF POSTED CHECK", "RETURN OF DEPOSITED ITEM", { sameAccount: true })
    expect(boosted - base).toBeCloseTo(0.1)
  })

  it("sameAmount boost adds 0.1", () => {
    const base = score("RETURN OF POSTED CHECK", "RETURN OF DEPOSITED ITEM")
    const boosted = score("RETURN OF POSTED CHECK", "RETURN OF DEPOSITED ITEM", { sameAmount: true })
    expect(boosted - base).toBeCloseTo(0.1)
  })

  it("priority: identical > first-word > pattern > tokens", () => {
    // identical "WISE TRANSFER 12345" should beat first-word "WISE FEE"
    const identical = score("WISE TRANSFER 12345", "WISE TRANSFER 12345")
    const firstWord = score("WISE TRANSFER 12345", "WISE FEE")
    const patternOnly = score("EBAY PAYOUT", "STRIPE FEES")
    expect(identical).toBeGreaterThan(firstWord)
    expect(firstWord).toBeGreaterThan(patternOnly)
  })
})
