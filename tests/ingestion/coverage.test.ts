/**
 * TaxLens — Coverage grid helper tests
 * Tests the month-gap detection logic in isolation (no DB).
 */

import { describe, it, expect } from "vitest"

// ── Helper: month gap detection logic (extracted from coverage/page.tsx) ─────

function detectGaps(
  transactions: { postedDate: Date }[],
  year: number,
): { month: string; txCount: number; hasGap: boolean }[] {
  const months: string[] = []
  for (let m = 1; m <= 12; m++) {
    months.push(`${year}-${String(m).padStart(2, "0")}`)
  }

  const txByMonth: Record<string, number> = {}
  for (const tx of transactions) {
    const month = tx.postedDate.toISOString().slice(0, 7)
    txByMonth[month] = (txByMonth[month] ?? 0) + 1
  }

  return months.map((month) => ({
    month,
    txCount: txByMonth[month] ?? 0,
    hasGap: (txByMonth[month] ?? 0) === 0,
  }))
}

describe("Coverage gap detection", () => {
  it("returns 12 months for any year", () => {
    const result = detectGaps([], 2025)
    expect(result).toHaveLength(12)
    expect(result[0].month).toBe("2025-01")
    expect(result[11].month).toBe("2025-12")
  })

  it("marks all months as gaps when no transactions", () => {
    const result = detectGaps([], 2025)
    expect(result.every((r) => r.hasGap)).toBe(true)
    expect(result.every((r) => r.txCount === 0)).toBe(true)
  })

  it("marks months with transactions as not gaps", () => {
    const transactions = [
      { postedDate: new Date("2025-01-15") },
      { postedDate: new Date("2025-01-20") },
      { postedDate: new Date("2025-03-05") },
    ]
    const result = detectGaps(transactions, 2025)
    expect(result[0].txCount).toBe(2)  // Jan
    expect(result[0].hasGap).toBe(false)
    expect(result[1].txCount).toBe(0)  // Feb
    expect(result[1].hasGap).toBe(true)
    expect(result[2].txCount).toBe(1)  // Mar
    expect(result[2].hasGap).toBe(false)
  })

  it("counts correctly for months with multiple transactions", () => {
    const transactions = Array.from({ length: 15 }, (_, i) => ({
      postedDate: new Date(`2025-06-${String(i + 1).padStart(2, "0")}`),
    }))
    const result = detectGaps(transactions, 2025)
    expect(result[5].month).toBe("2025-06")
    expect(result[5].txCount).toBe(15)
    expect(result[5].hasGap).toBe(false)
  })

  it("only counts transactions in the correct year", () => {
    const transactions = [
      { postedDate: new Date("2024-12-31") },  // prev year
      { postedDate: new Date("2025-01-01") },  // current year
      { postedDate: new Date("2026-01-01") },  // next year
    ]
    const result = detectGaps(transactions, 2025)
    // Only January 2025 transaction should count
    expect(result[0].txCount).toBe(1)
    expect(result[11].txCount).toBe(0) // Dec 2025 is gap (Dec 2024 doesn't count)
  })

  it("totalGaps counts correctly across all months", () => {
    const transactions = [
      { postedDate: new Date("2025-01-15") },
      { postedDate: new Date("2025-06-10") },
      { postedDate: new Date("2025-12-01") },
    ]
    const result = detectGaps(transactions, 2025)
    const totalGaps = result.filter((r) => r.hasGap).length
    expect(totalGaps).toBe(9) // 12 months - 3 with transactions = 9 gaps
  })
})
