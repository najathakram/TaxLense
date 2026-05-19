/**
 * Financial-statements quality-upgrade — pure-function tests for the new
 * supporting modules: code→fill semantic mapping + Line 27a sub-category
 * classification.
 *
 * No DB dependency. Tests the deterministic logic that drives the new
 * visual + grouping behavior of the upgraded XLSX output.
 */

import { describe, it, expect } from "vitest"
import {
  classifySemanticFill,
  semanticFillFor,
} from "../lib/reports/codeFillsBySemantics"
import {
  classifyLine27aSubCategory,
  isLine27a,
  LINE_27A_SUBCATEGORY_DISPLAY_ORDER,
} from "../lib/reports/sch_c_subcategories"
import { FILL_SEMANTICS } from "../lib/reports/financialStatementsStyles"

describe("classifySemanticFill — code → semantic fill class", () => {
  it("maps MEALS_100 to contentMeals100 (mint)", () => {
    expect(classifySemanticFill("MEALS_100", 100, "Line 24b Meals")).toBe("contentMeals100")
  })

  it("maps MEALS_50 to partialDeduction50 (blue)", () => {
    expect(classifySemanticFill("MEALS_50", 100, "Line 24b Meals")).toBe("partialDeduction50")
  })

  it("maps GRAY to grayZone (yellow)", () => {
    expect(classifySemanticFill("GRAY", 50, "Line 27a Other Expenses")).toBe("grayZone")
  })

  it("maps WRITE_OFF at 100% to writeOff100 (green)", () => {
    expect(classifySemanticFill("WRITE_OFF", 100, "Line 17 Legal & Professional")).toBe("writeOff100")
  })

  it("maps WRITE_OFF at 65% biz to allocatedPartial (pink) for interest", () => {
    expect(classifySemanticFill("WRITE_OFF", 65, "Line 16b Interest")).toBe("allocatedPartial")
  })

  it("maps WRITE_OFF_COGS to writeOff100 (green) at 100%", () => {
    expect(classifySemanticFill("WRITE_OFF_COGS", 100, "Part III COGS")).toBe("writeOff100")
  })

  it("maps vehicle-line WRITE_OFF at 50% to partialDeduction50 (blue)", () => {
    expect(classifySemanticFill("WRITE_OFF", 50, "Line 9 Car & Truck")).toBe("partialDeduction50")
  })

  it("maps WRITE_OFF_TRAVEL at <100% to partialDeduction50", () => {
    expect(classifySemanticFill("WRITE_OFF_TRAVEL", 75, "Line 24a Travel")).toBe("partialDeduction50")
  })

  it("maps WRITE_OFF_TRAVEL at 100% to writeOff100", () => {
    expect(classifySemanticFill("WRITE_OFF_TRAVEL", 100, "Line 24a Travel")).toBe("writeOff100")
  })

  it("returns none for PERSONAL / TRANSFER / PAYMENT / BIZ_INCOME / NEEDS_CONTEXT", () => {
    expect(classifySemanticFill("PERSONAL", 0, null)).toBe("none")
    expect(classifySemanticFill("TRANSFER", 0, null)).toBe("none")
    expect(classifySemanticFill("PAYMENT", 0, null)).toBe("none")
    expect(classifySemanticFill("BIZ_INCOME", 0, null)).toBe("none")
    expect(classifySemanticFill("NEEDS_CONTEXT", 0, null)).toBe("none")
  })
})

describe("semanticFillFor — returns ExcelJS Fill or undefined", () => {
  it("returns a Fill object for MEALS_100", () => {
    const fill = semanticFillFor("MEALS_100", 100, "Line 24b Meals")
    expect(fill).toBeDefined()
    expect(fill!.type).toBe("pattern")
    // @ts-expect-error - ExcelJS Fill union types
    expect(fill!.fgColor?.argb).toBe(FILL_SEMANTICS.contentMeals100)
  })

  it("returns undefined for PERSONAL", () => {
    expect(semanticFillFor("PERSONAL", 0, null)).toBeUndefined()
  })

  it("returns correct argb for allocatedPartial (pink)", () => {
    const fill = semanticFillFor("WRITE_OFF", 65, "Line 16b Interest")
    expect(fill).toBeDefined()
    // @ts-expect-error - ExcelJS Fill union types
    expect(fill!.fgColor?.argb).toBe(FILL_SEMANTICS.allocatedPartial)
  })
})

describe("classifyLine27aSubCategory — merchant → sub-category", () => {
  it("classifies Robinhood as Robinhood Card", () => {
    expect(classifyLine27aSubCategory("ROBINHOOD CARD CHARGE")).toBe("Robinhood Card")
    expect(classifyLine27aSubCategory("Robinhood Markets")).toBe("Robinhood Card")
  })

  it("classifies fuel + auto parts as Auto Expense", () => {
    expect(classifyLine27aSubCategory("EXXON #4567")).toBe("Auto Expense")
    expect(classifyLine27aSubCategory("Costco Gas #1208 — Cypress")).toBe("Auto Expense")
    expect(classifyLine27aSubCategory("CHEVRON STATION")).toBe("Auto Expense")
    expect(classifyLine27aSubCategory("autozone")).toBe("Auto Expense")
  })

  it("classifies travel merchants as Travel", () => {
    expect(classifyLine27aSubCategory("DELTA AIR LINES")).toBe("Travel")
    expect(classifyLine27aSubCategory("Marriott Bonvoy SF")).toBe("Travel")
    expect(classifyLine27aSubCategory("UBER *TRIP")).toBe("Travel")
    expect(classifyLine27aSubCategory("Airbnb stay London")).toBe("Travel")
    expect(classifyLine27aSubCategory("HERTZ RENT-A-CAR")).toBe("Travel")
  })

  it("classifies SaaS / cloud as Subscriptions", () => {
    expect(classifyLine27aSubCategory("Adobe Creative Cloud")).toBe("Subscriptions")
    expect(classifyLine27aSubCategory("Google Workspace")).toBe("Subscriptions")
    expect(classifyLine27aSubCategory("APPLE.COM/BILL")).toBe("Subscriptions")
    expect(classifyLine27aSubCategory("github plans")).toBe("Subscriptions")
    expect(classifyLine27aSubCategory("OPENAI API")).toBe("Subscriptions")
  })

  it("classifies clothing/grooming merchants", () => {
    expect(classifyLine27aSubCategory("Nordstrom Mens")).toBe("Clothing & Grooming")
    expect(classifyLine27aSubCategory("hair salon downtown")).toBe("Clothing & Grooming")
    expect(classifyLine27aSubCategory("ULTA BEAUTY")).toBe("Clothing & Grooming")
  })

  it("classifies bank-fee patterns", () => {
    expect(classifyLine27aSubCategory("CHASE BANK Monthly Service Fee")).toBe("Card & Bank Fees")
    expect(classifyLine27aSubCategory("ANNUAL FEE — AMEX PLATINUM")).toBe("Card & Bank Fees")
    expect(classifyLine27aSubCategory("WISE CHARGES FEE-TRANSFER-001")).toBe("Card & Bank Fees")
    expect(classifyLine27aSubCategory("Stripe processing fee")).toBe("Card & Bank Fees")
  })

  it("classifies cash advance interest as Bank Interest (not Card & Bank Fees)", () => {
    expect(classifyLine27aSubCategory("CASH ADVANCE INTEREST CHARGE")).toBe("Bank Interest")
    expect(classifyLine27aSubCategory("Finance charge — Robinhood")).toBe("Bank Interest")
  })

  it("classifies props/supplies merchants", () => {
    expect(classifyLine27aSubCategory("ROSS STORE #2673")).toBe("Props & Supplies")
    expect(classifyLine27aSubCategory("HOME DEPOT")).toBe("Props & Supplies")
    expect(classifyLine27aSubCategory("Michael's Arts & Crafts")).toBe("Props & Supplies")
  })

  it("falls back to Other for unrecognized merchants", () => {
    expect(classifyLine27aSubCategory("RANDOM UNRECOGNIZED VENDOR")).toBe("Other")
    expect(classifyLine27aSubCategory("XYZ123 ACH PAYMENT")).toBe("Other")
  })

  it("handles null / empty input", () => {
    expect(classifyLine27aSubCategory(null)).toBe("Other")
    expect(classifyLine27aSubCategory("")).toBe("Other")
    expect(classifyLine27aSubCategory(undefined)).toBe("Other")
  })

  it("ordering: more-specific rules win first (cash advance interest doesn't match Card & Bank Fees)", () => {
    // "Cash Advance Interest Charge" contains "Interest" which matches Bank Interest rule.
    // Tests that interest is matched first before card-fee patterns.
    expect(classifyLine27aSubCategory("CASH ADVANCE INTEREST CHARGE")).toBe("Bank Interest")
  })
})

describe("isLine27a — line string detection", () => {
  it("matches canonical 'Line 27a Other Expenses'", () => {
    expect(isLine27a("Line 27a Other Expenses")).toBe(true)
  })

  it("matches legacy 'Line 27a' alone", () => {
    expect(isLine27a("Line 27a")).toBe(true)
  })

  it("matches with different capitalization / spacing", () => {
    expect(isLine27a("LINE 27a")).toBe(true)
    expect(isLine27a("line  27a — other expenses")).toBe(true)
  })

  it("does NOT match other lines", () => {
    expect(isLine27a("Line 27")).toBe(false)
    expect(isLine27a("Line 27b")).toBe(false)
    expect(isLine27a("Line 24a Travel")).toBe(false)
    expect(isLine27a("Line 17 Legal & Professional")).toBe(false)
  })

  it("returns false for null / empty", () => {
    expect(isLine27a(null)).toBe(false)
    expect(isLine27a(undefined)).toBe(false)
    expect(isLine27a("")).toBe(false)
  })
})

describe("LINE_27A_SUBCATEGORY_DISPLAY_ORDER — UI ordering", () => {
  it("starts with Travel (highest-priority)", () => {
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER[0]).toBe("Travel")
  })

  it("ends with Other (lowest-priority)", () => {
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER[LINE_27A_SUBCATEGORY_DISPLAY_ORDER.length - 1]).toBe("Other")
  })

  it("contains all 9 categories", () => {
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER.length).toBe(9)
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Travel")
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Subscriptions")
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Auto Expense")
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Props & Supplies")
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Clothing & Grooming")
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Robinhood Card")
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Card & Bank Fees")
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Bank Interest")
    expect(LINE_27A_SUBCATEGORY_DISPLAY_ORDER).toContain("Other")
  })
})

describe("Color palette consistency — visual design system", () => {
  it("has 5 semantic fill classes + none", () => {
    expect(Object.keys(FILL_SEMANTICS).length).toBe(6)
  })

  it("contentMeals100 is the mint green from the reference workbook", () => {
    expect(FILL_SEMANTICS.contentMeals100).toBe("FFD5E8D4")
  })

  it("writeOff100 is the soft green from the reference", () => {
    expect(FILL_SEMANTICS.writeOff100).toBe("FFE2EFDA")
  })

  it("partialDeduction50 is the light blue", () => {
    expect(FILL_SEMANTICS.partialDeduction50).toBe("FFDDEBF7")
  })

  it("grayZone is the light yellow", () => {
    expect(FILL_SEMANTICS.grayZone).toBe("FFFFF2CC")
  })

  it("allocatedPartial is the light pink", () => {
    expect(FILL_SEMANTICS.allocatedPartial).toBe("FFEAD1DC")
  })

  it("none is undefined (no fill applied)", () => {
    expect(FILL_SEMANTICS.none).toBeUndefined()
  })
})
