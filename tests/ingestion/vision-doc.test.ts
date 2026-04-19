/**
 * Vision-doc extractor — unit tests with mocked Anthropic client.
 */
import { describe, expect, it, vi } from "vitest"
import { extractViaVisionDoc } from "../../lib/parsers/vision-doc"

function mockAnthropic(responses: Array<{ text: string }>) {
  const create = vi.fn()
  for (const r of responses) {
    create.mockResolvedValueOnce({
      content: [{ type: "text", text: r.text }],
      usage: { input_tokens: 2000, output_tokens: 500 },
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
    expect(telemetry.model).toBe("claude-haiku-4-5")
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
})
