/**
 * Wise CSV parser sign + attribution tests (B-06 / B-17).
 *
 * The crux: "Sent money to {recipient}" must come out as an OUTFLOW
 * (amountNormalized > 0) with merchantRaw = the recipient name —
 * regardless of how Wise signs the raw amount in their CSV (we've seen
 * both negative and positive in the wild).
 */
import { describe, it, expect } from "vitest"
import {
  parseWise,
  isWise,
  wiseMerchantFromDescription,
} from "@/lib/parsers/institutions/wise"

const ROW = (
  date: string,
  amount: string,
  description: string,
  extra: Record<string, string> = {},
): Record<string, string> => ({
  "TransferWise ID": "wid_1",
  Date: date,
  Amount: amount,
  Description: description,
  ...extra,
})

describe("Wise institution detection", () => {
  it("matches by TransferWise ID column", () => {
    expect(isWise(["TransferWise ID", "Date", "Amount", "Description"])).toBe(true)
  })

  it("matches by Wise ID variant", () => {
    expect(isWise(["Wise ID", "Date", "Amount", "Description"])).toBe(true)
  })

  it("matches by Payer/Payee/Running combo", () => {
    expect(
      isWise(["Date", "Amount", "Payer Name", "Payee Name", "Running Balance"]),
    ).toBe(true)
  })

  it("does not match a generic CSV", () => {
    expect(isWise(["Date", "Description", "Amount"])).toBe(false)
  })
})

describe("wiseMerchantFromDescription", () => {
  it("extracts recipient from 'Sent money to'", () => {
    expect(wiseMerchantFromDescription("Sent money to Zain Ul Abideen Safdar")).toBe(
      "ZAIN UL ABIDEEN SAFDAR",
    )
  })

  it("extracts sender from 'Received money from'", () => {
    expect(wiseMerchantFromDescription("Received money from Pocketsflow Inc")).toBe(
      "POCKETSFLOW INC",
    )
  })

  it("extracts merchant from card transactions", () => {
    expect(wiseMerchantFromDescription("Card transaction at AMAZON.COM SEATTLE WA")).toBe(
      "AMAZON.COM SEATTLE WA",
    )
  })

  it("normalizes top-ups", () => {
    expect(wiseMerchantFromDescription("Topped up via Chase Checking")).toBe("WISE TOP-UP")
  })

  it("preserves unknown shapes uppercase", () => {
    expect(wiseMerchantFromDescription("Mystery wire instruction")).toBe(
      "MYSTERY WIRE INSTRUCTION",
    )
  })
})

describe("parseWise — sign + attribution (B-06)", () => {
  it("treats 'Sent money to X' as outflow regardless of raw sign", () => {
    const rows = [
      // Wise has been seen exporting outflows with both signs — both must
      // produce amountNormalized > 0 (outflow).
      ROW("2025-06-27", "-2624.00", "Sent money to Zain Ul Abideen Safdar"),
      ROW("2025-06-28", "1500.00", "Sent money to Random Supplier"),
    ]
    const r = parseWise(rows)
    expect(r.ok).toBe(true)
    expect(r.transactions[0]!.amountNormalized).toBeGreaterThan(0)
    expect(r.transactions[1]!.amountNormalized).toBeGreaterThan(0)
    expect(r.transactions[0]!.merchantRaw).toBe("ZAIN UL ABIDEEN SAFDAR")
    expect(r.transactions[1]!.merchantRaw).toBe("RANDOM SUPPLIER")
  })

  it("treats 'Received money from X' as inflow", () => {
    const rows = [ROW("2025-09-12", "2238.40", "Received money from Pocketsflow")]
    const r = parseWise(rows)
    expect(r.ok).toBe(true)
    expect(r.transactions[0]!.amountNormalized).toBeLessThan(0)
    expect(r.transactions[0]!.merchantRaw).toBe("POCKETSFLOW")
  })

  it("falls back to standard sign convention for unknown descriptions", () => {
    const rows = [ROW("2025-01-01", "-100.00", "Some unrecognized memo")]
    const r = parseWise(rows)
    expect(r.ok).toBe(true)
    // Generic Wise convention: negative raw = outflow → flip to positive
    expect(r.transactions[0]!.amountNormalized).toBe(100)
  })

  it("preserves the original description in descriptionRaw", () => {
    const rows = [ROW("2025-06-27", "-2624.00", "Sent money to Zain Ul Abideen Safdar")]
    const r = parseWise(rows)
    expect(r.transactions[0]!.descriptionRaw).toBe(
      "Sent money to Zain Ul Abideen Safdar",
    )
  })

  it("computes period bounds + totals", () => {
    const rows = [
      ROW("2025-06-01", "-100.00", "Sent money to A"),
      ROW("2025-06-30", "200.00", "Received money from B"),
    ]
    const r = parseWise(rows)
    expect(r.ok).toBe(true)
    expect(r.totalOutflows).toBe(100)
    expect(r.totalInflows).toBe(200)
    expect(r.periodStart?.toISOString().slice(0, 10)).toBe("2025-06-01")
    expect(r.periodEnd?.toISOString().slice(0, 10)).toBe("2025-06-30")
  })
})
