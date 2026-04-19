/**
 * Audit Packet ZIP tests.
 *
 * Uses skipMemos=true to avoid real AI calls in CI.
 * Verifies ZIP magic bytes, reasonable size, and README.md entry presence
 * (Central Directory entry for "README.md" appears as a string in the buffer).
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { buildAuditPacket } from "../../lib/reports/auditPacket"
import { createReportFixture, destroyReportFixture, type ReportFixture } from "./fixture"

describe("buildAuditPacket", () => {
  let fix: ReportFixture

  beforeAll(async () => {
    fix = await createReportFixture()
  })

  afterAll(async () => {
    await destroyReportFixture(fix)
  })

  it("returns a non-empty Buffer", async () => {
    const buf = await buildAuditPacket(fix.taxYearId, /* skipMemos= */ true)
    expect(buf).toBeInstanceOf(Buffer)
    // Must be at least a few KB — 7+ files with content
    expect(buf.length).toBeGreaterThan(10000)
  })

  it("starts with ZIP magic bytes (PK\\x03\\x04)", async () => {
    const buf = await buildAuditPacket(fix.taxYearId, true)
    expect(buf[0]).toBe(0x50) // 'P'
    expect(buf[1]).toBe(0x4b) // 'K'
  })

  it("Central Directory contains expected entry names", async () => {
    const buf = await buildAuditPacket(fix.taxYearId, true)
    const str = buf.toString("latin1")
    // These filenames appear in the ZIP Central Directory
    expect(str).toContain("README.md")
    expect(str).toContain("01_transaction_ledger.xlsx")
    expect(str).toContain("03_cohan_labels.csv")
    expect(str).toContain("05_income_reconciliation.csv")
    expect(str).toContain("06_source_documents_inventory.csv")
  })

  it("contains 274d substantiation directory entries", async () => {
    const buf = await buildAuditPacket(fix.taxYearId, true)
    const str = buf.toString("latin1")
    expect(str).toContain("02_274d_substantiation/meals.csv")
    expect(str).toContain("02_274d_substantiation/travel.csv")
    expect(str).toContain("02_274d_substantiation/vehicle.csv")
    expect(str).toContain("02_274d_substantiation/gifts.csv")
  })
})
