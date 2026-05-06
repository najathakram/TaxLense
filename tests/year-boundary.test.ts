/**
 * B1 — Year-boundary enforcement (assertion A10).
 *
 * Pure unit test on the partition helper. Statements that span a year boundary
 * (Dec → Jan PDFs) often contain rows for two tax years; only the in-year rows
 * belong in the active TaxYear.
 */
import { describe, it, expect } from "vitest"
import { partitionByTaxYear } from "../lib/parsers"

describe("partitionByTaxYear", () => {
  it("keeps only rows whose postedDate UTC year matches the tax year", () => {
    const txns = [
      { postedDate: new Date("2024-12-31T12:00:00Z"), label: "dec-2024" },
      { postedDate: new Date("2025-01-01T00:00:00Z"), label: "jan-2025" },
      { postedDate: new Date("2025-06-15T00:00:00Z"), label: "jun-2025" },
      { postedDate: new Date("2025-12-31T23:59:59Z"), label: "dec-2025" },
      { postedDate: new Date("2026-01-01T00:00:00Z"), label: "jan-2026" },
    ]
    const { inYear, outOfYear } = partitionByTaxYear(txns, 2025)
    expect(inYear.map((t) => t.label)).toEqual(["jan-2025", "jun-2025", "dec-2025"])
    expect(outOfYear.map((t) => t.label)).toEqual(["dec-2024", "jan-2026"])
  })

  it("returns empty arrays when given an empty list", () => {
    const { inYear, outOfYear } = partitionByTaxYear([], 2025)
    expect(inYear).toEqual([])
    expect(outOfYear).toEqual([])
  })

  it("uses UTC year — does not get tripped by local timezone offsets", () => {
    // Midnight UTC on 2025-01-01 is still 2024 in west-of-UTC zones, but A10
    // and parsers must agree by using getUTCFullYear.
    const tx = { postedDate: new Date("2025-01-01T00:00:00Z") }
    const { inYear } = partitionByTaxYear([tx], 2025)
    expect(inYear.length).toBe(1)
  })
})
