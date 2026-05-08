/**
 * Tier 1.1 — deriveStage unit tests.
 *
 * Pure function — no DB. Verifies the row-count thresholds that map a tax
 * year onto its TaxYearStatus.
 */

import { describe, it, expect } from "vitest"
import { deriveStage } from "../lib/taxYear/status"

describe("deriveStage", () => {
  it("LOCKED short-circuits regardless of counts", () => {
    expect(
      deriveStage(
        { status: "INGESTION", lockedAt: new Date("2026-01-01") },
        { totalTx: 100, classifiedTx: 0, pendingStops: 50 },
      ),
    ).toBe("LOCKED")
    expect(
      deriveStage(
        { status: "LOCKED", lockedAt: null },
        { totalTx: 0, classifiedTx: 0, pendingStops: 0 },
      ),
    ).toBe("LOCKED")
  })

  it("ARCHIVED stays ARCHIVED", () => {
    expect(
      deriveStage(
        { status: "ARCHIVED", lockedAt: null },
        { totalTx: 100, classifiedTx: 100, pendingStops: 0 },
      ),
    ).toBe("ARCHIVED")
  })

  it("CREATED with no transactions stays CREATED", () => {
    expect(
      deriveStage(
        { status: "CREATED", lockedAt: null },
        { totalTx: 0, classifiedTx: 0, pendingStops: 0 },
      ),
    ).toBe("CREATED")
  })

  it("INGESTION with no transactions stays INGESTION", () => {
    expect(
      deriveStage(
        { status: "INGESTION", lockedAt: null },
        { totalTx: 0, classifiedTx: 0, pendingStops: 0 },
      ),
    ).toBe("INGESTION")
  })

  it("transactions present, none classified → INGESTION", () => {
    expect(
      deriveStage(
        { status: "CREATED", lockedAt: null },
        { totalTx: 100, classifiedTx: 0, pendingStops: 0 },
      ),
    ).toBe("INGESTION")
  })

  it("partial classification → CLASSIFICATION", () => {
    expect(
      deriveStage(
        { status: "INGESTION", lockedAt: null },
        { totalTx: 100, classifiedTx: 60, pendingStops: 0 },
      ),
    ).toBe("CLASSIFICATION")
  })

  it("fully classified but pending STOPs → CLASSIFICATION", () => {
    expect(
      deriveStage(
        { status: "INGESTION", lockedAt: null },
        { totalTx: 100, classifiedTx: 100, pendingStops: 7 },
      ),
    ).toBe("CLASSIFICATION")
  })

  it("STOPs without classifications still counts as CLASSIFICATION", () => {
    expect(
      deriveStage(
        { status: "INGESTION", lockedAt: null },
        { totalTx: 100, classifiedTx: 0, pendingStops: 12 },
      ),
    ).toBe("CLASSIFICATION")
  })

  it("fully classified, zero STOPs → REVIEW (lock-ready)", () => {
    expect(
      deriveStage(
        { status: "CLASSIFICATION", lockedAt: null },
        { totalTx: 536, classifiedTx: 536, pendingStops: 0 },
      ),
    ).toBe("REVIEW")
  })

  it("classified > total (split children) → REVIEW", () => {
    // After Amazon-split a parent flips isCurrent=false and child rows get
    // their own classifications. Total non-duplicate count temporarily
    // exceeds the totalTx denominator until the parent is filtered out.
    expect(
      deriveStage(
        { status: "CLASSIFICATION", lockedAt: null },
        { totalTx: 100, classifiedTx: 102, pendingStops: 0 },
      ),
    ).toBe("REVIEW")
  })

  it("Atif-style live state (536/536, 94 stops) → CLASSIFICATION", () => {
    // Reproduces the bug observed in production: year stuck on INGESTION
    // even though 536/536 are classified and 94 STOPs are pending. Derived
    // stage should be CLASSIFICATION until the STOPs queue drains.
    expect(
      deriveStage(
        { status: "INGESTION", lockedAt: null },
        { totalTx: 536, classifiedTx: 536, pendingStops: 94 },
      ),
    ).toBe("CLASSIFICATION")
  })
})
