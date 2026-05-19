/**
 * §274(d) hard-rail guard — pure-function tests.
 *
 * These tests are the BUREAU OF THE LINE. Every forbidden merchant pattern
 * and every forbidden code combination MUST be rejected by
 * assertNot274dCohan. Future additions to SECTION_274D_MERCHANT_FRAGMENTS
 * SHOULD add a corresponding test case here.
 *
 * If any of these tests starts failing, an actual §274(d) row could end up
 * with cohanFlag=true — a hard-rail violation. The framework's no-§274(d)-
 * Cohan promise depends on these tests passing.
 */

import { describe, it, expect } from "vitest"
import {
  assertNot274dCohan,
  isSection274dCandidate,
  SECTION_274D_MERCHANT_FRAGMENTS,
  SECTION_274D_CODES,
} from "../lib/classification/cohanGuards"

describe("assertNot274dCohan — code bright line", () => {
  for (const code of SECTION_274D_CODES) {
    it(`rejects ${code} (§274(d) category code)`, () => {
      const r = assertNot274dCohan({ code, merchantRaw: "FOOD WORLD" })
      expect(r.allowed).toBe(false)
      expect(r.reason).toMatch(/§274\(d\)/)
    })
  }

  it("allows WRITE_OFF (generic §162 category)", () => {
    const r = assertNot274dCohan({ code: "WRITE_OFF", merchantRaw: "STRIPE PROCESSING" })
    expect(r.allowed).toBe(true)
  })

  it("allows WRITE_OFF_COGS (Part III)", () => {
    const r = assertNot274dCohan({ code: "WRITE_OFF_COGS", merchantRaw: "SUPPLIER ALI" })
    expect(r.allowed).toBe(true)
  })

  it("allows GRAY (escape hatch)", () => {
    const r = assertNot274dCohan({ code: "GRAY", merchantRaw: "AUTHNET" })
    expect(r.allowed).toBe(true)
  })
})

describe("assertNot274dCohan — citation bright line", () => {
  it("rejects classification carrying §274(d) citation regardless of code", () => {
    const r = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "X",
      ircCitations: ["§162", "§274(d)"],
    })
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/§274\(d\)/)
  })

  it("allows §162-only classification", () => {
    const r = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "STRIPE",
      ircCitations: ["§162", "Cohan"],
    })
    expect(r.allowed).toBe(true)
  })
})

describe("assertNot274dCohan — Schedule C line bright line", () => {
  it("rejects Line 24a Travel", () => {
    const r = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "X",
      scheduleCLine: "Line 24a Travel",
    })
    expect(r.allowed).toBe(false)
  })
  it("rejects Line 24b Meals", () => {
    const r = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "X",
      scheduleCLine: "Line 24b Meals",
    })
    expect(r.allowed).toBe(false)
  })
  it("rejects Line 9 Car and Truck Expenses", () => {
    const r = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "X",
      scheduleCLine: "Line 9 Car and Truck Expenses",
    })
    expect(r.allowed).toBe(false)
  })
  it("allows Line 27a Other Expenses", () => {
    const r = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "STRIPE FEE",
      scheduleCLine: "Line 27a Other Expenses",
    })
    expect(r.allowed).toBe(true)
  })
})

describe("assertNot274dCohan — merchant fragment bright line", () => {
  // Sample every fragment with an exact-substring example
  const fragmentExamples: Array<[string, string]> = [
    ["UBER", "UBER *TRIP NYC 6/15"],
    ["LYFT", "LYFT *RIDE OAKLAND"],
    ["GAS ", "76 GAS STATION TX"],
    ["FUEL", "BP FUEL PURCHASE"],
    ["EXXON", "EXXONMOBIL 12345"],
    ["CHEVRON", "CHEVRON GASOLINE"],
    ["RENTAL CAR", "RENTAL CAR DENVER"],
    ["HERTZ", "HERTZ RENT-A-CAR"],
    ["AIRLINES", "DELTA AIRLINES NYC"],
    ["AIRWAYS", "BRITISH AIRWAYS LON"],
    ["HOTEL", "MARRIOTT HOTEL SF"],
    ["MARRIOTT", "MARRIOTT BONVOY"],
    ["HILTON", "HILTON GARDEN INN"],
    ["AIRBNB", "AIRBNB STAY LON"],
    ["RESTAURANT", "ALA RESTAURANT INC"],
    ["STARBUCKS", "STARBUCKS #1234"],
    ["CHIPOTLE", "CHIPOTLE MEXICAN GRILL"],
    ["DOORDASH", "DOORDASH FOOD"],
    ["UBER EATS", "UBER EATS SF"],
    ["GIFT", "MACY'S GIFT CARD"],
    ["FLOWERS", "1-800-FLOWERS.COM"],
  ]
  for (const [fragment, merchantRaw] of fragmentExamples) {
    it(`rejects ${merchantRaw} (matches "${fragment}")`, () => {
      const r = assertNot274dCohan({ code: "WRITE_OFF", merchantRaw })
      expect(r.allowed).toBe(false)
      expect(r.reason).toContain("§274(d)")
    })
  }

  it("allows non-§274(d) merchants (POCKETSFLOW)", () => {
    const r = assertNot274dCohan({ code: "WRITE_OFF", merchantRaw: "POCKETSFLOW TRANSFER" })
    expect(r.allowed).toBe(true)
  })

  it("allows generic merchant (CLUE ACH)", () => {
    const r = assertNot274dCohan({ code: "WRITE_OFF", merchantRaw: "CLUE ACH AUTHNET" })
    expect(r.allowed).toBe(true)
  })

  it("allows Stripe processing fee", () => {
    const r = assertNot274dCohan({ code: "WRITE_OFF", merchantRaw: "STRIPE FEE 2.9% + 30c" })
    expect(r.allowed).toBe(true)
  })

  it("is case-insensitive (matches lowercase 'uber')", () => {
    const r = assertNot274dCohan({ code: "WRITE_OFF", merchantRaw: "uber trip" })
    expect(r.allowed).toBe(false)
  })
})

describe("assertNot274dCohan — combined checks", () => {
  it("rejects a row that passes code+citation but matches merchant", () => {
    const r = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "STARBUCKS #1234",
      ircCitations: ["§162"],
    })
    expect(r.allowed).toBe(false)
    expect(r.matchedFragment).toBe("STARBUCKS")
  })

  it("rejects a row that passes merchant+citation but uses MEALS_50 code", () => {
    const r = assertNot274dCohan({
      code: "MEALS_50",
      merchantRaw: "POCKETSFLOW",
      ircCitations: ["§162"],
    })
    expect(r.allowed).toBe(false)
  })

  it("allows a fully clean §162 Cohan candidate", () => {
    const r = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "STRIPE PROCESSING FEE",
      ircCitations: ["§162", "Cohan"],
      scheduleCLine: "Line 27a Other Expenses",
    })
    expect(r.allowed).toBe(true)
  })
})

describe("isSection274dCandidate — substantiation queue input", () => {
  it("returns true for a §274(d) merchant", () => {
    expect(isSection274dCandidate("STARBUCKS #1234")).toBe(true)
    expect(isSection274dCandidate("HILTON GARDEN INN")).toBe(true)
    expect(isSection274dCandidate("uber trip")).toBe(true)
  })

  it("returns false for a non-§274(d) merchant", () => {
    expect(isSection274dCandidate("CLUE ACH AUTHNET")).toBe(false)
    expect(isSection274dCandidate("STRIPE")).toBe(false)
    expect(isSection274dCandidate("POCKETSFLOW")).toBe(false)
  })

  it("returns false for empty input", () => {
    expect(isSection274dCandidate(null)).toBe(false)
    expect(isSection274dCandidate(undefined)).toBe(false)
    expect(isSection274dCandidate("")).toBe(false)
  })
})

describe("SECTION_274D_MERCHANT_FRAGMENTS — vocabulary coverage", () => {
  it("includes the four major §274(d) categories", () => {
    const all = SECTION_274D_MERCHANT_FRAGMENTS.join(" ").toUpperCase()
    // Vehicle / fuel
    expect(all).toContain("UBER")
    expect(all).toContain("FUEL")
    // Air travel
    expect(all).toContain("AIRLINES")
    // Lodging
    expect(all).toContain("HOTEL")
    // Meals
    expect(all).toContain("RESTAURANT")
    // Gifts
    expect(all).toContain("GIFT")
  })
})
