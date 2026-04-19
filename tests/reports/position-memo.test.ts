/**
 * Position Memo tests.
 *
 * Mocks the Anthropic SDK to avoid real AI calls.
 * Verifies:
 *   - Output contains all four required sections (FACTS / LAW / ANALYSIS / CONCLUSION)
 *   - Model selection: sonnet-4-6 for <$5K exposure, opus-4-7 for ≥$5K
 *   - detectNeededMemos returns correct types for the fixture
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { MEMO_RULES, type MemoType } from "../../lib/rules/memoRules"
import { createReportFixture, destroyReportFixture, type ReportFixture } from "./fixture"

// vi.mock is hoisted — the factory runs before all imports so NO outer variables are accessible
vi.mock("@anthropic-ai/sdk", () => {
  class MockAnthropic {
    messages = {
      create: vi.fn().mockResolvedValue({
        content: [
          {
            type: "text",
            text:
              "FACTS:\nTest taxpayer is a sole proprietor.\n\n" +
              "LAW:\n§183 applies. See Reg. §1.183-2(b).\n\n" +
              "ANALYSIS:\nThe nine factors favor profit intent.\n\n" +
              "CONCLUSION:\nActivity is engaged in for profit based on available evidence.",
          },
        ],
      }),
    }
  }
  return { default: MockAnthropic }
})

// Import AFTER the mock is registered
import { detectNeededMemos, generatePositionMemo } from "../../lib/ai/positionMemo"

describe("position memo generator", () => {
  let fix: ReportFixture

  beforeAll(async () => {
    fix = await createReportFixture()
  })

  afterAll(async () => {
    await destroyReportFixture(fix)
  })

  it("memoRules has all four expected types", () => {
    const types: MemoType[] = ["§183_hobby", "§274n2_100pct_meals", "§280A_home_office", "wardrobe"]
    for (const t of types) {
      expect(MEMO_RULES[t]).toBeDefined()
      expect(MEMO_RULES[t].ircCitations.length).toBeGreaterThan(0)
      expect(MEMO_RULES[t].factCheckpoints.length).toBeGreaterThan(0)
    }
  })

  it("detectNeededMemos returns §280A_home_office for fixture (home office configured)", async () => {
    const needed = await detectNeededMemos(fix.taxYearId)
    // Fixture has homeOfficeConfig.has=true → §280A should be needed
    expect(needed).toContain("§280A_home_office")
  })

  it("detectNeededMemos returns wardrobe for NAICS 711510", async () => {
    const needed = await detectNeededMemos(fix.taxYearId)
    // Fixture has NAICS 711510 → wardrobe should be needed
    expect(needed).toContain("wardrobe")
  })

  it("detectNeededMemos does NOT include §183_hobby when gross revenue > deductions", async () => {
    const needed = await detectNeededMemos(fix.taxYearId)
    // Fixture: gross revenue $20,500 >> deductions ~$4,000 — no loss
    expect(needed).not.toContain("§183_hobby")
  })

  it("generatePositionMemo output contains all four required sections", async () => {
    const result = await generatePositionMemo("§280A_home_office", fix.taxYearId)
    expect(result.text).toContain("FACTS:")
    expect(result.text).toContain("LAW:")
    expect(result.text).toContain("ANALYSIS:")
    expect(result.text).toContain("CONCLUSION:")
  })

  it("generatePositionMemo returns exposure amount and model string", async () => {
    const result = await generatePositionMemo("§280A_home_office", fix.taxYearId)
    expect(result.exposure).toBeGreaterThanOrEqual(0)
    expect(["claude-sonnet-4-6", "claude-opus-4-7"]).toContain(result.modelUsed)
  })

  it("uses sonnet-4-6 when exposure < $5000 (§280A simplified = $500 for 100sqft)", async () => {
    const result = await generatePositionMemo("§280A_home_office", fix.taxYearId)
    // 100 sqft × $5 = $500 → < $5000 → sonnet
    expect(result.modelUsed).toBe("claude-sonnet-4-6")
  })

  it("each of the four required sections appears exactly once in mock output", async () => {
    const result = await generatePositionMemo("§183_hobby", fix.taxYearId)
    const sections = ["FACTS:", "LAW:", "ANALYSIS:", "CONCLUSION:"]
    for (const s of sections) {
      const count = result.text.split(s).length - 1
      expect(count, `${s} should appear exactly once`).toBe(1)
    }
  })
})
