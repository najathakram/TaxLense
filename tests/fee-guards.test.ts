/**
 * B2/B3 — Fee guard invariants used by Merchant Intelligence and Residual.
 *
 * Pure unit tests on the shared `applyFeeGuards` function.
 *  - Cash-advance interest, late fees, etc → PERSONAL with §163(h).
 *  - MEALS_* with 0% business → PERSONAL (invalid state).
 *  - Normal merchants pass through unchanged.
 */
import { describe, it, expect } from "vitest"
import { applyFeeGuards, isNondeductibleFee } from "../lib/ai/feeGuards"

const baseRule = {
  code: "WRITE_OFF" as const,
  scheduleCLine: "Line 27a Other Expenses" as string | null,
  businessPct: 100,
  ircCitations: ["§162"],
  evidenceTier: 3,
  reasoning: "AI thought this was deductible",
  requiresHumanInput: false,
  humanQuestion: null as string | null,
  confidence: 0.9,
}

describe("isNondeductibleFee", () => {
  it("matches CC fee patterns case-insensitively", () => {
    expect(isNondeductibleFee("CASH ADVANCE INTEREST CHARGE")).toBe(true)
    expect(isNondeductibleFee("INTEREST CHARGE ON PURCHASES")).toBe(true)
    expect(isNondeductibleFee("LATE FEE")).toBe(true)
    expect(isNondeductibleFee("ANNUAL MEMBERSHIP FEE")).toBe(true)
    expect(isNondeductibleFee("FOREIGN TRANSACTION FEE")).toBe(true)
    expect(isNondeductibleFee("OVERLIMIT FEE")).toBe(true)
    expect(isNondeductibleFee("RETURNED PAYMENT FEE")).toBe(true)
    expect(isNondeductibleFee("Returned Payment")).toBe(true)
  })

  it("does not match normal merchants that contain similar substrings", () => {
    expect(isNondeductibleFee("AMAZON.COM")).toBe(false)
    expect(isNondeductibleFee("LATE NIGHT DINER")).toBe(false) // not "LATE FEE"
    expect(isNondeductibleFee("INTEREST GROUP CONFERENCE")).toBe(false) // not "INTEREST CHARGE"
  })
})

describe("applyFeeGuards — non-deductible fees", () => {
  it("forces CASH ADVANCE INTEREST CHARGE to PERSONAL with §163(h)", () => {
    const out = applyFeeGuards(baseRule, "CASH ADVANCE INTEREST CHARGE")
    expect(out.code).toBe("PERSONAL")
    expect(out.businessPct).toBe(0)
    expect(out.scheduleCLine).toBeNull()
    expect(out.ircCitations).toContain("§163(h)")
    expect(out.requiresHumanInput).toBe(false)
  })

  it("forces LATE FEE to PERSONAL even if the AI marked it WRITE_OFF 100%", () => {
    const out = applyFeeGuards({ ...baseRule, code: "WRITE_OFF", businessPct: 100 }, "LATE FEE")
    expect(out.code).toBe("PERSONAL")
    expect(out.businessPct).toBe(0)
  })
})

describe("applyFeeGuards — MEALS at 0%", () => {
  it("demotes MEALS_50 with businessPct=0 to PERSONAL", () => {
    const out = applyFeeGuards(
      { ...baseRule, code: "MEALS_50", businessPct: 0, scheduleCLine: "Line 24b Meals", ircCitations: ["§162", "§274(d)"] },
      "MCDONALDS",
    )
    expect(out.code).toBe("PERSONAL")
    expect(out.businessPct).toBe(0)
    expect(out.scheduleCLine).toBeNull()
    expect(out.ircCitations).toEqual(["§262"])
  })

  it("demotes MEALS_100 with businessPct=0 to PERSONAL", () => {
    const out = applyFeeGuards(
      { ...baseRule, code: "MEALS_100", businessPct: 0 },
      "JAMBA JUICE",
    )
    expect(out.code).toBe("PERSONAL")
  })

  it("leaves MEALS_50 with businessPct>0 untouched", () => {
    const r = { ...baseRule, code: "MEALS_50" as const, businessPct: 100 }
    const out = applyFeeGuards(r, "BUSINESS LUNCH SPOT")
    expect(out.code).toBe("MEALS_50")
    expect(out.businessPct).toBe(100)
  })
})

describe("applyFeeGuards — normal merchants", () => {
  it("returns the rule unchanged for ordinary write-offs", () => {
    const out = applyFeeGuards(baseRule, "STAPLES")
    expect(out.code).toBe("WRITE_OFF")
    expect(out.businessPct).toBe(100)
    expect(out.scheduleCLine).toBe("Line 27a Other Expenses")
  })
})
