import Anthropic from "@anthropic-ai/sdk"

const SYSTEM_PROMPT = `You are a merchant categorization assistant for bank/credit card statements.
Given a list of merchant names, return a JSON object mapping each merchant to a short human-readable category.

Use concise category labels like:
Fast Food, Coffee, Restaurant, Grocery, Gas & Fuel, Software, Streaming, Office Supplies,
Banking Fee, Payment Processing, Marketplace Sales, E-commerce, Travel, Hotel, Rideshare,
Fuel, Pharmacy, Medical, Books, Entertainment, Clothing, Personal Care, Tobacco,
Telecom, Transfer, Utilities, Insurance, Auto, Shipping, Government, Charity

Return ONLY valid JSON: {"MERCHANT_NAME": "Category", ...}
No prose, no markdown, no explanation.`

export async function batchCategorizeMerchants(
  merchants: string[],
  client?: Anthropic,
): Promise<Record<string, string>> {
  if (merchants.length === 0) return {}
  const anthropic = client ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  // Process in chunks of 80 to stay within token limits
  const chunks: string[][] = []
  for (let i = 0; i < merchants.length; i += 80) {
    chunks.push(merchants.slice(i, i + 80))
  }

  const result: Record<string, string> = {}
  for (const chunk of chunks) {
    try {
      const res = await anthropic.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 2048,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: JSON.stringify(chunk) }],
      })
      const block = res.content[0]
      if (!block || block.type !== "text") continue
      const text = block.text
      const s = text.indexOf("{")
      const e = text.lastIndexOf("}")
      if (s < 0 || e <= s) continue
      const parsed = JSON.parse(text.slice(s, e + 1)) as Record<string, string>
      Object.assign(result, parsed)
    } catch {
      // partial failure is fine — unknowns just show empty
    }
  }
  return result
}
