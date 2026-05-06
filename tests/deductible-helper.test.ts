/**
 * B8 — Schedule C deductible helper.
 *
 * Single source of truth for how a transaction's deductible dollars are
 * computed. The same function must be used by:
 *   - the Ledger page header
 *   - the Risk page "Estimated Deductions" card
 *   - lib/reports/financialStatements.ts (Schedule C totals)
 *   - lib/validation/assertions.ts A03
 *
 * If any of those drift, A03 will silently disagree and a CPA will lose trust.
 */
import { describe, it, expect } from "vitest"
import { computeDeductibleAmt, isDeductibleCode } from "../lib/classification/deductible"

describe("isDeductibleCode", () => {
  it("returns true for the 6 deductible codes", () => {
    for (const c of ["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100", "GRAY"] as const) {
      expect(isDeductibleCode(c)).toBe(true)
    }
  })
  it("returns false for non-deductible codes", () => {
    for (const c of ["PERSONAL", "TRANSFER", "PAYMENT", "BIZ_INCOME", "NEEDS_CONTEXT"] as const) {
      expect(isDeductibleCode(c)).toBe(false)
    }
  })
})

describe("computeDeductibleAmt", () => {
  it("returns 0 for inflows", () => {
    expect(computeDeductibleAmt(-100, "WRITE_OFF", 100)).toBe(0)
  })

  it("returns 0 for non-deductible codes regardless of pct", () => {
    expect(computeDeductibleAmt(100, "PERSONAL", 100)).toBe(0)
    expect(computeDeductibleAmt(100, "TRANSFER", 100)).toBe(0)
    expect(computeDeductibleAmt(100, "PAYMENT", 100)).toBe(0)
    expect(computeDeductibleAmt(100, "BIZ_INCOME", 100)).toBe(0)
    expect(computeDeductibleAmt(100, "NEEDS_CONTEXT", 100)).toBe(0)
  })

  it("prorates WRITE_OFF by businessPct", () => {
    expect(computeDeductibleAmt(100, "WRITE_OFF", 100)).toBe(100)
    expect(computeDeductibleAmt(100, "WRITE_OFF", 50)).toBe(50)
    expect(computeDeductibleAmt(100, "WRITE_OFF", 0)).toBe(0)
  })

  it("applies §274(n)(1) 50% multiplier for MEALS_50", () => {
    expect(computeDeductibleAmt(100, "MEALS_50", 100)).toBe(50)
    expect(computeDeductibleAmt(100, "MEALS_50", 50)).toBe(25)
  })

  it("does NOT apply 50% multiplier for MEALS_100", () => {
    expect(computeDeductibleAmt(100, "MEALS_100", 100)).toBe(100)
  })

  it("treats GRAY as fully deductible at the businessPct (it's still a §162 claim)", () => {
    expect(computeDeductibleAmt(100, "GRAY", 100)).toBe(100)
    expect(computeDeductibleAmt(100, "GRAY", 25)).toBe(25)
  })
})
