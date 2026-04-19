/**
 * Vision-Document extractor (Session 9 §A.1).
 *
 * Sends the raw PDF bytes to Claude as a "document" content block. Used for
 * scanned PDFs where pdf-parse returns empty/garbled text.
 *
 * Output schema matches HaikuCleanup so the caller is agnostic.
 */

import Anthropic from "@anthropic-ai/sdk"
import type { Buffer as NodeBuffer } from "node:buffer"
import { z } from "zod"
import type { ExtractorResult } from "./haiku-cleanup"
import type { ParseResult, RawTx } from "./types"

const HAIKU_MODEL = "claude-haiku-4-5"
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

type Extraction = z.infer<typeof ExtractionSchema>

const SYSTEM_PROMPT = `You are a bank/credit-card statement OCR extractor for TaxLens.
You receive an attached PDF statement (possibly scanned / image-only).
Return ONLY valid JSON — no prose, no markdown.

Rules:
1. Extract every transaction line visible on the statement.
2. direction="inflow" = money entering the account; "outflow" = money leaving.
3. amount is a positive number; direction encodes the sign.
4. postedDate is ISO YYYY-MM-DD. Infer year from the statement period when needed.
5. institution: cardholder-facing name, or null.
6. confidence: 0–1; below 0.6 triggers a Sonnet retry.
7. NEVER invent transactions. Skip unreadable lines.

Return JSON with exactly:
{
  "institution": string|null,
  "periodStart": "YYYY-MM-DD"|null,
  "periodEnd": "YYYY-MM-DD"|null,
  "transactions": [{"postedDate":"YYYY-MM-DD","transactionDate":"YYYY-MM-DD"|null,
                    "amount":number,"direction":"inflow"|"outflow",
                    "merchantRaw":string,"description":string|null}],
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

function toRawTxs(raw: Extraction): RawTx[] {
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

function toParseResult(raw: Extraction, txs: RawTx[]): ParseResult {
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

export async function extractViaVisionDoc(
  pdfBuffer: NodeBuffer,
  anthropicClient?: Anthropic,
): Promise<ExtractorResult> {
  const client =
    anthropicClient ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  const base64 = pdfBuffer.toString("base64")
  let apiCalls = 0
  let tokensIn = 0
  let tokensOut = 0
  let modelUsed = HAIKU_MODEL

  const tryOnce = async (model: string): Promise<Extraction | null> => {
    apiCalls++
    try {
      const res = await client.messages.create({
        model,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "document",
                source: {
                  type: "base64",
                  media_type: "application/pdf",
                  data: base64,
                },
              },
              {
                type: "text",
                text: "Extract all transactions from the attached PDF statement.",
              },
            ] as unknown as Anthropic.Messages.ContentBlockParam[],
          },
        ],
      })
      tokensIn += res.usage.input_tokens
      tokensOut += res.usage.output_tokens
      const block = res.content[0]
      if (!block || block.type !== "text") return null
      return ExtractionSchema.parse(JSON.parse(extractJSON(block.text)))
    } catch {
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
      parseResult: failedResult("Vision extraction failed after Sonnet retry"),
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
