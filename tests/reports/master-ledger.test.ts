import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import ExcelJS from "exceljs"
import { buildMasterLedger } from "../../lib/reports/masterLedger"
import { createReportFixture, destroyReportFixture, type ReportFixture } from "./fixture"

describe("buildMasterLedger", () => {
  let fix: ReportFixture

  beforeAll(async () => {
    fix = await createReportFixture()
  })

  afterAll(async () => {
    await destroyReportFixture(fix)
  })

  it("returns a non-empty Buffer", async () => {
    const buf = await buildMasterLedger(fix.taxYearId)
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(5000)
  })

  it("has exactly 5 sheets with correct names", async () => {
    const buf = await buildMasterLedger(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const names = wb.worksheets.map((s) => s.name)
    expect(names).toEqual(["Transactions", "Merchant Rules", "Stop Resolutions", "Profile Snapshot", "Metadata"])
  })

  it("Transactions sheet has header row and data rows", async () => {
    const buf = await buildMasterLedger(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const sheet = wb.getWorksheet("Transactions")!
    // Row 1 is the header
    expect(sheet.getRow(1).getCell(1).value).toBe("Date")
    expect(sheet.getRow(1).getCell(6).value).toBe("Code")
    // Should have data rows (9 transactions in fixture)
    expect(sheet.rowCount).toBeGreaterThanOrEqual(9)
  })

  it("Transactions sheet rows are color-coded (non-header rows have a fill)", async () => {
    const buf = await buildMasterLedger(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const sheet = wb.getWorksheet("Transactions")!
    // Check row 2 (first data row) has a fill color
    const firstDataRow = sheet.getRow(2)
    const firstCell = firstDataRow.getCell(1)
    const fill = firstCell.fill as ExcelJS.Fill | undefined
    // Fill should be a pattern fill with a color (not undefined)
    expect(fill).toBeDefined()
    expect(fill?.type).toBe("pattern")
  })

  it("Metadata sheet contains the tax year and status", async () => {
    const buf = await buildMasterLedger(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const sheet = wb.getWorksheet("Metadata")!
    // Collect key/value pairs
    const kv: Record<string, string> = {}
    sheet.eachRow((row, i) => {
      if (i === 1) return // header
      const k = String(row.getCell(1).value ?? "")
      const v = String(row.getCell(2).value ?? "")
      kv[k] = v
    })
    expect(kv["Tax Year"]).toBe("2024")
    expect(kv["Status"]).toBe("LOCKED")
    expect(kv["TaxLens Version"]).toBe("0.7")
  })

  it("Profile Snapshot sheet contains business description", async () => {
    const buf = await buildMasterLedger(fix.taxYearId)
    const wb = new ExcelJS.Workbook()
    await wb.xlsx.load(buf)
    const sheet = wb.getWorksheet("Profile Snapshot")!
    let found = false
    sheet.eachRow((row, i) => {
      if (i === 1) return
      if (String(row.getCell(1).value).includes("Business Description")) found = true
    })
    expect(found).toBe(true)
  })
})
