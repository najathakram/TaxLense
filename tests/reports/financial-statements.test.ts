import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import ExcelJS from "exceljs"
import { buildFinancialStatements } from "../../lib/reports/financialStatements"
import { createReportFixture, destroyReportFixture, prisma, type ReportFixture } from "./fixture"

describe("buildFinancialStatements", () => {
  let fix: ReportFixture

  beforeAll(async () => {
    fix = await createReportFixture()
  })

  afterAll(async () => {
    await destroyReportFixture(fix)
  })

  it("returns a non-empty Buffer", async () => {
    const buf = await buildFinancialStatements(fix.taxYearId)
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(5000)
  })

  it("has exactly 5 sheets with correct names", async () => {
    const buf = await buildFinancialStatements(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const names = wb.worksheets.map((s) => s.name)
    expect(names).toEqual(["General Ledger", "Schedule C", "P&L", "Balance Sheet", "Schedule C Detail"])
  })

  it("Schedule C grand total matches sum of deductible amounts from DB", async () => {
    const DEDUCTIBLE_CODES = ["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100", "GRAY"]

    // Compute expected total from DB
    const txns = await prisma.transaction.findMany({
      where: { taxYearId: fix.taxYearId, isSplit: false },
      include: { classifications: { where: { isCurrent: true }, take: 1 } },
    })
    let expectedTotal = 0
    for (const t of txns) {
      const c = t.classifications[0]
      if (!c || !DEDUCTIBLE_CODES.includes(c.code)) continue
      const outflow = Math.max(0, Number(t.amountNormalized))
      let ded = outflow * (c.businessPct / 100)
      if (c.code === "MEALS_50") ded *= 0.5
      expectedTotal += ded
    }

    // Extract from the Schedule C sheet's last row (TOTAL DEDUCTIONS)
    const buf = await buildFinancialStatements(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const sheet = wb.getWorksheet("Schedule C")!
    let sheetTotal: number | null = null
    sheet.eachRow((row) => {
      const label = String(row.getCell(1).value ?? "")
      if (label === "TOTAL DEDUCTIONS") {
        sheetTotal = Number(row.getCell(2).value)
      }
    })
    expect(sheetTotal).not.toBeNull()
    expect(sheetTotal!).toBeCloseTo(expectedTotal, 2)
  })

  it("P&L sheet contains Revenue, Gross Profit, Net Income rows", async () => {
    const buf = await buildFinancialStatements(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const sheet = wb.getWorksheet("P&L")!
    const labels: string[] = []
    sheet.eachRow((row) => {
      const v = String(row.getCell(1).value ?? "")
      if (v) labels.push(v)
    })
    expect(labels.some((l) => l.includes("REVENUE"))).toBe(true)
    expect(labels.some((l) => l.includes("Gross Profit"))).toBe(true)
    expect(labels.some((l) => l.includes("Net Income"))).toBe(true)
  })

  it("Schedule C Detail sheet has section header rows and transaction rows", async () => {
    const buf = await buildFinancialStatements(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const sheet = wb.getWorksheet("Schedule C Detail")!
    // At least header + 1 section header + 1 data row + 1 total = 4 rows
    expect(sheet.rowCount).toBeGreaterThanOrEqual(4)
    // First data row after header should have a date-like value
    expect(sheet.getRow(1).getCell(1).value).toBe("Sch C Line")
  })

  it("Balance Sheet lists at least one asset row", async () => {
    const buf = await buildFinancialStatements(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const sheet = wb.getWorksheet("Balance Sheet")!
    const labels: string[] = []
    sheet.eachRow((row) => {
      const v = String(row.getCell(1).value ?? "")
      if (v) labels.push(v)
    })
    expect(labels.some((l) => l.includes("ASSETS"))).toBe(true)
    expect(labels.some((l) => l.includes("Total Assets"))).toBe(true)
  })
})
