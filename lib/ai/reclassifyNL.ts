/**
 * Natural-language reclassification — targeted Sonnet 4.6 call.
 * Input: user instruction + candidate transactions.
 * Output: { matches[], rule_updates[] } — preview only; apply separately.
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"

const MODEL = "claude-sonnet-4-6" as const
const MAX_TOKENS = 4096

const TransactionCodeEnum = z.enum([
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
  "PERSONAL",
  "TRANSFER",
  "PAYMENT",
  "BIZ_INCOME",
  "NEEDS_CONTEXT",
])

export const NLMatchSchema = z.object({
  transactionId: z.string(),
  newCode: TransactionCodeEnum,
  newBusinessPct: z.number().int().min(0).max(100),
  newScheduleCLine: z.string().nullable(),
  ircCitations: z.array(z.string()),
  evidenceTier: z.number().int().min(1).max(5),
  reasoning: z.string(),
})

export const NLRuleUpdateSchema = z.object({
  merchantKey: z.string(),
  code: TransactionCodeEnum,
  businessPctDefault: z.number().int().min(0).max(100),
  scheduleCLine: z.string().nullable(),
  ircCitations: z.array(z.string()),
  reasoning: z.string(),
})

export const NLResponseSchema = z.object({
  matches: z.array(NLMatchSchema),
  rule_updates: z.array(NLRuleUpdateSchema),
})

export type NLResponse = z.infer<typeof NLResponseSchema>

export interface NLCandidate {
  id: string
  date: string
  merchantNormalized: string | null
  merchantRaw: string
  amount: number
  currentCode: string
  currentPct: number
}

export interface NLContext {
  naics: string | null
  businessDescription: string | null
  trips: { name: string; start: string; end: string }[]
  entities: { displayName: string; keywords: string[] }[]
}

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1]!.trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

export async function reclassifyByInstruction(
  instruction: string,
  candidates: NLCandidate[],
  ctx: NLContext,
  client?: Anthropic
): Promise<NLResponse> {
  const anthropic = client ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  const system = `You are the TaxLens Reclassification Agent. The owner typed a plain-English instruction and you must translate it to a precise per-transaction classification override.

=== NON-NEGOTIABLE RULES ===
1. Use ONLY these codes: WRITE_OFF, WRITE_OFF_TRAVEL, WRITE_OFF_COGS, MEALS_50, MEALS_100, GRAY, PERSONAL, TRANSFER, PAYMENT, BIZ_INCOME, NEEDS_CONTEXT.
2. Only return transactions the instruction clearly applies to. Skip ambiguous ones.
3. IRC citations must come from: §162, §162(a), §262, §274(d), §274(n), §274(n)(1), §274(n)(2), §280A(c), §280F, §195, §6001, Cohan. If unsure, output "[VERIFY]".
4. Conservative bias: if in doubt, classify PERSONAL not deductible.
5. Output strict JSON only — no prose, no fences.

=== BUSINESS PROFILE ===
NAICS: ${ctx.naics ?? "unknown"}
Business: ${ctx.businessDescription ?? "Not specified"}
Trips: ${ctx.trips.map((t) => `${t.name} (${t.start}–${t.end})`).join("; ") || "none"}
Known entities: ${ctx.entities.map((e) => `${e.displayName} [${e.keywords.join(",")}]`).join("; ") || "none"}

=== OUTPUT SCHEMA ===
{
  "matches": [
    {
      "transactionId": "<id>",
      "newCode": "<CODE>",
      "newBusinessPct": <0-100>,
      "newScheduleCLine": "Line X …" | null,
      "ircCitations": ["§162"],
      "evidenceTier": 1-5,
      "reasoning": "<brief>"
    }
  ],
  "rule_updates": [
    {
      "merchantKey": "<KEY>",
      "code": "<CODE>",
      "businessPctDefault": <0-100>,
      "scheduleCLine": "Line X …" | null,
      "ircCitations": ["§162"],
      "reasoning": "<brief>"
    }
  ]
}`

  const user = `Instruction: "${instruction}"

Candidate transactions (JSON):
${JSON.stringify(candidates, null, 2)}

Return matches + rule_updates covering only transactions the instruction clearly applies to.`

  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
    temperature: 0,
    system,
    messages: [{ role: "user", content: user }],
  })
  const text = (res.content[0] as Anthropic.Messages.TextBlock).text
  try {
    return NLResponseSchema.parse(JSON.parse(extractJSON(text)))
  } catch (err) {
    // retry once
    const retry = await anthropic.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system,
      messages: [
        { role: "user", content: user },
        { role: "assistant", content: text },
        {
          role: "user",
          content: `Previous response failed JSON validation: ${String(err).slice(0, 300)}. Return ONLY the strict JSON. No prose, no fences.`,
        },
      ],
    })
    const retryText = (retry.content[0] as Anthropic.Messages.TextBlock).text
    return NLResponseSchema.parse(JSON.parse(extractJSON(retryText)))
  }
}
