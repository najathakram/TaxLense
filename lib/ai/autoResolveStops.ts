/**
 * AI-assisted bulk classification of PENDING StopItems.
 *
 * Hardened against the failure modes that produced "auto-resolve only resolves
 * some of them" symptom on Atif's prod ledger:
 *   - Per-batch failures retry once with the same model, then fall back to
 *     claude-haiku-4-5 (instead of silently dropping 15 stops at once).
 *   - The Sonnet response is Zod-validated; rows with unknown codes / out-of-
 *     range pct / unknown stopIds are dropped per-row with a captured reason
 *     instead of throwing the whole batch.
 *   - The system prompt is parameterized off the live business profile —
 *     the previous hardcoded "SA Wholesale LLC / Atif / Pakistan" header was
 *     the actual cause of weird classifications for any other client AND
 *     even biased Atif's own runs (the model would force every Wise outflow
 *     to "supplier in Pakistan" even when the merchant was clearly a fee).
 *   - User message now includes per-category guidance (DEPOSIT = inflow you
 *     received; TRANSFER = wallet movement; MERCHANT = recurring vendor) so
 *     the model isn't guessing direction from the amount sign.
 *   - Returns a richer per-stop result that includes a `reason` when the
 *     row was dropped so the caller can show actionable detail in the UI.
 */
import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
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

/**
 * Drop reasons surfaced when a row from the AI batch could not be applied —
 * "missing", "unknown_stop_id", "bad_code", "validation_failed", or "api_error".
 * The caller stuffs these into the per-stop details so the UI can show
 * "5 skipped (3 unknown_stop_id, 2 bad_code)" instead of an opaque "5 skipped".
 */
export type DropReason =
  | "missing_from_response"
  | "unknown_stop_id"
  | "validation_failed"
  | "low_confidence"
  | "api_error"
  | "parse_error"

export interface BusinessContext {
  /** Free-text description from BusinessProfile.businessDescription */
  description: string
  /** NAICS code (e.g. "454110"). May be empty. */
  naics: string
  /** Display name of the active client/owner (e.g. "Atif Ameer"). */
  ownerName: string
  /** Tax year being processed. */
  year: number
  /** Optional: pinned per-client notes captured during onboarding/uploads. */
  notes?: string
}

const TRANSACTION_CODES = [
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
] as const

const StopResolutionSchema = z.object({
  stopId: z.string().min(1),
  code: z.enum(TRANSACTION_CODES),
  businessPct: z.coerce.number(),
  scheduleCLine: z.string().nullable().optional(),
  ircCitations: z.array(z.string()).default([]),
  confidence: z.coerce.number(),
  reasoning: z.string().default(""),
  applyToSimilar: z.boolean().default(false),
})

const StopResolutionArraySchema = z.array(StopResolutionSchema)

/**
 * Backfill scheduleCLine when the AI omits it on a deductible code.
 * Mirrors the fallback used in lib/classification/apply.ts so a row classified
 * via auto-resolve still rolls up to a real Schedule C line.
 */
function fallbackLineForCode(code: TransactionCode): string | null {
  switch (code) {
    case "WRITE_OFF":
      return "Line 27a Other Expenses"
    case "WRITE_OFF_TRAVEL":
      return "Line 24a Travel"
    case "WRITE_OFF_COGS":
      return "Part III COGS"
    case "MEALS_50":
    case "MEALS_100":
      return "Line 24b Meals"
    case "BIZ_INCOME":
      return "Line 1 Gross Receipts"
    case "PAYMENT":
    case "TRANSFER":
    case "PERSONAL":
    case "NEEDS_CONTEXT":
    case "GRAY":
      return null
    default:
      return null
  }
}

function clampPct(n: unknown): number {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.min(100, Math.max(0, Math.round(x)))
}

function clampConfidence(n: unknown): number {
  const x = Number(n)
  if (!Number.isFinite(x)) return 0
  return Math.min(1, Math.max(0, x))
}

function buildSystemPrompt(ctx: BusinessContext): string {
  const ownerLine = ctx.ownerName ? `Owner: ${ctx.ownerName}.` : ""
  const naicsLine = ctx.naics ? `NAICS: ${ctx.naics}.` : ""
  const descLine = ctx.description ? `Business: ${ctx.description}.` : ""
  const notesBlock = ctx.notes
    ? `\n\n=== CLIENT-PROVIDED CONTEXT ===\n${ctx.notes}`
    : ""

  return `You are a tax classification expert for a US small business preparing a Schedule C / 1120-S / 1065 / 1120 return for tax year ${ctx.year}.

${[descLine, naicsLine, ownerLine].filter(Boolean).join(" ")}${notesBlock}

Classify each STOP item on the schedule below. STOPs come in three meaningful shapes:
  - category="MERCHANT": a recurring vendor / merchant rule that needs a code + line.
  - category="TRANSFER": an outflow (positive amount) that looked like a wallet/transfer movement
    (Wise, Apple Cash, Venmo, owner draw, payment to a credit card, etc).
  - category="DEPOSIT": an INFLOW (negative amount per spec §4.2) that we couldn't classify —
    decide whether it's BIZ_INCOME (client/marketplace payout), TRANSFER (owner contribution
    or loan proceeds), PERSONAL (gift/refund/non-business), or NEEDS_CONTEXT.
  - category="SECTION_274D": meals missing attendees/purpose — these are RESOLVED OUT-OF-BAND
    via the user attaching a receipt; mark as NEEDS_CONTEXT confidence 0.40.
  - category="PERIOD_GAP": missing statement coverage; mark as NEEDS_CONTEXT confidence 0.30.

Available codes:
- BIZ_INCOME       gross business income / receipt (no deduction)
- WRITE_OFF        deductible §162 business expense at businessPct%
- WRITE_OFF_COGS   cost of goods sold (Part III COGS)
- WRITE_OFF_TRAVEL 100% business travel (Line 24a)
- MEALS_50         50% deductible meals (Line 24b)
- MEALS_100        100% deductible meals (e.g. de minimis food for staff, Line 24b)
- PAYMENT          credit card / loan payment (clears a liability — not an expense)
- TRANSFER         inter-account / owner contribution / draw (not income, not expense)
- PERSONAL         personal / non-deductible
- NEEDS_CONTEXT    cannot determine without more info (set confidence ≤ 0.50)

Schedule C lines: "Line 8 Advertising", "Line 9 Car & Truck", "Line 10 Commissions and Fees",
"Line 11 Contract Labor", "Line 13 Depreciation", "Line 14 Employee Benefits", "Line 15 Insurance",
"Line 16b Interest", "Line 17 Legal & Professional", "Line 18 Office Expense",
"Line 20a Rent — Vehicles", "Line 20b Rent — Other", "Line 21 Repairs & Maintenance",
"Line 22 Supplies", "Line 23 Taxes & Licenses", "Line 24a Travel", "Line 24b Meals",
"Line 25 Utilities", "Line 27a Other Expenses", "Line 30 Home Office", "Part III COGS",
"Line 1 Gross Receipts" (for BIZ_INCOME), null (for PAYMENT / TRANSFER / PERSONAL).

IRC citations (return AT LEAST one per deductible row):
  §61 (income), §162 (ordinary business expense), §263A (COGS / inventory),
  §274(d) (meals/entertainment substantiation), §262 (personal),
  §1402 (self-employment).

GENERAL RULES (apply unless client notes contradict):
  - Marketplace payout deposits (Stripe / PayPal / Square / Amazon Payments / Etsy / eBay) →
    BIZ_INCOME, "Line 1 Gross Receipts", §61, confidence 0.90+.
  - Wallet top-ups ("TOPPED UP ACCOUNT", "TRANSFER FROM EXTERNAL", owner deposits) →
    TRANSFER, businessPct 0, confidence 0.90+.
  - Card payments ("PAYMENT THANK YOU", "AUTOPAY") → PAYMENT, businessPct 0.
  - "SENT MONEY TO [person]" via Wise / Pocketsflow + the client describes them as a contractor →
    WRITE_OFF, "Line 11 Contract Labor", §162. If unclear → NEEDS_CONTEXT.
  - "SENT MONEY TO [person]" + the client describes them as a supplier → WRITE_OFF_COGS,
    "Part III COGS", §263A.
  - Bank fees / wire fees / FX fees → WRITE_OFF, "Line 27a Other Expenses", §162, businessPct 100.
  - Apple Cash / Venmo / Cash App outflows w/o business purpose → PERSONAL, businessPct 0.
  - Refund/reversal inflows → BIZ_INCOME if it offsets a prior business expense, otherwise
    PERSONAL.

Confidence guide (your output's confidence field is REQUIRED):
  0.95+      no ambiguity — clear pattern match
  0.85–0.94  strong inference from name + amount + context
  0.70–0.84  reasonable inference but some uncertainty
  <0.70      ambiguous — will NOT be auto-applied (caller will queue for human)

CRITICAL OUTPUT RULES:
  - Echo back the EXACT stopId you were given. Do not invent or shorten it.
  - businessPct is an INTEGER 0..100. Never a float, never out of range.
  - For DEPOSIT category, scheduleCLine must be "Line 1 Gross Receipts" if code=BIZ_INCOME,
    otherwise null.
  - For PAYMENT / TRANSFER / PERSONAL / NEEDS_CONTEXT scheduleCLine MUST be null.
  - Return ONLY a JSON array. No prose. No markdown fences. No leading/trailing text.

Format:
[{"stopId":"...","code":"WRITE_OFF","businessPct":100,"scheduleCLine":"Line 27a Other Expenses","ircCitations":["§162"],"confidence":0.95,"reasoning":"...","applyToSimilar":true}]`
}

/**
 * Optional batch-level progress callback. Fires once per AI batch *before*
 * the Sonnet call so the UI can show what's in flight (the call itself can
 * take 30-60s and the user otherwise sees a static "0 / N" the whole time).
 */
export type BatchProgress = (info: {
  batchIdx: number
  totalBatches: number
  batchStops: StopForAI[]
}) => Promise<void> | void

export interface ClassifyResult {
  resolutions: StopResolution[]
  /** Per-stopId drop reason. Empty if every input made it through. */
  drops: Map<string, DropReason>
}

/**
 * Backwards-compatible signature: accepts the legacy positional businessContext
 * string OR a structured BusinessContext. Internally normalizes to the rich
 * shape so the system prompt can be parameterized.
 */
export async function classifyStopsWithAI(
  stops: StopForAI[],
  businessContext: string | BusinessContext,
  client?: Anthropic,
  onBatchStart?: BatchProgress,
): Promise<StopResolution[]> {
  const result = await classifyStopsWithAIDetailed(stops, businessContext, client, onBatchStart)
  return result.resolutions
}

/**
 * Detailed variant — returns both the validated resolutions AND a map of
 * drop reasons per stopId. Use this when the caller needs to surface
 * per-row failure detail in the UI.
 */
export async function classifyStopsWithAIDetailed(
  stops: StopForAI[],
  businessContext: string | BusinessContext,
  client?: Anthropic,
  onBatchStart?: BatchProgress,
): Promise<ClassifyResult> {
  if (stops.length === 0) return { resolutions: [], drops: new Map() }

  const ctx: BusinessContext =
    typeof businessContext === "string"
      ? {
          description: businessContext,
          naics: "",
          ownerName: "",
          year: new Date().getFullYear(),
          notes: undefined,
        }
      : businessContext

  const anthropic = client ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  const BATCH = 15
  const totalBatches = Math.ceil(stops.length / BATCH)
  const resolutions: StopResolution[] = []
  const drops = new Map<string, DropReason>()
  const systemPrompt = buildSystemPrompt(ctx)

  for (let i = 0; i < stops.length; i += BATCH) {
    const batch = stops.slice(i, i + BATCH)
    const batchIdx = Math.floor(i / BATCH) + 1
    const batchIds = batch.map((b) => b.stopId)

    if (onBatchStart) {
      try {
        await onBatchStart({ batchIdx, totalBatches, batchStops: batch })
      } catch {
        // never fail the AI run because progress reporting failed
      }
    }

    const userMsg = buildUserMessage(ctx, batch)
    const batchResolutions = await runBatchWithRetry({
      anthropic,
      systemPrompt,
      userMsg,
      batchIds,
      drops,
    })
    resolutions.push(...batchResolutions)
  }

  // Anything we expected but didn't see in the response is "missing" rather
  // than silently dropped — the caller can surface this clearly.
  const seenIds = new Set(resolutions.map((r) => r.stopId))
  for (const s of stops) {
    if (!seenIds.has(s.stopId) && !drops.has(s.stopId)) {
      drops.set(s.stopId, "missing_from_response")
    }
  }

  return { resolutions, drops }
}

function buildUserMessage(ctx: BusinessContext, batch: StopForAI[]): string {
  const ownerLine = ctx.ownerName ? `Client: ${ctx.ownerName}` : ""
  const yearLine = `Tax year: ${ctx.year}`
  const descLine = ctx.description ? `Business: ${ctx.description}` : ""
  const naicsLine = ctx.naics ? `NAICS: ${ctx.naics}` : ""
  const notesLine = ctx.notes ? `Client notes:\n${ctx.notes}` : ""

  const header = [ownerLine, yearLine, descLine, naicsLine, notesLine]
    .filter(Boolean)
    .join("\n")

  return `${header}\n\nClassify these ${batch.length} STOP items. Echo each stopId back exactly.\n${JSON.stringify(batch, null, 0)}`
}

interface RunBatchArgs {
  anthropic: Anthropic
  systemPrompt: string
  userMsg: string
  batchIds: string[]
  drops: Map<string, DropReason>
}

/**
 * One Sonnet call with a Haiku fallback. Each model gets one retry-on-parse-
 * failure (instead of the prior behavior of dropping the whole batch).
 */
async function runBatchWithRetry({
  anthropic,
  systemPrompt,
  userMsg,
  batchIds,
  drops,
}: RunBatchArgs): Promise<StopResolution[]> {
  const models: Array<"claude-sonnet-4-6" | "claude-haiku-4-5"> = [
    "claude-sonnet-4-6",
    "claude-haiku-4-5",
  ]

  for (let m = 0; m < models.length; m++) {
    const model = models[m]!
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const fixHint =
          attempt === 0
            ? userMsg
            : `${userMsg}\n\nIMPORTANT: your previous response was NOT valid JSON or had wrong shape. Return EXACTLY a JSON array of {stopId, code, businessPct, scheduleCLine, ircCitations, confidence, reasoning, applyToSimilar}. No prose. No markdown fences. Echo each stopId verbatim.`
        const res = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: "user", content: fixHint }],
        })
        const block = res.content[0]
        if (!block || block.type !== "text") {
          continue // try next attempt
        }
        const text = block.text
        const s = text.indexOf("[")
        const e = text.lastIndexOf("]")
        if (s < 0 || e <= s) continue

        let parsed: unknown
        try {
          parsed = JSON.parse(text.slice(s, e + 1))
        } catch {
          continue
        }
        const validated = StopResolutionArraySchema.safeParse(parsed)
        if (!validated.success) {
          // Try per-row partial validation — even one good row is better than 15 dropped.
          if (Array.isArray(parsed)) {
            const partial: StopResolution[] = []
            for (const row of parsed as unknown[]) {
              const rowResult = StopResolutionSchema.safeParse(row)
              if (!rowResult.success) {
                if (
                  row &&
                  typeof row === "object" &&
                  "stopId" in row &&
                  typeof (row as { stopId: unknown }).stopId === "string"
                ) {
                  drops.set((row as { stopId: string }).stopId, "validation_failed")
                }
                continue
              }
              const norm = normalizeRow(rowResult.data, batchIds, drops)
              if (norm) partial.push(norm)
            }
            if (partial.length > 0) {
              return partial
            }
          }
          continue
        }
        return validated.data
          .map((r) => normalizeRow(r, batchIds, drops))
          .filter((r): r is StopResolution => r !== null)
      } catch (err) {
        // Surface so the caller can show a real reason in details.
        // 429 / 5xx → fall through to retry / next model.
        const isLast = m === models.length - 1 && attempt === 1
        if (isLast) {
          for (const id of batchIds) {
            if (!drops.has(id)) drops.set(id, "api_error")
          }
          console.error("[autoResolveStops] batch failed:", err)
        }
      }
    }
  }
  // All retries exhausted with no parseable response.
  for (const id of batchIds) {
    if (!drops.has(id)) drops.set(id, "parse_error")
  }
  return []
}

/**
 * Normalize a parsed row: clamp pct, clamp confidence, backfill scheduleCLine,
 * verify the stopId was in the batch (otherwise it's a hallucinated id).
 * Returns null when the row should be dropped.
 */
function normalizeRow(
  raw: z.infer<typeof StopResolutionSchema>,
  batchIds: string[],
  drops: Map<string, DropReason>,
): StopResolution | null {
  if (!batchIds.includes(raw.stopId)) {
    drops.set(raw.stopId, "unknown_stop_id")
    return null
  }
  const code = raw.code
  let line = raw.scheduleCLine ?? null
  // For non-deductible / non-income codes, scheduleCLine MUST be null.
  if (code === "PAYMENT" || code === "TRANSFER" || code === "PERSONAL" || code === "NEEDS_CONTEXT" || code === "GRAY") {
    line = null
  } else if (!line) {
    line = fallbackLineForCode(code)
  }
  return {
    stopId: raw.stopId,
    code,
    businessPct: clampPct(raw.businessPct),
    scheduleCLine: line,
    ircCitations: raw.ircCitations.length > 0 ? raw.ircCitations : defaultCitationsFor(code),
    confidence: clampConfidence(raw.confidence),
    reasoning: raw.reasoning,
    applyToSimilar: raw.applyToSimilar,
  }
}

function defaultCitationsFor(code: TransactionCode): string[] {
  switch (code) {
    case "WRITE_OFF":
    case "WRITE_OFF_TRAVEL":
      return ["§162"]
    case "WRITE_OFF_COGS":
      return ["§263A"]
    case "MEALS_50":
    case "MEALS_100":
      return ["§162", "§274(d)"]
    case "BIZ_INCOME":
      return ["§61"]
    case "PERSONAL":
      return ["§262"]
    default:
      return []
  }
}
