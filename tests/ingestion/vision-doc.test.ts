/**
 * Vision-doc extractor — unit tests with mocked Anthropic client.
 */
import { describe, expect, it, vi } from "vitest"
import { extractViaVisionDoc } from "../../lib/parsers/vision-doc"

function mockAnthropic(
  responses: Array<{ text: string; stop_reason?: string; out?: number }>,
) {
  const create = vi.fn()
  for (const r of responses) {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: r.text }],
      usage: { input_tokens: 2000, output_tokens: r.out ?? 500 },
      stop_reason: r.stop_reason ?? "end_turn",
    })
  }
  return { messages: { create } } as unknown as import("@anthropic-ai/sdk").default
}

const validExtraction = {
  institution: "Chase Checking",
  periodStart: "2025-03-01",
  periodEnd: "2025-03-31",
  transactions: [
    {
      postedDate: "2025-03-05",
      transactionDate: null,
      amount: 200,
      direction: "outflow",
      merchantRaw: "ZELLE TO FRANCISCO",
      description: null,
    },
  ],
  confidence: 0.8,
}

describe("extractViaVisionDoc", () => {
  it("sends document block and parses extraction", async () => {
    const client = mockAnthropic([{ text: JSON.stringify(validExtraction) }])
    const fakePdf = Buffer.from("%PDF-1.4 fake content")
    const { parseResult, telemetry } = await extractViaVisionDoc(fakePdf, client)

    expect(parseResult.ok).toBe(true)
    expect(parseResult.transactions).toHaveLength(1)
    expect(telemetry.model).toBe("claude-haiku-4-5-20251001")
    expect(telemetry.apiCalls).toBe(1)

    const createCall = (client.messages.create as ReturnType<typeof vi.fn>).mock.calls[0]![0]
    const firstMsg = createCall.messages[0]
    expect(firstMsg.role).toBe("user")
    const blocks = firstMsg.content as Array<{ type: string }>
    expect(blocks.some((b) => b.type === "document")).toBe(true)
    expect(blocks.some((b) => b.type === "text")).toBe(true)
  })

  it("retries on Sonnet when confidence < 0.6", async () => {
    const client = mockAnthropic([
      { text: JSON.stringify({ ...validExtraction, confidence: 0.3 }) },
      { text: JSON.stringify({ ...validExtraction, confidence: 0.8 }) },
    ])
    const { telemetry } = await extractViaVisionDoc(Buffer.from("x"), client)
    expect(telemetry.apiCalls).toBe(2)
    expect(telemetry.model).toBe("claude-sonnet-4-6")
  })

  it("returns ok=false on double failure", async () => {
    const client = mockAnthropic([{ text: "garbage" }, { text: "still garbage" }])
    const { parseResult } = await extractViaVisionDoc(Buffer.from("x"), client)
    expect(parseResult.ok).toBe(false)
  })

  it("surfaces stop_reason=max_tokens in the error when output is truncated", async () => {
    const truncated = JSON.stringify(validExtraction).slice(0, 80)
    const client = mockAnthropic([
      { text: truncated, stop_reason: "max_tokens", out: 16384 },
      { text: truncated, stop_reason: "max_tokens", out: 16384 },
    ])
    const { parseResult, telemetry } = await extractViaVisionDoc(Buffer.from("x"), client)
    expect(parseResult.ok).toBe(false)
    expect(parseResult.error).toMatch(/stop_reason=max_tokens/)
    expect(telemetry.apiCalls).toBe(2)
  })

  it("handles a 140-tx extraction at the raised max_tokens ceiling", async () => {
    const many = Array.from({ length: 140 }, (_, i) => ({
      postedDate: `2025-03-${String((i % 28) + 1).padStart(2, "0")}`,
      transactionDate: null,
      amount: 5 + i,
      direction: i % 2 === 0 ? "outflow" : "inflow",
      merchantRaw: `M_${i}`,
      description: null,
    }))
    const payload = { ...validExtraction, transactions: many, confidence: 0.9 }
    const client = mockAnthropic([
      { text: JSON.stringify(payload), stop_reason: "end_turn", out: 12000 },
    ])
    const { parseResult, telemetry } = await extractViaVisionDoc(Buffer.from("x"), client)
    expect(parseResult.ok).toBe(true)
    expect(parseResult.transactions).toHaveLength(140)
    expect(telemetry.confidence).toBe(0.9)
    expect(telemetry.apiCalls).toBe(1)
  })
})
