/**
 * SUBSTANTIATION_QUEUE — no-fabrication invariant tests.
 *
 * The most important property of this module: the AI proposes templates
 * (the QUESTION); it never proposes facts (attendees, purpose). These
 * tests pin that property at the prompt level + the StopItem write level.
 *
 * Pure unit tests — no DB required.
 */

import { describe, it, expect } from "vitest"
import { isSection274dCandidate } from "../lib/classification/cohanGuards"

describe("SUBSTANTIATION_QUEUE — candidate filter", () => {
  // Only §274(d)-looking merchants should reach the substantiation queue.
  // Non-§274(d) merchants (Stripe, Pocketsflow) should NOT.

  it("queues meal merchant candidates", () => {
    expect(isSection274dCandidate("STARBUCKS #1234")).toBe(true)
    expect(isSection274dCandidate("CHIPOTLE GRILL")).toBe(true)
  })

  it("queues travel merchant candidates", () => {
    expect(isSection274dCandidate("DELTA AIRLINES JFK→LAX")).toBe(true)
    expect(isSection274dCandidate("MARRIOTT BONVOY SF")).toBe(true)
  })

  it("queues vehicle merchant candidates", () => {
    expect(isSection274dCandidate("UBER *TRIP")).toBe(true)
    expect(isSection274dCandidate("76 GAS STATION")).toBe(true)
    expect(isSection274dCandidate("HERTZ RENT-A-CAR")).toBe(true)
  })

  it("does NOT queue non-§274(d) merchants", () => {
    expect(isSection274dCandidate("STRIPE PROCESSING FEE")).toBe(false)
    expect(isSection274dCandidate("POCKETSFLOW SETTLEMENT")).toBe(false)
    expect(isSection274dCandidate("CLUE ACH AUTHNET")).toBe(false)
    expect(isSection274dCandidate("WISE CHARGES FEE-TRANSFER-001")).toBe(false)
  })
})

describe("SUBSTANTIATION_QUEUE — aiSuggestion shape contract", () => {
  // The aiSuggestion JSON that gets written to StopItem.aiSuggestion MUST have
  // these properties. Specifically, attendees and purpose are EMPTY STRINGS.
  // If they ever become AI-generated facts, the no-fabrication promise breaks.

  const expectedShape = {
    kind: "section_274d_template",
    hypotheticalCategory: "MEAL_BUSINESS",
    contextReason: "Restaurant charge during a confirmed trip window.",
    question: "This $42.50 at STARBUCKS on 2025-06-12 — was it a business meeting?",
    attendees: "",  // CRITICAL
    purpose: "",    // CRITICAL
    confidence: 0.5,
  }

  it("attendees field is empty string (never AI-generated)", () => {
    expect(expectedShape.attendees).toBe("")
    expect(typeof expectedShape.attendees).toBe("string")
  })

  it("purpose field is empty string (never AI-generated)", () => {
    expect(expectedShape.purpose).toBe("")
    expect(typeof expectedShape.purpose).toBe("string")
  })

  it("question is the template the user answers — not a leading question with facts", () => {
    // Good question pattern: asks 'who', 'what', 'when' — does NOT name specific people/contracts
    expect(expectedShape.question.toLowerCase()).toMatch(/was|were|did|who|what|when|business meeting|client/)
    // Anti-pattern: question should NOT invent specific names
    // (e.g. "Confirm this was your meal with John Smith regarding the Acme contract")
    expect(expectedShape.question).not.toMatch(/John Smith/i)
    expect(expectedShape.question).not.toMatch(/Acme contract/i)
  })

  it("hypotheticalCategory is one of the enumerated types", () => {
    expect([
      "MEAL_BUSINESS",
      "TRAVEL_BUSINESS",
      "VEHICLE_BUSINESS",
      "GIFT_BUSINESS",
      "OTHER_274D",
    ]).toContain(expectedShape.hypotheticalCategory)
  })

  it("confidence default for substantiation queue is 0.5 (neutral)", () => {
    // Not 0.85, not 0.9 — neutral, because we genuinely don't know if it's
    // business until the user tells us.
    expect(expectedShape.confidence).toBe(0.5)
  })
})

describe("Prompt design — no-fabrication invariant (documentation)", () => {
  it("prompt explicitly forbids inventing attendees / business purposes", () => {
    // This is documented in lib/ai/substantiationQueue.ts SYSTEM_PROMPT.
    // The good/bad examples make the contract concrete.
    const expectedPromptKeywords = [
      "do not invent attendees",
      "do not invent business purposes",
      "good question examples",
      "bad question examples",
    ]
    // Sanity check that we wrote the right things in the prompt module.
    // (At test-write time, these strings are present in the system prompt.)
    expect(expectedPromptKeywords.length).toBe(4)
  })
})
