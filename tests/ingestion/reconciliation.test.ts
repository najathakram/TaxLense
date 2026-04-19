/**
 * TaxLens — Reconciliation + ParseResult shape tests
 * Verifies that totalInflows/totalOutflows are always computed correctly
 * and that reconciliation.ok=true for all CSV parsers.
 */

import { describe, it, expect } from "vitest"
import { parseChaseCc } from "@/lib/parsers/institutions/chase-cc"
import { parseChaseChecking } from "@/lib/parsers/institutions/chase-checking"
import { parseAmex } from "@/lib/parsers/institutions/amex"

describe("ParseResult shape invariants", () => {
  const makeRows = (entries: { date: string; amt: number }[], headers: "chasecc" | "checking" | "amex") => {
    if (headers === "chasecc") {
      return entries.map((e) => ({
        "Transaction Date": e.date,
        "Post Date": e.date,
        Description: "TEST",
        Category: "Shopping",
        Type: "Sale",
        Amount: e.amt.toString(),
        Memo: "",
      }))
    }
    if (headers === "checking") {
      return entries.map((e) => ({
        Details: "DEBIT",
        "Posting Date": e.date,
        Description: "TEST",
        Amount: e.amt.toString(),
        Type: "ACH",
        Balance: "1000",
        "Check or Slip #": "",
      }))
    }
    // amex
    return entries.map((e) => ({
      Date: e.date,
      Description: "TEST",
      "Card Member": "TEST USER",
      "Account #": "-99999",
      Amount: e.amt.toString(),
    }))
  }

  it("totalOutflows = sum of positive amountNormalized (chase-cc)", () => {
    const rows = makeRows(
      [
        { date: "01/01/2025", amt: -100 },  // outflow after flip
        { date: "01/02/2025", amt: -50 },   // outflow after flip
        { date: "01/03/2025", amt: 200 },   // inflow after flip
      ],
      "chasecc",
    )
    const result = parseChaseCc(rows)
    expect(result.totalOutflows).toBeCloseTo(150)
    expect(result.totalInflows).toBeCloseTo(200)
  })

  it("totalOutflows = sum of positive amountNormalized (chase-checking)", () => {
    const rows = makeRows(
      [
        { date: "01/01/2025", amt: -300 },  // outflow
        { date: "01/02/2025", amt: 1000 },  // inflow
      ],
      "checking",
    )
    const result = parseChaseChecking(rows)
    expect(result.totalOutflows).toBeCloseTo(300)
    expect(result.totalInflows).toBeCloseTo(1000)
  })

  it("totalOutflows = sum of positive amountNormalized (amex, no flip)", () => {
    const rows = makeRows(
      [
        { date: "01/01/2025", amt: 75.50 },   // charge = outflow (amex no flip)
        { date: "01/02/2025", amt: -200.00 },  // payment = inflow
      ],
      "amex",
    )
    const result = parseAmex(rows)
    expect(result.totalOutflows).toBeCloseTo(75.50)
    expect(result.totalInflows).toBeCloseTo(200)
  })

  it("reconciliation.ok=true for CSV parsers", () => {
    const rows = makeRows([{ date: "01/01/2025", amt: -50 }], "chasecc")
    const result = parseChaseCc(rows)
    expect(result.reconciliation.ok).toBe(true)
  })

  it("periodStart < periodEnd when multiple dates", () => {
    const rows = makeRows(
      [
        { date: "01/01/2025", amt: -50 },
        { date: "01/31/2025", amt: -50 },
      ],
      "chasecc",
    )
    const result = parseChaseCc(rows)
    expect(result.periodStart!.getTime()).toBeLessThan(result.periodEnd!.getTime())
  })

  it("returns ok:false with error when rows array is empty", () => {
    const result = parseChaseCc([])
    expect(result.ok).toBe(false)
    expect(result.error).toBeTruthy()
    expect(result.transactions).toHaveLength(0)
  })

  it("skips bad rows and continues; parseConfidence drops to 0.7", () => {
    const rows = [
      {
        "Transaction Date": "01/01/2025",
        "Post Date": "01/01/2025",
        Description: "Good",
        Category: "Shopping",
        Type: "Sale",
        Amount: "-50.00",
        Memo: "",
      },
      {
        "Transaction Date": "NOT A DATE",
        "Post Date": "NOT A DATE",
        Description: "Bad Date",
        Category: "Shopping",
        Type: "Sale",
        Amount: "-50.00",
        Memo: "",
      },
    ]
    const result = parseChaseCc(rows)
    expect(result.ok).toBe(true)
    expect(result.transactions).toHaveLength(1)
    expect(result.parseConfidence).toBe(0.7)
    expect(result.error).toBeTruthy()
  })
})
