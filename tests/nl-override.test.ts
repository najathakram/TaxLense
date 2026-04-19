/**
 * Session 5 — Natural-language override tests
 *
 * Covers:
 *  - NLResponseSchema validates the expected Claude output shape
 *  - reclassifyByInstruction parses a mocked Anthropic response
 *  - Retries on invalid JSON
 */

import { describe, it, expect, vi } from "vitest"
import { NLResponseSchema, reclassifyByInstruction, type NLCandidate } from "../lib/ai/reclassifyNL"

const CANDIDATES: NLCandidate[] = [
  {
    id: "tx_1",
    date: "2025-06-01",
    merchantNormalized: "SHELL",
    merchantRaw: "SHELL OIL 12345",
    amount: 42.5,
    currentCode: "WRITE_OFF",
    currentPct: 100,
  },
  {
    id: "tx_2",
    date: "2025-06-02",
    merchantNormalized: "SHELL",
    merchantRaw: "SHELL OIL 67890",
    amount: 55,
    currentCode: "WRITE_OFF",
    currentPct: 100,
  },
]

const CTX = {
  naics: "711510",
  businessDescription: "Wedding photographer",
  trips: [],
  entities: [],
}

function mockClient(response: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: response }],
      }),
    },
  } as unknown as import("@anthropic-ai/sdk").default
}

describe("NLResponseSchema", () => {
  it("accepts a valid payload", () => {
    const parsed = NLResponseSchema.parse({
      matches: [
        {
          transactionId: "tx_1",
          newCode: "GRAY",
          newBusinessPct: 60,
          newScheduleCLine: "Line 9 Car & Truck",
          ircCitations: ["§162"],
          evidenceTier: 3,
          reasoning: "Gasoline at 60% per user instruction.",
        },
      ],
      rule_updates: [],
    })
    expect(parsed.matches).toHaveLength(1)
  })

  it("rejects unknown code", () => {
    expect(() =>
      NLResponseSchema.parse({
        matches: [
          {
            transactionId: "tx_1",
            newCode: "BOGUS",
            newBusinessPct: 50,
            newScheduleCLine: null,
            ircCitations: [],
            evidenceTier: 3,
            reasoning: "bad",
          },
        ],
        rule_updates: [],
      })
    ).toThrow()
  })
})

describe("reclassifyByInstruction", () => {
  it("parses a mocked, well-formed response", async () => {
    const response = JSON.stringify({
      matches: [
        {
          transactionId: "tx_1",
          newCode: "GRAY",
          newBusinessPct: 60,
          newScheduleCLine: "Line 9 Car & Truck",
          ircCitations: ["§162"],
          evidenceTier: 3,
          reasoning: "Gasoline outside trips at 60%.",
        },
        {
          transactionId: "tx_2",
          newCode: "GRAY",
          newBusinessPct: 60,
          newScheduleCLine: "Line 9 Car & Truck",
          ircCitations: ["§162"],
          evidenceTier: 3,
          reasoning: "Gasoline outside trips at 60%.",
        },
      ],
      rule_updates: [
        {
          merchantKey: "SHELL",
          code: "GRAY",
          businessPctDefault: 60,
          scheduleCLine: "Line 9 Car & Truck",
          ircCitations: ["§162"],
          reasoning: "User policy: gasoline outside trips is 60% biz.",
        },
      ],
    })
    const client = mockClient(response)
    const result = await reclassifyByInstruction(
      "Mark all gasoline charges outside trips as 60% business",
      CANDIDATES,
      CTX,
      client
    )
    expect(result.matches).toHaveLength(2)
    expect(result.matches[0]!.newBusinessPct).toBe(60)
    expect(result.rule_updates).toHaveLength(1)
    expect(result.rule_updates[0]!.merchantKey).toBe("SHELL")
  })

  it("retries once on malformed JSON then succeeds", async () => {
    const goodResponse = JSON.stringify({
      matches: [
        {
          transactionId: "tx_1",
          newCode: "PERSONAL",
          newBusinessPct: 0,
          newScheduleCLine: null,
          ircCitations: ["§262"],
          evidenceTier: 3,
          reasoning: "Flagged personal.",
        },
      ],
      rule_updates: [],
    })
    const create = vi
      .fn()
      .mockResolvedValueOnce({ content: [{ type: "text", text: "not json" }] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: goodResponse }] })
    const client = {
      messages: { create },
    } as unknown as import("@anthropic-ai/sdk").default

    const result = await reclassifyByInstruction("flag as personal", CANDIDATES, CTX, client)
    expect(result.matches[0]!.newCode).toBe("PERSONAL")
    expect(create).toHaveBeenCalledTimes(2)
  })

  it("handles fenced JSON response", async () => {
    const response = "```json\n" + JSON.stringify({ matches: [], rule_updates: [] }) + "\n```"
    const client = mockClient(response)
    const result = await reclassifyByInstruction("test", CANDIDATES, CTX, client)
    expect(result.matches).toHaveLength(0)
  })
})
