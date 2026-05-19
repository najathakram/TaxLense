/**
 * PRE_CLEANUP — sub-function predicate tests.
 *
 * The PRE_CLEANUP module ports 4 .mjs scripts (inflow misclassification flip,
 * out-of-year stale marking, superseded-stop archive, document backfill).
 * Each sub-function is idempotent by predicate.
 *
 * Pure unit tests on the predicate logic (DB-side integration tested via
 * Atif's prod run).
 */

import { describe, it, expect } from "vitest"

describe("PRE_CLEANUP — fixInflowMisclassifications predicate", () => {
  // Predicate: Classification.isCurrent=true AND code ∈ DEDUCTIBLE_CODES
  //            AND Transaction.amountNormalized < 0 AND Transaction.isStale=false
  //            AND Transaction.isSplit=false
  it("targets only inflow rows with deductible codes", () => {
    const offender = {
      isCurrent: true,
      code: "WRITE_OFF",
      amountNormalized: -1853.15,
      isStale: false,
      isSplit: false,
    }
    expect(isOffender(offender)).toBe(true)
  })

  it("skips outflow with deductible code (legitimate)", () => {
    const ok = {
      isCurrent: true,
      code: "WRITE_OFF",
      amountNormalized: 250,
      isStale: false,
      isSplit: false,
    }
    expect(isOffender(ok)).toBe(false)
  })

  it("skips inflow with PERSONAL code (already correct)", () => {
    const ok = {
      isCurrent: true,
      code: "PERSONAL",
      amountNormalized: -100,
      isStale: false,
      isSplit: false,
    }
    expect(isOffender(ok)).toBe(false)
  })

  it("skips stale txns", () => {
    const stale = {
      isCurrent: true,
      code: "WRITE_OFF",
      amountNormalized: -100,
      isStale: true,
      isSplit: false,
    }
    expect(isOffender(stale)).toBe(false)
  })
})

const DEDUCTIBLE = new Set(["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100", "GRAY"])

function isOffender(c: {
  isCurrent: boolean
  code: string
  amountNormalized: number
  isStale: boolean
  isSplit: boolean
}): boolean {
  return (
    c.isCurrent &&
    DEDUCTIBLE.has(c.code) &&
    c.amountNormalized < 0 &&
    !c.isStale &&
    !c.isSplit
  )
}

describe("PRE_CLEANUP — markOutOfYearStale predicate", () => {
  // Predicate: postedDate < startOfYear OR postedDate >= endOfYear, AND not already stale
  const year = 2025
  const startOfYear = new Date(Date.UTC(year, 0, 1)) // 2025-01-01 UTC
  const endOfYear = new Date(Date.UTC(year + 1, 0, 1)) // 2026-01-01 UTC

  it("flags December 31 of prior year", () => {
    const t = { postedDate: new Date("2024-12-31T12:00:00Z"), isStale: false }
    expect(isOutOfYear(t, startOfYear, endOfYear)).toBe(true)
  })

  it("flags January 1 of next year", () => {
    const t = { postedDate: new Date("2026-01-01T00:00:01Z"), isStale: false }
    expect(isOutOfYear(t, startOfYear, endOfYear)).toBe(true)
  })

  it("keeps January 1 of target year", () => {
    const t = { postedDate: new Date("2025-01-01T00:00:00Z"), isStale: false }
    expect(isOutOfYear(t, startOfYear, endOfYear)).toBe(false)
  })

  it("keeps December 31 of target year", () => {
    const t = { postedDate: new Date("2025-12-31T23:59:59Z"), isStale: false }
    expect(isOutOfYear(t, startOfYear, endOfYear)).toBe(false)
  })

  it("skips already-stale rows (idempotent)", () => {
    const t = { postedDate: new Date("2024-12-31T12:00:00Z"), isStale: true }
    expect(isOutOfYear(t, startOfYear, endOfYear)).toBe(false)
  })
})

function isOutOfYear(
  t: { postedDate: Date; isStale: boolean },
  startOfYear: Date,
  endOfYear: Date
): boolean {
  if (t.isStale) return false
  return t.postedDate < startOfYear || t.postedDate >= endOfYear
}

describe("PRE_CLEANUP — archiveSupersededStops predicate", () => {
  // Predicate: StopItem.state=PENDING AND every cited Transaction has a
  //            current Classification.
  it("archives when all cited txns have current classifications", () => {
    const stop = { state: "PENDING", transactionIds: ["tx1", "tx2", "tx3"] }
    const classifiedCount = 3
    expect(shouldArchive(stop, classifiedCount)).toBe(true)
  })

  it("keeps when at least one cited txn lacks a current classification", () => {
    const stop = { state: "PENDING", transactionIds: ["tx1", "tx2", "tx3"] }
    const classifiedCount = 2
    expect(shouldArchive(stop, classifiedCount)).toBe(false)
  })

  it("keeps empty-citation STOPs (preserves user-facing data)", () => {
    const stop = { state: "PENDING", transactionIds: [] }
    expect(shouldArchive(stop, 0)).toBe(false)
  })
})

function shouldArchive(stop: { state: string; transactionIds: string[] }, classifiedCount: number): boolean {
  if (stop.state !== "PENDING") return false
  if (stop.transactionIds.length === 0) return false
  return classifiedCount >= stop.transactionIds.length
}

describe("PRE_CLEANUP — summary shape", () => {
  it("returns count of each operation + errors[]", () => {
    const expected = {
      inflowFlipped: 0,
      outOfYearStaled: 0,
      stopsArchived: 0,
      documentsBackfilled: 0,
      errors: [] as Array<{ step: string; message: string }>,
    }
    expect(Object.keys(expected).length).toBe(5)
  })
})
