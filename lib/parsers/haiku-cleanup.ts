/**
 * Haiku Cleanup extractor (Session 9 §A.1).
 *
 * Input: raw text from pdf-parse (noisy but present).
 * Output: structured { institution, periodStart, periodEnd, transactions[] }.
 *
 * Model: claude-haiku-4-5 (primary). Confidence < 0.60 → single retry on
 * claude-sonnet-4-6. On final failure, returns ok=false with parseError —
 * the caller surfaces this as PARTIAL/FAILED StatementImport.
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import type { ParseResult, RawTx } from "./types"

const HAIKU_MODEL = "claude-haiku-4-5-20251001"
const SONNET_MODEL = "claude-sonnet-4-6"
const MAX_TOKENS = 4096
const RETRY_CONFIDENCE_THRESHOLD = 0.6

const TxSchema = z.object({
  postedDate: z.string(),
  transactionDate: z.string().nullable().optional(),
  amount: z.number(),
  direction: z.enum(["inflow", "outflow"]),
  merchantRaw: z.string().min(1),
  description: z.string().nullable().optional(),
})

const ExtractionSchema = z.object({
  institution: z.string().nullable(),
  periodStart: z.string().nullable(),
  periodEnd: z.string().nullable(),
  transactions: z.array(TxSchema),
  confidence: z.number().min(0).max(1),
})

export type HaikuExtractionRaw = z.infer<typeof ExtractionSchema>

export interface ExtractorTelemetry {
  model: string
  tokensIn: number
  tokensOut: number
  confidence: number
  apiCalls: number
}

export interface ExtractorResult {
  parseResult: ParseResult
  telemetry: ExtractorTelemetry
}

const SYSTEM_PROMPT = `You are a bank/credit-card statement text extractor for TaxLens.
You receive the text extracted from a single PDF statement (possibly noisy).
Return ONLY valid JSON matching the schema below — no prose, no markdown.

Rules:
1. Extract EVERY transaction line you can identify. If uncertain about a line, skip it.
2. direction="inflow" when money entered the account (payments, credits, deposits).
   direction="outflow" when money left (charges, purchases, fees).
3. amount must be a positive number (absolute value). direction encodes the sign.
4. postedDate must be ISO YYYY-MM-DD. If the year isn't printed on the line,
   infer it from the statement period. If you cannot, skip the line.
5. institution: return the cardholder-facing name ("Chase Freedom", "Amex Platinum",
   "Costco Citi", "Chase Checking", "Robinhood", or null if unclear).
6. confidence: 0–1 score reflecting how well you understood the document.
   Below 0.6 signals we should retry with a stronger model.
7. NEVER invent transactions. When unsure, prefer the empty array.

Schema:
{
  "institution": string | null,
  "periodStart": "YYYY-MM-DD" | null,
  "periodEnd": "YYYY-MM-DD" | null,
  "transactions": [
    {
      "postedDate": "YYYY-MM-DD",
      "transactionDate": "YYYY-MM-DD" | null,
      "amount": number,              // positive absolute value
      "direction": "inflow" | "outflow",
      "merchantRaw": string,
      "description": string | null
    }
  ],
  "confidence": number
}`

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1]!.trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

function parseISODate(s: string | null | undefined): Date | undefined {
  if (!s) return undefined
  const d = new Date(s)
  return Number.isFinite(d.getTime()) ? d : undefined
}

function toRawTxs(raw: HaikuExtractionRaw): RawTx[] {
  const out: RawTx[] = []
  for (const t of raw.transactions) {
    const posted = parseISODate(t.postedDate)
    if (!posted) continue
    const abs = Math.abs(t.amount)
    const normalized = t.direction === "outflow" ? abs : -abs
    out.push({
      postedDate: posted,
      transactionDate: parseISODate(t.transactionDate ?? null),
      amountOriginal: t.direction === "outflow" ? abs : -abs,
      amountNormalized: normalized,
      merchantRaw: t.merchantRaw.trim(),
      descriptionRaw: t.description ?? undefined,
    })
  }
  return out
}

function toParseResult(raw: HaikuExtractionRaw, txs: RawTx[]): ParseResult {
  let totalInflows = 0
  let totalOutflows = 0
  for (const t of txs) {
    if (t.amountNormalized < 0) totalInflows += Math.abs(t.amountNormalized)
    else totalOutflows += t.amountNormalized
  }
  return {
    ok: true,
    institution: raw.institution ?? undefined,
    periodStart: parseISODate(raw.periodStart),
    periodEnd: parseISODate(raw.periodEnd),
    transactions: txs,
    totalInflows,
    totalOutflows,
    reconciliation: { ok: true },
    parseConfidence: raw.confidence,
  }
}

function failedResult(error: string): ParseResult {
  return {
    ok: false,
    error,
    transactions: [],
    totalInflows: 0,
    totalOutflows: 0,
    reconciliation: { ok: false },
    parseConfidence: 0,
  }
}

/**
 * Run Haiku extraction. Falls back to Sonnet if confidence is low.
 */
export async function extractViaHaikuCleanup(
  pdfText: string,
  anthropicClient?: Anthropic,
): Promise<ExtractorResult> {
  const client =
    anthropicClient ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  let apiCalls = 0
  let tokensIn = 0
  let tokensOut = 0
  let modelUsed = HAIKU_MODEL
  let lastError: unknown = null

  const tryOnce = async (model: string): Promise<HaikuExtractionRaw | null> => {
    apiCalls++
    try {
      const res = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: pdfText }],
      })
      tokensIn += res.usage.input_tokens
      tokensOut += res.usage.output_tokens
      const block = res.content[0]
      if (!block || block.type !== "text") return null
      return ExtractionSchema.parse(JSON.parse(extractJSON(block.text)))
    } catch (err) {
      lastError = err
      console.error(`[haiku-cleanup] tryOnce(${model}) failed:`, err)
      return null
    }
  }

  let parsed = await tryOnce(HAIKU_MODEL)
  if (!parsed || parsed.confidence < RETRY_CONFIDENCE_THRESHOLD) {
    const retry = await tryOnce(SONNET_MODEL)
    if (retry) {
      parsed = retry
      modelUsed = SONNET_MODEL
    }
  }

  if (!parsed) {
    return {
      parseResult: failedResult(`Haiku extraction failed: ${lastError instanceof Error ? lastError.message : String(lastError ?? "both Haiku and Sonnet returned null")}`),
      telemetry: {
        model: modelUsed,
        tokensIn,
        tokensOut,
        confidence: 0,
        apiCalls,
      },
    }
  }

  const txs = toRawTxs(parsed)
  return {
    parseResult: toParseResult(parsed, txs),
    telemetry: {
      model: modelUsed,
      tokensIn,
      tokensOut,
      confidence: parsed.confidence,
      apiCalls,
    },
  }
}
