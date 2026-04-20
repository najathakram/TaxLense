/**
 * AI-assisted bulk classification of PENDING StopItems.
 * Uses claude-sonnet-4-6 for accuracy — these are real tax classifications.
 */
import Anthropic from "@anthropic-ai/sdk"
import type { TransactionCode } from "@/app/generated/prisma/client"

export interface StopForAI {
  stopId: string
  merchantKey: string
  category: string
  totalAmount: number
  txnCount: number
  /** sample transactions (first 5) */
  samples: Array<{ date: string; account: string; raw: string; amount: number }>
}

export interface StopResolution {
  stopId: string
  code: TransactionCode
  businessPct: number
  scheduleCLine: string | null
  ircCitations: string[]
  confidence: number
  reasoning: string
  applyToSimilar: boolean
}

const SYSTEM_PROMPT = `You are a tax classification expert for a US sole proprietor / single-member LLC bookkeeper.

Business context: SA Wholesale LLC — a wholesale resale business. It buys goods and resells them (primarily via eBay and other online marketplaces). It uses Wise to pay overseas suppliers (Pakistan). It uses Stripe to receive marketplace payouts. Contractors are paid via Pocketsflow or Zelle. The owner's name is Atif.

Classify each transaction STOP item. For each, return the most accurate US federal Schedule C classification.

Available codes:
- BIZ_INCOME  — gross business income / receipt (no deduction)
- WRITE_OFF    — deductible business expense at businessPct% (Schedule C line required)
- WRITE_OFF_COGS — cost of goods sold (Part III, reduces gross profit)
- WRITE_OFF_TRAVEL — 100% business travel (Line 24a)
- MEALS_50    — 50% deductible meals (Line 24b)
- PAYMENT     — credit card / loan payment (not an expense — clears a liability)
- TRANSFER    — inter-account or owner contribution/draw (not income, not expense)
- PERSONAL    — personal/non-deductible
- NEEDS_CONTEXT — genuinely cannot determine without more info

Schedule C lines: Line 8 Advertising, Line 9 Car & Truck, Line 11 Contract Labor, Line 13 Depreciation, Line 15 Insurance, Line 16b Interest, Line 17 Legal & Professional, Line 18 Office Expense, Line 20b Rent — Other, Line 21 Repairs & Maintenance, Line 22 Supplies, Line 23 Taxes & Licenses, Line 24a Travel, Line 24b Meals, Line 25 Utilities, Line 27a Other Expenses, Line 30 Home Office, Part III COGS, N/A

IRC citations to use: §61 (income), §162 (ordinary business expense), §263A (COGS), §274(d) (meals/entertainment), §262 (personal), §1402 (self-employment)

Rules:
- eBay payout deposits → BIZ_INCOME, §61
- Stripe payouts to SA Wholesale LLC → BIZ_INCOME, §61
- "SENT MONEY TO [person]" via Wise → WRITE_OFF_COGS (supplier payments for goods)
- "PAYMENT THANK YOU" on credit cards → PAYMENT (clears card balance, not an expense)
- "TOPPED UP ACCOUNT" or owner deposits → TRANSFER
- Pocketsflow transfers to named individuals → WRITE_OFF, Line 11 Contract Labor, §162
- Wise platform fees → WRITE_OFF, Line 27a, §162
- Chase bank fees → WRITE_OFF, Line 27a, §162
- Returned payments / bounced items → NEEDS_CONTEXT (complex, requires human)
- "RECEIVED FROM [name]" Zelle inflows from known business contacts → BIZ_INCOME
- Apple Cash transfers → PERSONAL or TRANSFER (owner draw)
- Liberis / merchant cash advance → TRANSFER (loan proceeds, not income)
- If NEEDS_CONTEXT, set confidence ≤ 0.50

Confidence guide:
- 0.95+ : No ambiguity — clear pattern match
- 0.85–0.94 : Strong inference from name + amount + context
- 0.70–0.84 : Reasonable inference but some uncertainty
- <0.70 : Ambiguous — will NOT be auto-applied

Return ONLY a JSON array. No prose, no markdown. Format:
[{"stopId":"...","code":"...","businessPct":100,"scheduleCLine":"...","ircCitations":["§162"],"confidence":0.95,"reasoning":"...","applyToSimilar":true},...]`

export async function classifyStopsWithAI(
  stops: StopForAI[],
  businessContext: string,
  client?: Anthropic,
): Promise<StopResolution[]> {
  if (stops.length === 0) return []
  const anthropic = client ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  const BATCH = 15
  const results: StopResolution[] = []

  for (let i = 0; i < stops.length; i += BATCH) {
    const batch = stops.slice(i, i + BATCH)
    const userMsg = `${businessContext ? `Business notes: ${businessContext}\n\n` : ""}Classify these ${batch.length} STOP items:\n${JSON.stringify(batch, null, 0)}`

    try {
      const res = await anthropic.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 4096,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      })
      const block = res.content[0]
      if (!block || block.type !== "text") continue
      const text = block.text
      const s = text.indexOf("[")
      const e = text.lastIndexOf("]")
      if (s < 0 || e <= s) continue
      const parsed = JSON.parse(text.slice(s, e + 1)) as StopResolution[]
      if (Array.isArray(parsed)) results.push(...parsed)
    } catch {
      // partial batch failure — leave those stops as PENDING
    }
  }

  return results
}
