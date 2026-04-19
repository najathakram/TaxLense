/**
 * TaxLens — Institution parser tests
 * Covers: chase-cc, chase-checking, amex, costco-citi, robinhood, generic, ofx-generic
 * Sign normalisation: outflows POSITIVE, inflows NEGATIVE
 */

import { describe, it, expect } from "vitest"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { extractCsvRows } from "@/lib/parsers/csv-extractor"
import { parseChaseCc } from "@/lib/parsers/institutions/chase-cc"
import { parseChaseChecking } from "@/lib/parsers/institutions/chase-checking"
import { parseAmex } from "@/lib/parsers/institutions/amex"
import { parseCostcoCiti } from "@/lib/parsers/institutions/costco-citi"
import { parseRobinhood } from "@/lib/parsers/institutions/robinhood"
import { parseGeneric } from "@/lib/parsers/institutions/generic"
import { parseOfxGeneric } from "@/lib/parsers/institutions/ofx-generic"
import { detectInstitution } from "@/lib/parsers/institutions"

const FIXTURES = join(process.cwd(), "tests", "fixtures")

function loadCsv(name: string) {
  const text = readFileSync(join(FIXTURES, name), "utf8")
  return extractCsvRows(text)
}

// ── Chase CC ─────────────────────────────────────────────────────────────────
describe("Chase CC parser", () => {
  it("parses all rows from fixture", () => {
    const { rows } = loadCsv("chase-cc-sample.csv")
    const result = parseChaseCc(rows)
    expect(result.ok).toBe(true)
    expect(result.institution).toBe("chase-cc")
    expect(result.transactions).toHaveLength(8)
  })

  it("flips sign: charge -129.99 → amountNormalized +129.99", () => {
    const { rows } = loadCsv("chase-cc-sample.csv")
    const result = parseChaseCc(rows)
    const amazon = result.transactions.find((t) => t.merchantRaw.includes("AMAZON"))!
    expect(amazon.amountOriginal).toBeCloseTo(-129.99)
    expect(amazon.amountNormalized).toBeCloseTo(129.99)
  })

  it("flips sign: payment +500 → amountNormalized -500 (inflow)", () => {
    const { rows } = loadCsv("chase-cc-sample.csv")
    const result = parseChaseCc(rows)
    const payment = result.transactions.find((t) => t.merchantRaw.includes("PAYMENT"))!
    expect(payment.amountOriginal).toBeCloseTo(500)
    expect(payment.amountNormalized).toBeCloseTo(-500)
  })

  it("computes totalOutflows as sum of positive amountNormalized", () => {
    const { rows } = loadCsv("chase-cc-sample.csv")
    const result = parseChaseCc(rows)
    // Outflows: 129.99 + 6.75 + 54.99 + 45.00 + 387.50 + 210.00 = 834.23
    expect(result.totalOutflows).toBeCloseTo(834.23, 1)
  })

  it("computes totalInflows as sum of abs(negative amountNormalized)", () => {
    const { rows } = loadCsv("chase-cc-sample.csv")
    const result = parseChaseCc(rows)
    // Inflows: payment 500 + refund 129.99 = 629.99
    expect(result.totalInflows).toBeCloseTo(629.99, 1)
  })

  it("sets periodStart and periodEnd", () => {
    const { rows } = loadCsv("chase-cc-sample.csv")
    const result = parseChaseCc(rows)
    expect(result.periodStart).toBeInstanceOf(Date)
    expect(result.periodEnd).toBeInstanceOf(Date)
    expect(result.periodStart!.getTime()).toBeLessThan(result.periodEnd!.getTime())
  })

  it("parseConfidence 0.95 when no errors", () => {
    const { rows } = loadCsv("chase-cc-sample.csv")
    const result = parseChaseCc(rows)
    expect(result.parseConfidence).toBe(0.95)
  })

  it("detects as chase-cc via detectInstitution", () => {
    const { headers } = loadCsv("chase-cc-sample.csv")
    expect(detectInstitution(headers)).toBe("chase-cc")
  })
})

// ── Chase Checking ───────────────────────────────────────────────────────────
describe("Chase Checking parser", () => {
  it("parses all rows from fixture", () => {
    const { rows } = loadCsv("chase-checking-sample.csv")
    const result = parseChaseChecking(rows)
    expect(result.ok).toBe(true)
    expect(result.institution).toBe("chase-checking")
    expect(result.transactions).toHaveLength(7)
  })

  it("flips sign: debit -1200 → amountNormalized +1200", () => {
    const { rows } = loadCsv("chase-checking-sample.csv")
    const result = parseChaseChecking(rows)
    const rent = result.transactions.find((t) => t.merchantRaw.includes("ZELLE PAYMENT TO STUDIO"))!
    expect(rent.amountOriginal).toBeCloseTo(-1200)
    expect(rent.amountNormalized).toBeCloseTo(1200)
  })

  it("flips sign: credit +850 → amountNormalized -850 (inflow)", () => {
    const { rows } = loadCsv("chase-checking-sample.csv")
    const result = parseChaseChecking(rows)
    const deposit = result.transactions.find((t) => t.merchantRaw.includes("SARA JONES"))!
    expect(deposit.amountOriginal).toBeCloseTo(850)
    expect(deposit.amountNormalized).toBeCloseTo(-850)
  })

  it("detects as chase-checking via detectInstitution", () => {
    const { headers } = loadCsv("chase-checking-sample.csv")
    expect(detectInstitution(headers)).toBe("chase-checking")
  })
})

// ── Amex ─────────────────────────────────────────────────────────────────────
describe("Amex parser", () => {
  it("parses all rows from fixture", () => {
    const { rows } = loadCsv("amex-sample.csv")
    const result = parseAmex(rows)
    expect(result.ok).toBe(true)
    expect(result.institution).toBe("amex")
    expect(result.transactions).toHaveLength(7)
  })

  it("no sign flip: charge 387.50 → amountNormalized +387.50", () => {
    const { rows } = loadCsv("amex-sample.csv")
    const result = parseAmex(rows)
    const delta = result.transactions.find((t) => t.merchantRaw.includes("DELTA"))!
    expect(delta.amountOriginal).toBeCloseTo(387.50)
    expect(delta.amountNormalized).toBeCloseTo(387.50)
  })

  it("no sign flip: payment -2000 → amountNormalized -2000 (inflow)", () => {
    const { rows } = loadCsv("amex-sample.csv")
    const result = parseAmex(rows)
    const payment = result.transactions.find((t) => t.merchantRaw.includes("PAYMENT"))!
    expect(payment.amountOriginal).toBeCloseTo(-2000)
    expect(payment.amountNormalized).toBeCloseTo(-2000)
  })

  it("detects as amex via detectInstitution", () => {
    const { headers } = loadCsv("amex-sample.csv")
    expect(detectInstitution(headers)).toBe("amex")
  })
})

// ── Costco Citi ───────────────────────────────────────────────────────────────
describe("Costco Citi parser", () => {
  it("parses all rows from fixture", () => {
    const { rows } = loadCsv("costco-citi-sample.csv")
    const result = parseCostcoCiti(rows)
    expect(result.ok).toBe(true)
    expect(result.institution).toBe("costco-citi")
    expect(result.transactions).toHaveLength(6)
  })

  it("Debit column → outflow (positive amountNormalized)", () => {
    const { rows } = loadCsv("costco-citi-sample.csv")
    const result = parseCostcoCiti(rows)
    const costco = result.transactions.find((t) => t.merchantRaw.includes("COSTCO"))!
    expect(costco.amountNormalized).toBeCloseTo(287.34)
  })

  it("Credit column → inflow (negative amountNormalized)", () => {
    const { rows } = loadCsv("costco-citi-sample.csv")
    const result = parseCostcoCiti(rows)
    const payment = result.transactions.find((t) => t.merchantRaw.includes("PAYMENT"))!
    expect(payment.amountNormalized).toBeCloseTo(-500)
  })

  it("detects as costco-citi via detectInstitution", () => {
    const { headers } = loadCsv("costco-citi-sample.csv")
    expect(detectInstitution(headers)).toBe("costco-citi")
  })
})

// ── Robinhood ─────────────────────────────────────────────────────────────────
describe("Robinhood parser", () => {
  it("parses all rows from fixture", () => {
    const { rows } = loadCsv("robinhood-sample.csv")
    const result = parseRobinhood(rows)
    expect(result.ok).toBe(true)
    expect(result.institution).toBe("robinhood")
    expect(result.transactions).toHaveLength(6)
  })

  it("flips sign: ACH deposit +1000 → amountNormalized -1000 (inflow)", () => {
    const { rows } = loadCsv("robinhood-sample.csv")
    const result = parseRobinhood(rows)
    const deposit = result.transactions.find(
      (t) => t.merchantRaw.includes("ACH Deposit") || t.merchantRaw.includes("Deposit"),
    )!
    expect(deposit.amountOriginal).toBeCloseTo(1000)
    expect(deposit.amountNormalized).toBeCloseTo(-1000)
  })

  it("flips sign: buy -487 → amountNormalized +487 (outflow)", () => {
    const { rows } = loadCsv("robinhood-sample.csv")
    const result = parseRobinhood(rows)
    const buy = result.transactions.find((t) => t.merchantRaw.includes("Buy"))!
    expect(buy.amountOriginal).toBeCloseTo(-487)
    expect(buy.amountNormalized).toBeCloseTo(487)
  })

  it("detects as robinhood via detectInstitution", () => {
    const { headers } = loadCsv("robinhood-sample.csv")
    expect(detectInstitution(headers)).toBe("robinhood")
  })
})

// ── Generic ───────────────────────────────────────────────────────────────────
describe("Generic CSV parser", () => {
  it("parses a simple amount-column CSV", () => {
    const rows = [
      { Date: "01/05/2025", Description: "Coffee shop", Amount: "-8.50" },
      { Date: "01/06/2025", Description: "Client payment", Amount: "500.00" },
    ]
    const result = parseGeneric(rows)
    expect(result.ok).toBe(true)
    expect(result.transactions).toHaveLength(2)
    // Amount-column generic: normalised = -original
    expect(result.transactions[0].amountNormalized).toBeCloseTo(8.50)
    expect(result.transactions[1].amountNormalized).toBeCloseTo(-500)
  })

  it("parses Debit/Credit split columns", () => {
    const rows = [
      { Date: "01/05/2025", Description: "Rent", Debit: "1200.00", Credit: "" },
      { Date: "01/06/2025", Description: "Invoice", Debit: "", Credit: "3000.00" },
    ]
    const result = parseGeneric(rows)
    expect(result.ok).toBe(true)
    expect(result.transactions[0].amountNormalized).toBeCloseTo(1200)
    expect(result.transactions[1].amountNormalized).toBeCloseTo(-3000)
  })

  it("returns ok:false when no date column found", () => {
    const rows = [{ Foo: "bar", Amount: "100" }]
    const result = parseGeneric(rows)
    expect(result.ok).toBe(false)
  })

  it("caps parseConfidence at 0.6", () => {
    const rows = [
      { Date: "01/05/2025", Description: "Coffee", Amount: "-8.50" },
    ]
    const result = parseGeneric(rows)
    expect(result.parseConfidence).toBeLessThanOrEqual(0.6)
  })
})

// ── OFX Generic ───────────────────────────────────────────────────────────────
describe("OFX generic parser", () => {
  const ofxSample = `
OFXHEADER:100
DATA:OFXSGML
<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKTRANLIST>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20250105
<TRNAMT>-129.99
<NAME>AMAZON.COM
<MEMO>Online purchase
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20250110
<TRNAMT>500.00
<NAME>PAYMENT RECEIVED
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`.trim()

  it("parses SGML-style OFX blocks", () => {
    const result = parseOfxGeneric(ofxSample)
    expect(result.ok).toBe(true)
    expect(result.institution).toBe("ofx-generic")
    expect(result.transactions).toHaveLength(2)
  })

  it("flips sign: TRNAMT -129.99 → amountNormalized +129.99", () => {
    const result = parseOfxGeneric(ofxSample)
    const debit = result.transactions.find((t) => t.merchantRaw.includes("AMAZON"))!
    expect(debit.amountOriginal).toBeCloseTo(-129.99)
    expect(debit.amountNormalized).toBeCloseTo(129.99)
  })

  it("flips sign: TRNAMT +500 → amountNormalized -500 (inflow)", () => {
    const result = parseOfxGeneric(ofxSample)
    const credit = result.transactions.find((t) => t.merchantRaw.includes("PAYMENT"))!
    expect(credit.amountOriginal).toBeCloseTo(500)
    expect(credit.amountNormalized).toBeCloseTo(-500)
  })

  it("returns ok:false when no STMTTRN blocks found", () => {
    const result = parseOfxGeneric("<OFX><BANKTRANLIST></BANKTRANLIST></OFX>")
    expect(result.ok).toBe(false)
  })
})
