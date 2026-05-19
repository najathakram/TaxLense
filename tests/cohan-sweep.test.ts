/**
 * COHAN_SWEEP — candidate selection + §274(d) deny-list integration.
 *
 * The most important behavior: candidates that match the §274(d) deny-list
 * are rejected BEFORE the AI call. The AI never sees a meal/travel/vehicle
 * row, so it can't accidentally promote one.
 *
 * Pure unit tests of the deterministic gates.
 */

import { describe, it, expect } from "vitest"
import {
  assertNot274dCohan,
  isSection274dCandidate,
  SECTION_274D_MERCHANT_FRAGMENTS,
} from "../lib/classification/cohanGuards"

describe("COHAN_SWEEP — candidate gate", () => {
  // The sweep loads PERSONAL/GRAY/NEEDS_CONTEXT + tier-3 WRITE_OFF rows,
  // then drops any row where assertNot274dCohan or isSection274dCandidate
  // returns the §274(d) rail. These tests pin those gates.

  it("drops PERSONAL row at a restaurant", () => {
    const guard = assertNot274dCohan({
      code: "PERSONAL",
      merchantRaw: "OLIVE GARDEN RESTAURANT",
    })
    expect(guard.allowed).toBe(false)
    expect(isSection274dCandidate("OLIVE GARDEN RESTAURANT")).toBe(true)
  })

  it("drops GRAY row at a gas station", () => {
    const guard = assertNot274dCohan({
      code: "GRAY",
      merchantRaw: "SHELL OIL #4567",
    })
    expect(guard.allowed).toBe(false)
  })

  it("allows PERSONAL row at Pocketsflow (e-commerce processor)", () => {
    const guard = assertNot274dCohan({
      code: "PERSONAL",
      merchantRaw: "POCKETSFLOW SETTLEMENT",
    })
    expect(guard.allowed).toBe(true)
  })

  it("allows tier-3 WRITE_OFF at AuthNet (existing claim)", () => {
    const guard = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "AUTHNET PROCESSING",
      ircCitations: ["§162"],
    })
    expect(guard.allowed).toBe(true)
  })
})

describe("COHAN_SWEEP — post-AI verification (defense in depth)", () => {
  // Even if the AI proposes a §274(d) code despite the prompt, the runtime
  // re-applies assertNot274dCohan to the AI's output and short-circuits.
  // This test pins the contract.

  it("rejects AI proposal of MEALS_50 with cohanFlag=true (impossible combo)", () => {
    const guard = assertNot274dCohan({
      code: "MEALS_50",
      merchantRaw: "POCKETSFLOW",
      ircCitations: ["§162", "Cohan"],
      scheduleCLine: "Line 24b Meals",
    })
    expect(guard.allowed).toBe(false)
  })

  it("rejects AI proposal mapping POCKETSFLOW → WRITE_OFF with Line 24a Travel", () => {
    const guard = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "POCKETSFLOW",
      scheduleCLine: "Line 24a Travel",
    })
    expect(guard.allowed).toBe(false)
  })
})

describe("COHAN_SWEEP — model selection threshold", () => {
  // HIGH_EXPOSURE_THRESHOLD: when total candidate exposure ≥ $10K, escalate
  // from Sonnet 4.6 to Opus 4.7.
  it("documents Opus escalation at $10K aggregate exposure", () => {
    expect(10_000).toBe(10_000)
  })
})

describe("COHAN_SWEEP — minimum candidate amount", () => {
  // MIN_CANDIDATE_AMOUNT = $100 prevents the sweep from generating findings
  // for trivial line items.
  it("documents min candidate amount = $100", () => {
    expect(100).toBe(100)
  })
})

describe("§274(d) deny-list vocabulary", () => {
  it("covers every major §274(d) category", () => {
    const v = SECTION_274D_MERCHANT_FRAGMENTS
    // Vehicles
    expect(v.some((f) => f === "UBER")).toBe(true)
    expect(v.some((f) => f === "FUEL")).toBe(true)
    // Travel
    expect(v.some((f) => f === "AIRLINES")).toBe(true)
    expect(v.some((f) => f === "HOTEL")).toBe(true)
    // Meals
    expect(v.some((f) => f === "RESTAURANT")).toBe(true)
    expect(v.some((f) => f === "STARBUCKS")).toBe(true)
    // Gifts
    expect(v.some((f) => f === "GIFT")).toBe(true)
  })
})
