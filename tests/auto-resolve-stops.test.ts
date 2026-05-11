/**
 * Unit tests for lib/ai/autoResolveStops.ts — verifies the new failure-tolerant
 * shape that fixed the "auto-resolve only resolves some of them" bug.
 *
 * Covers:
 *  - Zod validates AI response and drops rows with unknown codes / out-of-range pct
 *  - scheduleCLine is backfilled for WRITE_OFF codes when AI returns null
 *  - scheduleCLine is FORCED to null for non-deductible codes (PAYMENT/TRANSFER/PERSONAL)
 *  - Stops the AI didn't return are surfaced in `drops` map as "missing_from_response"
 *  - Hallucinated stopIds (not in batch) are dropped as "unknown_stop_id"
 *  - businessPct out-of-range is clamped to [0, 100]
 *  - Default IRC citations are added when AI returns empty list
 *  - System prompt includes the parameterized business context (no hardcoded names)
 */

import { describe, it, expect, vi } from "vitest"
import type Anthropic from "@anthropic-ai/sdk"
import {
  classifyStopsWithAIDetailed,
  type StopForAI,
  type BusinessContext,
} from "../lib/ai/autoResolveStops"

function fakeAnthropic(responseText: string): Anthropic {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
      }),
    },
  } as unknown as Anthropic
}

const ctx: BusinessContext = {
  description: "Wholesale resale via eBay",
  naics: "454110",
  ownerName: "Atif Ameer",
  year: 2025,
  notes: "Wise = supplier payments to Pakistan",
}

const sampleStops: StopForAI[] = [
  {
    stopId: "s_1",
    merchantKey: "EBAY PAYOUT",
    category: "DEPOSIT",
    totalAmount: 5000,
    txnCount: 1,
    samples: [{ date: "2025-06-01", account: "Chase", raw: "EBAY MARKETPLACE PAYOUT", amount: -5000 }],
  },
  {
    stopId: "s_2",
    merchantKey: "WISE FEE",
    category: "MERCHANT",
    totalAmount: 12,
    txnCount: 1,
    samples: [{ date: "2025-06-02", account: "Wise", raw: "WISE FEE", amount: 12 }],
  },
  {
    stopId: "s_3",
    merchantKey: "PAYMENT THANK YOU",
    category: "MERCHANT",
    totalAmount: 1500,
    txnCount: 1,
    samples: [{ date: "2025-06-03", account: "Chase CC", raw: "PAYMENT THANK YOU", amount: 1500 }],
  },
]

describe("classifyStopsWithAIDetailed", () => {
  it("backfills scheduleCLine on a WRITE_OFF when AI omits it", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_2", code: "WRITE_OFF", businessPct: 100, scheduleCLine: null, ircCitations: ["§162"], confidence: 0.95, reasoning: "wire fee", applyToSimilar: true },
    ]))
    const { resolutions } = await classifyStopsWithAIDetailed([sampleStops[1]!], ctx, ai)
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]!.scheduleCLine).toBe("Line 27a Other Expenses")
  })

  it("forces scheduleCLine to null for PAYMENT", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_3", code: "PAYMENT", businessPct: 0, scheduleCLine: "Line 27a Other Expenses", ircCitations: [], confidence: 1.0, reasoning: "card payment", applyToSimilar: true },
    ]))
    const { resolutions } = await classifyStopsWithAIDetailed([sampleStops[2]!], ctx, ai)
    expect(resolutions[0]!.scheduleCLine).toBeNull()
  })

  it("clamps businessPct to [0, 100]", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_2", code: "WRITE_OFF", businessPct: 150, scheduleCLine: "Line 27a Other Expenses", ircCitations: ["§162"], confidence: 0.9, reasoning: "x", applyToSimilar: false },
    ]))
    const { resolutions } = await classifyStopsWithAIDetailed([sampleStops[1]!], ctx, ai)
    expect(resolutions[0]!.businessPct).toBe(100)
  })

  it("clamps confidence to [0, 1]", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_2", code: "WRITE_OFF", businessPct: 100, scheduleCLine: "Line 27a Other Expenses", ircCitations: ["§162"], confidence: 5, reasoning: "x", applyToSimilar: false },
    ]))
    const { resolutions } = await classifyStopsWithAIDetailed([sampleStops[1]!], ctx, ai)
    expect(resolutions[0]!.confidence).toBe(1)
  })

  it("backfills default IRC citations when AI returns empty array", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_1", code: "BIZ_INCOME", businessPct: 0, scheduleCLine: "Line 1 Gross Receipts", ircCitations: [], confidence: 0.95, reasoning: "marketplace payout", applyToSimilar: true },
    ]))
    const { resolutions } = await classifyStopsWithAIDetailed([sampleStops[0]!], ctx, ai)
    expect(resolutions[0]!.ircCitations).toEqual(["§61"])
  })

  it("drops rows with stopIds that weren't in the batch (hallucinated)", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_999", code: "WRITE_OFF", businessPct: 100, scheduleCLine: "Line 27a Other Expenses", ircCitations: ["§162"], confidence: 0.9, reasoning: "x", applyToSimilar: false },
    ]))
    const { resolutions, drops } = await classifyStopsWithAIDetailed([sampleStops[1]!], ctx, ai)
    expect(resolutions).toHaveLength(0)
    expect(drops.get("s_999")).toBe("unknown_stop_id")
    expect(drops.get("s_2")).toBe("missing_from_response")
  })

  it("drops rows with unknown codes via Zod", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_2", code: "MAGIC_CODE", businessPct: 100, scheduleCLine: "Line 27a Other Expenses", ircCitations: ["§162"], confidence: 0.9, reasoning: "x", applyToSimilar: false },
    ]))
    const { resolutions, drops } = await classifyStopsWithAIDetailed([sampleStops[1]!], ctx, ai)
    expect(resolutions).toHaveLength(0)
    expect(drops.get("s_2")).toBe("validation_failed")
  })

  it("returns missing_from_response for stops the AI never echoed back", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_1", code: "BIZ_INCOME", businessPct: 0, scheduleCLine: "Line 1 Gross Receipts", ircCitations: ["§61"], confidence: 0.95, reasoning: "x", applyToSimilar: true },
    ]))
    const { resolutions, drops } = await classifyStopsWithAIDetailed(sampleStops, ctx, ai)
    expect(resolutions).toHaveLength(1)
    expect(drops.get("s_2")).toBe("missing_from_response")
    expect(drops.get("s_3")).toBe("missing_from_response")
  })

  it("survives a malformed JSON response by falling back through retries", async () => {
    // First call returns junk, second call (Haiku fallback) returns valid.
    const fakeClient = {
      messages: {
        create: vi.fn()
          .mockResolvedValueOnce({ content: [{ type: "text", text: "not json at all" }] })
          .mockResolvedValueOnce({ content: [{ type: "text", text: "still not json" }] })
          .mockResolvedValueOnce({ content: [{ type: "text", text: JSON.stringify([
            { stopId: "s_2", code: "WRITE_OFF", businessPct: 100, scheduleCLine: "Line 27a Other Expenses", ircCitations: ["§162"], confidence: 0.9, reasoning: "wise fee", applyToSimilar: true },
          ]) }] }),
      },
    } as unknown as Anthropic
    const { resolutions } = await classifyStopsWithAIDetailed([sampleStops[1]!], ctx, fakeClient)
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]!.code).toBe("WRITE_OFF")
  })

  it("partial-validates: even one good row out of a bad batch is preserved", async () => {
    const ai = fakeAnthropic(JSON.stringify([
      { stopId: "s_1", code: "MAGIC_CODE", businessPct: 0, scheduleCLine: null, ircCitations: [], confidence: 0.9, reasoning: "bad", applyToSimilar: false },
      { stopId: "s_2", code: "WRITE_OFF", businessPct: 100, scheduleCLine: "Line 27a Other Expenses", ircCitations: ["§162"], confidence: 0.95, reasoning: "good", applyToSimilar: true },
    ]))
    const { resolutions, drops } = await classifyStopsWithAIDetailed(sampleStops.slice(0, 2), ctx, ai)
    // The whole-batch Zod parse fails, so we fall through to per-row partial validation.
    expect(resolutions).toHaveLength(1)
    expect(resolutions[0]!.stopId).toBe("s_2")
    expect(drops.get("s_1")).toBe("validation_failed")
  })

  it("passes the parameterized business context into the system prompt", async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify([
        { stopId: "s_2", code: "WRITE_OFF", businessPct: 100, scheduleCLine: "Line 27a Other Expenses", ircCitations: ["§162"], confidence: 0.9, reasoning: "x", applyToSimilar: false },
      ]) }],
    })
    const ai = { messages: { create } } as unknown as Anthropic
    await classifyStopsWithAIDetailed([sampleStops[1]!], ctx, ai)
    expect(create).toHaveBeenCalled()
    const call = create.mock.calls[0]![0]
    const sys = call.system as string
    // System prompt MUST include the live business profile (no hardcoded "SA Wholesale / Atif").
    expect(sys).toContain("Atif Ameer")
    expect(sys).toContain("454110")
    expect(sys).toContain("Wise = supplier payments to Pakistan")
    // And must NOT contain the legacy hardcoded header.
    expect(sys).not.toContain("SA Wholesale LLC")
  })
})
