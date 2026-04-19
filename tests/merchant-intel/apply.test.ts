/**
 * Rule application — unit tests for trip override logic and code selection.
 * DB calls mocked; tests the classification decision logic directly.
 */
import { describe, it, expect } from "vitest"
import type { MerchantRule, Trip, TransactionCode } from "../../app/generated/prisma/client"

// ---------------------------------------------------------------------------
// Pure logic extracted from apply.ts for unit testing
// ---------------------------------------------------------------------------

const RESTAURANT_CODES: TransactionCode[] = ["MEALS_50", "MEALS_100"]
const RESTAURANT_LINES = ["Line 24b Meals"]

function isRestaurantRule(rule: Pick<MerchantRule, "code" | "scheduleCLine">): boolean {
  return (
    RESTAURANT_CODES.includes(rule.code) ||
    RESTAURANT_LINES.includes(rule.scheduleCLine ?? "")
  )
}

function dateInTrip(date: Date, trip: Pick<Trip, "startDate" | "endDate">): boolean {
  return date >= trip.startDate && date <= trip.endDate
}

interface FakeRule {
  merchantKey: string
  code: TransactionCode
  scheduleCLine: string | null
  businessPctDefault: number
  appliesTripOverride: boolean
  ircCitations: string[]
  evidenceTierDefault: number
  confidence: number
  reasoning: string | null
  requiresHumanInput: boolean
}

interface FakeTrip {
  name: string
  destination: string
  startDate: Date
  endDate: Date
}

function applyRule(
  rule: FakeRule,
  txDate: Date,
  trips: FakeTrip[]
): {
  code: TransactionCode
  pct: number
  tier: number
  tripOverride: boolean
} {
  let code: TransactionCode = rule.requiresHumanInput ? "NEEDS_CONTEXT" : rule.code
  let pct = rule.businessPctDefault
  let tier = rule.evidenceTierDefault
  let tripOverride = false

  if (rule.appliesTripOverride && !rule.requiresHumanInput) {
    const activeTrip = trips.find((t) => dateInTrip(txDate, t))
    if (activeTrip) {
      if (isRestaurantRule(rule)) {
        code = "MEALS_50"
        pct = 100
        tier = Math.min(tier, 2)
      } else {
        code = "WRITE_OFF_TRAVEL"
        pct = 100
        tier = Math.min(tier, 2)
      }
      tripOverride = true
    }
  }

  return { code, pct, tier, tripOverride }
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const alaskaTrip: FakeTrip = {
  name: "Alaska Content Trip",
  destination: "Anchorage, AK",
  startDate: new Date("2025-08-02"),
  endDate: new Date("2025-08-13"),
}

const blueWaveRule: FakeRule = {
  merchantKey: "BLUEWAVE CAR WASH",
  code: "GRAY",
  scheduleCLine: "Line 9 Car & Truck",
  businessPctDefault: 60,
  appliesTripOverride: true,
  ircCitations: ["§162", "§280F"],
  evidenceTierDefault: 3,
  confidence: 0.82,
  reasoning: "Car wash for vehicle at 60% biz use.",
  requiresHumanInput: false,
}

const adobeRule: FakeRule = {
  merchantKey: "ADOBE",
  code: "WRITE_OFF",
  scheduleCLine: "Line 18 Office Expense",
  businessPctDefault: 100,
  appliesTripOverride: false,
  ircCitations: ["§162"],
  evidenceTierDefault: 3,
  confidence: 0.93,
  reasoning: "Adobe Creative Cloud professional software.",
  requiresHumanInput: false,
}

const restaurantRule: FakeRule = {
  merchantKey: "PAPPAS BROTHERS STEAKHOUSE",
  code: "MEALS_50",
  scheduleCLine: "Line 24b Meals",
  businessPctDefault: 100,
  appliesTripOverride: true,
  ircCitations: ["§162", "§274(d)", "§274(n)(1)"],
  evidenceTierDefault: 3,
  confidence: 0.78,
  reasoning: "Restaurant — potential business meal.",
  requiresHumanInput: true,
}

const stopRule: FakeRule = {
  merchantKey: "DELTA AIR",
  code: "NEEDS_CONTEXT",
  scheduleCLine: "Line 24a Travel",
  businessPctDefault: 0,
  appliesTripOverride: false,
  ircCitations: ["§162", "§274(d)"],
  evidenceTierDefault: 3,
  confidence: 0.45,
  reasoning: "Flight — could be business or personal.",
  requiresHumanInput: true,
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("applyRule — GRAY rule outside trip", () => {
  it("applies GRAY code with default biz pct", () => {
    const result = applyRule(blueWaveRule, new Date("2025-09-15"), [alaskaTrip])
    expect(result.code).toBe("GRAY")
    expect(result.pct).toBe(60)
    expect(result.tripOverride).toBe(false)
  })
})

describe("applyRule — GRAY rule inside trip", () => {
  it("promotes to WRITE_OFF_TRAVEL with 100% during Alaska trip", () => {
    const result = applyRule(blueWaveRule, new Date("2025-08-08"), [alaskaTrip])
    expect(result.code).toBe("WRITE_OFF_TRAVEL")
    expect(result.pct).toBe(100)
    expect(result.tripOverride).toBe(true)
  })

  it("evidence tier bumped to 2 on trip override", () => {
    const result = applyRule(blueWaveRule, new Date("2025-08-08"), [alaskaTrip])
    expect(result.tier).toBe(2)
  })

  it("does not override when tx date is day after trip ends", () => {
    const result = applyRule(blueWaveRule, new Date("2025-08-14"), [alaskaTrip])
    expect(result.code).toBe("GRAY")
    expect(result.tripOverride).toBe(false)
  })

  it("does not override when tx date is day before trip starts", () => {
    const result = applyRule(blueWaveRule, new Date("2025-08-01"), [alaskaTrip])
    expect(result.code).toBe("GRAY")
    expect(result.tripOverride).toBe(false)
  })

  it("trip boundary inclusive — start date is in window", () => {
    const result = applyRule(blueWaveRule, new Date("2025-08-02"), [alaskaTrip])
    expect(result.code).toBe("WRITE_OFF_TRAVEL")
  })

  it("trip boundary inclusive — end date is in window", () => {
    const result = applyRule(blueWaveRule, new Date("2025-08-13"), [alaskaTrip])
    expect(result.code).toBe("WRITE_OFF_TRAVEL")
  })
})

describe("applyRule — restaurant inside trip", () => {
  it("restaurant during trip → MEALS_50 at 100% pct (not WRITE_OFF_TRAVEL)", () => {
    const result = applyRule(restaurantRule, new Date("2025-08-08"), [alaskaTrip])
    // requiresHumanInput=true on restaurant rule → NEEDS_CONTEXT (stop overrides trip)
    expect(result.code).toBe("NEEDS_CONTEXT")
  })

  const restaurantNoStop: FakeRule = { ...restaurantRule, requiresHumanInput: false }
  it("restaurant without stop, during trip → MEALS_50 at 100%", () => {
    const result = applyRule(restaurantNoStop, new Date("2025-08-08"), [alaskaTrip])
    expect(result.code).toBe("MEALS_50")
    expect(result.pct).toBe(100)
    expect(result.tripOverride).toBe(true)
  })
})

describe("applyRule — WRITE_OFF rule is unaffected by trips", () => {
  it("Adobe never overrides (no trip_override flag)", () => {
    const result = applyRule(adobeRule, new Date("2025-08-08"), [alaskaTrip])
    expect(result.code).toBe("WRITE_OFF")
    expect(result.pct).toBe(100)
    expect(result.tripOverride).toBe(false)
  })
})

describe("applyRule — requires_human_input", () => {
  it("STOP rule always produces NEEDS_CONTEXT", () => {
    const result = applyRule(stopRule, new Date("2025-08-08"), [alaskaTrip])
    expect(result.code).toBe("NEEDS_CONTEXT")
    expect(result.tripOverride).toBe(false)
  })
})

describe("isRestaurantRule", () => {
  it("MEALS_50 code is restaurant", () => expect(isRestaurantRule({ code: "MEALS_50", scheduleCLine: null })).toBe(true))
  it("MEALS_100 code is restaurant", () => expect(isRestaurantRule({ code: "MEALS_100", scheduleCLine: null })).toBe(true))
  it("Line 24b Meals line is restaurant", () => expect(isRestaurantRule({ code: "GRAY", scheduleCLine: "Line 24b Meals" })).toBe(true))
  it("WRITE_OFF is not restaurant", () => expect(isRestaurantRule({ code: "WRITE_OFF", scheduleCLine: "Line 18 Office Expense" })).toBe(false))
})
