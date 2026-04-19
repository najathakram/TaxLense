/**
 * Tax Package ZIP tests.
 *
 * Uses allowUnlocked=true to skip the LOCKED gate in tests.
 * Verifies ZIP magic bytes, size, and expected entries.
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { buildTaxPackage } from "../../lib/reports/taxPackage"
import { createReportFixture, destroyReportFixture, type ReportFixture } from "./fixture"

describe("buildTaxPackage", () => {
  let fix: ReportFixture

  beforeAll(async () => {
    fix = await createReportFixture()
  })

  afterAll(async () => {
    await destroyReportFixture(fix)
  })

  it("returns a non-empty ZIP Buffer", async () => {
    const buf = await buildTaxPackage(fix.taxYearId, { allowUnlocked: true })
    expect(buf).toBeInstanceOf(Buffer)
    expect(buf.length).toBeGreaterThan(5000)
    expect(buf[0]).toBe(0x50)
    expect(buf[1]).toBe(0x4b)
  })

  it("contains expected filenames", async () => {
    const buf = await buildTaxPackage(fix.taxYearId, { allowUnlocked: true })
    const str = buf.toString("latin1")
    expect(str).toContain("01_client_summary.pdf")
    expect(str).toContain("02_schedule_c_worksheet.pdf")
    expect(str).toContain("03_form_8829.pdf")
    expect(str).toContain("04_depreciation.pdf")
    expect(str).toContain("05_1099_nec_recipients.csv")
    expect(str).toContain("06_cpa_handoff.pdf")
    expect(str).toContain("master_ledger.xlsx")
    expect(str).toContain("financial_statements.xlsx")
    expect(str).toContain("README.md")
  })

  it("refuses to generate when tax year is not locked (default)", async () => {
    const { prisma } = await import("./fixture")
    await prisma.taxYear.update({ where: { id: fix.taxYearId }, data: { status: "REVIEW" } })
    try {
      await expect(buildTaxPackage(fix.taxYearId)).rejects.toThrow(/LOCKED/)
    } finally {
      await prisma.taxYear.update({ where: { id: fix.taxYearId }, data: { status: "LOCKED" } })
    }
  })
})
