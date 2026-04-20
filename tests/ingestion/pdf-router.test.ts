/**
 * Unit tests for the PDF router (Session 9 §A.1).
 * Pure-function tests; no AI or DB calls.
 */
import { describe, expect, it } from "vitest"
import { routePdf, scorePdfText } from "../../lib/parsers/pdf-router"

describe("scorePdfText", () => {
  it("counts ISO / slash dates and dollar amounts", () => {
    const text = `
      01/15/2025 ADOBE CREATIVE            $54.99
      02/15/2025 CHASE PAYMENT           -$100.00
      03/01/2025 SHELL GAS                $42.50
      04/02/2025 STARBUCKS               $6.75
      05/10/2025 UBER TRIP               $18.00
    `
    const s = scorePdfText(text, 2)
    expect(s.dateHits).toBeGreaterThanOrEqual(5)
    expect(s.dollarHits).toBeGreaterThanOrEqual(5)
    expect(s.charsPerPage).toBeGreaterThan(0)
    expect(s.ratioAlnum).toBeGreaterThan(0.4)
  })

  it("counts Chase-style MM/DD dates (no year)", () => {
    const text = `
      06/11 STRIPE DES:TRANSFER ID:ST-M1Q         $183.37
      06/12 POCKETSFLOW INC DES:TRANSFER          $1,084.89
      06/13 VENMO DES:ACCTVERIFY                  $0.19
      06/13 WISE US INC DES:WIRE                  $2,137.63
      06/16 POCKETSFLOW DES:TRANSFER              $8.91
      06/17 STRIPE DES:TRANSFER ID:ST-T3S         $183.22
    `
    const s = scorePdfText(text, 2)
    expect(s.dateHits).toBeGreaterThanOrEqual(5)
    expect(s.dollarHits).toBeGreaterThanOrEqual(5)
  })

  it("returns zeroed numbers on empty input", () => {
    const s = scorePdfText("", 0)
    expect(s.dateHits).toBe(0)
    expect(s.dollarHits).toBe(0)
    expect(s.charsPerPage).toBe(0)
    expect(s.ratioAlnum).toBe(0)
  })
})

describe("routePdf", () => {
  it("routes to VISION_DOC when numpages=0", () => {
    expect(
      routePdf({ charsPerPage: 0, dateHits: 0, dollarHits: 0, ratioAlnum: 0, numpages: 0 }),
    ).toBe("VISION_DOC")
  })

  it("routes to VISION_DOC when chars/page < 200", () => {
    expect(
      routePdf({
        charsPerPage: 120,
        dateHits: 10,
        dollarHits: 10,
        ratioAlnum: 0.7,
        numpages: 3,
      }),
    ).toBe("VISION_DOC")
  })

  it("routes to VISION_DOC when date hits < 5", () => {
    expect(
      routePdf({
        charsPerPage: 800,
        dateHits: 2,
        dollarHits: 10,
        ratioAlnum: 0.7,
        numpages: 3,
      }),
    ).toBe("VISION_DOC")
  })

  it("routes to VISION_DOC when dollar hits < 5", () => {
    expect(
      routePdf({
        charsPerPage: 800,
        dateHits: 10,
        dollarHits: 1,
        ratioAlnum: 0.7,
        numpages: 3,
      }),
    ).toBe("VISION_DOC")
  })

  it("routes to HAIKU_CLEANUP when alnum ratio < 0.55 but content present", () => {
    expect(
      routePdf({
        charsPerPage: 800,
        dateHits: 10,
        dollarHits: 10,
        ratioAlnum: 0.45,
        numpages: 3,
      }),
    ).toBe("HAIKU_CLEANUP")
  })

  it("routes clean digital PDFs to HAIKU_CLEANUP (default Haiku-first)", () => {
    expect(
      routePdf({
        charsPerPage: 1500,
        dateHits: 30,
        dollarHits: 30,
        ratioAlnum: 0.72,
        numpages: 5,
      }),
    ).toBe("HAIKU_CLEANUP")
  })
})
