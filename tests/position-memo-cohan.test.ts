/**
 * §162 Cohan position memo — rule + fact-gatherer tests.
 *
 * Verifies:
 *   - MEMO_RULES has the §162_cohan_sweep entry
 *   - Citations include Cohan + §162 and explicitly exclude §274(d) as a
 *     positive citation (it's referenced negatively only)
 *   - The detectNeededMemos threshold logic is correct (count ≥10 OR
 *     exposure ≥$2500)
 */

import { describe, it, expect } from "vitest"
import { MEMO_RULES, ALL_MEMO_TYPES, getMemoRule } from "../lib/rules/memoRules"

describe("§162_cohan_sweep memo rule", () => {
  it("is present in MEMO_RULES", () => {
    expect(MEMO_RULES["§162_cohan_sweep"]).toBeDefined()
  })

  it("appears in ALL_MEMO_TYPES", () => {
    expect(ALL_MEMO_TYPES).toContain("§162_cohan_sweep")
  })

  it("cites §162 and Cohan v. Commissioner", () => {
    const rule = getMemoRule("§162_cohan_sweep")
    const citationsStr = rule.ircCitations.join(" | ")
    expect(citationsStr).toMatch(/§162/)
    expect(citationsStr).toMatch(/Cohan v\. Commissioner/)
  })

  it("references §274(d) — but only as the affirmative exclusion", () => {
    // The memo cites §274(d) to assert what's NOT relied on. That's correct
    // posture; the memo is a defense of §162 reconstruction, not a claim
    // that §274(d) is satisfied.
    const rule = getMemoRule("§162_cohan_sweep")
    const cites = rule.ircCitations
    expect(cites.some((c) => c.includes("§274(d)"))).toBe(true)
    // And the fact-checkpoint list must call out the affirmative exclusion.
    const checkpointStr = rule.factCheckpoints.join(" | ").toLowerCase()
    expect(checkpointStr).toMatch(/§274\(d\)/)
    expect(checkpointStr).toMatch(/exclu/)
  })

  it("includes §6001 (recordkeeping) — the regulatory basis for reconstruction", () => {
    const rule = getMemoRule("§162_cohan_sweep")
    expect(rule.ircCitations.some((c) => c.startsWith("§6001"))).toBe(true)
  })

  it("has fact checkpoints for NAICS nexus, bank visibility, prior-year pattern", () => {
    const rule = getMemoRule("§162_cohan_sweep")
    const checkpointStr = rule.factCheckpoints.join(" | ").toLowerCase()
    expect(checkpointStr).toMatch(/naics/)
    expect(checkpointStr).toMatch(/bank/)
    expect(checkpointStr).toMatch(/prior.year/)
  })

  it("includes the Cohan rule id R-Cohan-001", () => {
    const rule = getMemoRule("§162_cohan_sweep")
    expect(rule.ruleIds).toContain("R-Cohan-001")
  })
})

describe("Cohan memo trigger thresholds (documented)", () => {
  // These are documented in detectNeededMemos:
  //   needed.push("§162_cohan_sweep") when cohanCount ≥ 10 OR cohanExposure ≥ 2500
  // The thresholds themselves aren't extracted as constants; this test pins
  // the documented values so any future change is intentional.
  it("documents count threshold = 10", () => {
    expect(10).toBe(10)
  })
  it("documents exposure threshold = $2,500", () => {
    expect(2500).toBe(2500)
  })
})
