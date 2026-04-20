/**
 * Haiku Cleanup extractor — unit tests with mocked Anthropic client.
 */
import { describe, expect, it, vi } from "vitest"
import { extractViaHaikuCleanup } from "../../lib/parsers/haiku-cleanup"

function mockAnthropic(responses: Array<{ text: string; in?: number; out?: number }>) {
  const create = vi.fn()
  for (const r of responses) {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: r.text }],
      usage: { input_tokens: r.in ?? 100, output_tokens: r.out ?? 50 },
    })
  }
  return { messages: { create } } as unknown as import("@anthropic-ai/sdk").default
}

const validExtraction = {
  institution: "Chase Freedom",
  periodStart: "2025-02-01",
  periodEnd: "2025-02-28",
  transactions: [
    {
      postedDate: "2025-02-05",
      transactionDate: "2025-02-04",
      amount: 54.99,
      direction: "outflow",
      merchantRaw: "ADOBE CREATIVE CLOUD",
      description: null,
    },
    {
      postedDate: "2025-02-15",
      transactionDate: null,
      amount: 100.0,
      direction: "inflow",
      merchantRaw: "PAYMENT THANK YOU",
      description: null,
    },
  ],
  confidence: 0.92,
}

describe("extractViaHaikuCleanup", () => {
  it("parses valid JSON and returns normalized RawTx[]", async () => {
    const client = mockAnthropic([{ text: JSON.stringify(validExtraction) }])
    const { parseResult, telemetry } = await extractViaHaikuCleanup("raw pdf text", client)

    expect(parseResult.ok).toBe(true)
    expect(parseResult.transactions).toHaveLength(2)
    expect(parseResult.transactions[0]!.amountNormalized).toBe(54.99) // outflow positive
    expect(parseResult.transactions[1]!.amountNormalized).toBe(-100) // inflow negative
    expect(parseResult.totalInflows).toBe(100)
    expect(parseResult.totalOutflows).toBe(54.99)
    expect(telemetry.confidence).toBe(0.92)
    expect(telemetry.apiCalls).toBe(1)
    expect(telemetry.model).toBe("claude-haiku-4-5-20251001")
  })

  it("retries on Sonnet when Haiku confidence < 0.6", async () => {
    const client = mockAnthropic([
      { text: JSON.stringify({ ...validExtraction, confidence: 0.4 }) },
      { text: JSON.stringify({ ...validExtraction, confidence: 0.85 }) },
    ])
    const { telemetry } = await extractViaHaikuCleanup("x", client)
    expect(telemetry.apiCalls).toBe(2)
    expect(telemetry.model).toBe("claude-sonnet-4-6")
    expect(telemetry.confidence).toBe(0.85)
  })

  it("returns ok=false when both Haiku and Sonnet fail to parse", async () => {
    const client = mockAnthropic([
      { text: "not json at all $$$" },
      { text: "still broken" },
    ])
    const { parseResult, telemetry } = await extractViaHaikuCleanup("x", client)
    expect(parseResult.ok).toBe(false)
    expect(parseResult.error).toMatch(/failed/i)
    expect(telemetry.apiCalls).toBe(2)
    expect(telemetry.confidence).toBe(0)
  })

  it("strips markdown code fences", async () => {
    const fenced = "```json\n" + JSON.stringify(validExtraction) + "\n```"
    const client = mockAnthropic([{ text: fenced }])
    const { parseResult } = await extractViaHaikuCleanup("x", client)
    expect(parseResult.transactions).toHaveLength(2)
  })

  it("skips transactions with unparseable dates", async () => {
    const bad = {
      ...validExtraction,
      transactions: [
        ...validExtraction.transactions,
        {
          postedDate: "not-a-date",
          transactionDate: null,
          amount: 20,
          direction: "outflow",
          merchantRaw: "BAD DATE",
          description: null,
        },
      ],
    }
    const client = mockAnthropic([{ text: JSON.stringify(bad) }])
    const { parseResult } = await extractViaHaikuCleanup("x", client)
    expect(parseResult.transactions).toHaveLength(2) // bad one dropped
  })
})
