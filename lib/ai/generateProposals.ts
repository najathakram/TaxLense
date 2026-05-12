/**
 * Review-first AI proposal engine.
 *
 * For every PENDING stop, this:
 *   1. Pulls the actor's prior similar resolved cases (cross-client, all
 *      years) via findSimilarResolvedStops.
 *   2. Sends Sonnet a per-stop request that includes those prior cases as
 *      "experience" context — the model is explicitly told to anchor on
 *      the actor's prior judgments.
 *   3. Validates the response with Zod (reusing the same schema family as
 *      autoResolveStops), backfills scheduleCLine for deductible codes,
 *      clamps pct/confidence.
 *   4. Writes the rich proposal to StopItem.aiProposal (does NOT touch
 *      Classification rows). The /review page renders from this column.
 *   5. Returns a summary: how many proposals were generated, how many had
 *      prior-case context, etc.
 *
 * Auto-apply at high confidence is a SEPARATE concern from generation —
 * see autoApplyHighConfidenceProposals below. Splitting the two means the
 * "generate" run can be re-run safely (idempotent overwrite of proposal
 * column) without re-applying ledger writes.
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { prisma } from "@/lib/db"
import type { Prisma, MerchantRule, StopItem, TransactionCode, ClassificationSource } from "@/app/generated/prisma/client"
import {
  findSimilarResolvedStops,
  accessibleUserIds,
  type PriorCase,
} from "@/lib/stops/findSimilarResolved"
import { aggregateClientNotes } from "@/lib/ai/merchantIntelligence"
import { deriveAiSuggestion, aiSuggestionFromResolution } from "@/lib/stops/aiSuggestion"
import { deriveFromAnswer, type StopAnswer } from "@/lib/stops/derive"
import type { ProgressReporter } from "@/lib/jobs/pipelineRun"

// ────────────────────────────────────────────────────────────────────────
// Zod schema — same shape as autoResolveStops's StopResolution. Kept
// independent so a future refactor of one doesn't silently break the other.
// ────────────────────────────────────────────────────────────────────────

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

const ProposalSchema = z.object({
  stopId: z.string().min(1),
  code: z.enum(TRANSACTION_CODES),
  businessPct: z.coerce.number(),
  scheduleCLine: z.string().nullable().optional(),
  ircCitations: z.array(z.string()).default([]),
  confidence: z.coerce.number(),
  reasoning: z.string().default(""),
  /** Free-text reference to the prior case the AI anchored on, when applicable. */
  citedPriorCaseId: z.string().nullable().optional(),
})
const ProposalArraySchema = z.array(ProposalSchema)

// ────────────────────────────────────────────────────────────────────────
// Types exported to callers (server action + /review UI).
// ────────────────────────────────────────────────────────────────────────

export interface ProposalRecord {
  /** The StopAnswer that gets fed to deriveFromAnswer when approved. */
  answer: StopAnswer
  /** Derived from `answer` for display. */
  code: TransactionCode
  businessPct: number
  scheduleCLine: string | null
  confidence: number
  reasoning: string
  ircCitations: string[]
  /** Cross-referenced prior cases — UI shows these as evidence chips. */
  priorCases: PriorCase[]
  generatedAt: string
  generatedRunId: string
  /** True when the proposal was auto-applied (≥0.85). The /review page
   *  shows these in a separate "auto-approved" section with override. */
  autoApplied: boolean
  /** When auto-applied, the citedPriorCaseId helps the audit trail. */
  citedPriorCaseId: string | null
}

export interface GenerateProposalsResult {
  generated: number
  withPriorCaseContext: number
  autoApplied: number
  pendingReview: number
  errors: number
  /** Drop reasons keyed by stopId — surfaces the same partial-failure detail
   *  the autoResolveStops detail panel does. */
  dropReasons: Record<string, string>
}

const HIGH_CONFIDENCE_AUTO_APPLY_THRESHOLD = 0.85
const BATCH = 10
const PRIOR_CASE_LIMIT_PER_STOP = 5

// ────────────────────────────────────────────────────────────────────────
// Prompt construction
// ────────────────────────────────────────────────────────────────────────

function buildSystemPrompt(opts: {
  ownerName: string
  description: string
  naics: string
  year: number
  notes?: string
}): string {
  const ownerLine = opts.ownerName ? `Owner: ${opts.ownerName}.` : ""
  const naicsLine = opts.naics ? `NAICS: ${opts.naics}.` : ""
  const descLine = opts.description ? `Business: ${opts.description}.` : ""
  const notesBlock = opts.notes
    ? `\n\n=== CLIENT-PROVIDED CONTEXT ===\n${opts.notes}`
    : ""

  return `You are a tax classification expert proposing recommended Schedule C / 1120-S / 1065 / 1120 classifications for a US small business preparing tax year ${opts.year}.

${[descLine, naicsLine, ownerLine].filter(Boolean).join(" ")}${notesBlock}

You are NOT applying classifications directly. You are proposing them for the CPA to review. Be decisive — propose the BEST single answer per stop with calibrated confidence, and CITE prior similar cases when the actor has resolved comparable transactions before.

PRIOR-CASE ANCHORING (most important rule):
  - Every stop comes with up to 5 "prior cases" — past stops the same actor
    resolved (across all their clients and tax years).
  - When a prior case has high similarity AND a clear resolution code,
    propose the SAME code with confidence 0.85-0.95. Set citedPriorCaseId
    to that prior case's stopId.
  - When several prior cases agree, push confidence to 0.95+.
  - Only propose NEEDS_CONTEXT when neither prior cases nor the merchant
    string give any signal.

Available codes (same as before):
  BIZ_INCOME, WRITE_OFF, WRITE_OFF_COGS, WRITE_OFF_TRAVEL,
  MEALS_50, MEALS_100, PAYMENT, TRANSFER, PERSONAL, NEEDS_CONTEXT

Schedule C lines: "Line 1 Gross Receipts" (BIZ_INCOME),
"Line 8 Advertising", "Line 9 Car & Truck", "Line 11 Contract Labor",
"Line 13 Depreciation", "Line 14 Employee Benefits", "Line 15 Insurance",
"Line 16b Interest", "Line 17 Legal & Professional", "Line 18 Office Expense",
"Line 20a Rent — Vehicles", "Line 20b Rent — Other",
"Line 21 Repairs & Maintenance", "Line 22 Supplies",
"Line 23 Taxes & Licenses", "Line 24a Travel", "Line 24b Meals",
"Line 25 Utilities", "Line 27a Other Expenses", "Line 30 Home Office",
"Part III COGS", null (for PAYMENT/TRANSFER/PERSONAL/NEEDS_CONTEXT).

IRC citations: §61, §162, §263A, §274(d), §262, §1402.

GENERAL RULES (apply unless prior cases or notes contradict):
  - Marketplace payouts → BIZ_INCOME, "Line 1 Gross Receipts", §61, 0.90+.
  - Wallet top-ups → TRANSFER, businessPct 0, 0.90+.
  - "PAYMENT THANK YOU" / autopay → PAYMENT, businessPct 0.
  - "RETURN" / "REFUND" / "REVERSAL" deposits → WRITE_OFF (offsets prior
    expense), 0.85+ unless prior cases say otherwise.
  - Wise / Pocketsflow contractor payments → WRITE_OFF Line 11, §162.
  - Pure bank fees → WRITE_OFF Line 27a, §162.

Confidence calibration:
  0.95+    multiple matching prior cases agree, OR clear mechanical pattern
  0.85-0.94 single matching prior case OR clear mechanical pattern
  0.70-0.84 reasonable inference w/o prior anchor
  <0.70    ambiguous

CRITICAL OUTPUT RULES:
  - Echo back the EXACT stopId from the input. Do not invent or shorten it.
  - businessPct: integer 0..100.
  - For DEPOSIT category, scheduleCLine="Line 1 Gross Receipts" if BIZ_INCOME, else null.
  - For PAYMENT/TRANSFER/PERSONAL/NEEDS_CONTEXT: scheduleCLine MUST be null.
  - Return ONLY a JSON array. No prose. No markdown fences.

Format per row:
{"stopId":"...","code":"WRITE_OFF","businessPct":100,"scheduleCLine":"Line 27a Other Expenses","ircCitations":["§162"],"confidence":0.92,"reasoning":"...","citedPriorCaseId":"abc123"}`
}

interface StopBundle {
  stopId: string
  merchantKey: string
  category: string
  totalAmount: number
  txnCount: number
  samples: Array<{ date: string; account: string; raw: string; amount: number }>
  priorCases: PriorCase[]
}

function buildUserMessage(batch: StopBundle[]): string {
  // Send the AI a JSON-shaped per-stop block with samples + prior cases.
  // Keeping this as JSON (not prose) gives the model unambiguous fields.
  return `Propose a recommended classification for each of these ${batch.length} stops. Each stop comes with up to 5 prior similar cases the actor resolved before — ANCHOR on these.\n\n${JSON.stringify(batch, null, 0)}`
}

// ────────────────────────────────────────────────────────────────────────
// Helpers reused from autoResolveStops (kept inline to avoid coupling).
// ────────────────────────────────────────────────────────────────────────

function fallbackLineForCode(code: TransactionCode): string | null {
  switch (code) {
    case "WRITE_OFF": return "Line 27a Other Expenses"
    case "WRITE_OFF_TRAVEL": return "Line 24a Travel"
    case "WRITE_OFF_COGS": return "Part III COGS"
    case "MEALS_50":
    case "MEALS_100": return "Line 24b Meals"
    case "BIZ_INCOME": return "Line 1 Gross Receipts"
    default: return null
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

function defaultCitationsFor(code: TransactionCode): string[] {
  switch (code) {
    case "WRITE_OFF":
    case "WRITE_OFF_TRAVEL": return ["§162"]
    case "WRITE_OFF_COGS": return ["§263A"]
    case "MEALS_50":
    case "MEALS_100": return ["§162", "§274(d)"]
    case "BIZ_INCOME": return ["§61"]
    case "PERSONAL": return ["§262"]
    default: return []
  }
}

// ────────────────────────────────────────────────────────────────────────
// AI → StopAnswer derivation. The proposal stores the StopAnswer because
// approval just calls deriveFromAnswer(answer) — same code path as a
// human resolving the stop manually.
// ────────────────────────────────────────────────────────────────────────

function codeToStopAnswer(
  category: string,
  code: TransactionCode,
  businessPct: number,
  scheduleCLine: string | null,
  reasoning: string,
): StopAnswer | null {
  // Truncate long reasoning to keep the "Other" textarea legible.
  const otherText = (reasoning ?? "").trim().slice(0, 500) || "AI: no clear category"

  switch (category) {
    case "MERCHANT": {
      if (code === "WRITE_OFF" || code === "WRITE_OFF_COGS") {
        if (businessPct >= 90) return { kind: "merchant", choice: "ALL_BUSINESS", scheduleCLine: scheduleCLine ?? undefined }
        if (businessPct > 0) return { kind: "merchant", choice: "MIXED_50", scheduleCLine: scheduleCLine ?? undefined }
        return { kind: "merchant", choice: "PERSONAL" }
      }
      if (code === "WRITE_OFF_TRAVEL") return { kind: "merchant", choice: "DURING_TRIPS" }
      if (code === "MEALS_50" || code === "MEALS_100") {
        return businessPct >= 90
          ? { kind: "merchant", choice: "ALL_BUSINESS" }
          : { kind: "merchant", choice: "MIXED_50" }
      }
      if (code === "PERSONAL") return { kind: "merchant", choice: "PERSONAL" }
      // NEEDS_CONTEXT or any unmapped code → OTHER with reasoning so the
      // form pre-selects the "Other — explain" radio AND prefills the
      // textarea with the AI's actual rationale. Without this fallback
      // the proposal was silently dropped on every NEEDS_CONTEXT row.
      return { kind: "merchant", choice: "OTHER", other: otherText }
    }
    case "TRANSFER": {
      if (code === "PERSONAL") return { kind: "transfer", choice: "PERSONAL" }
      if (code === "WRITE_OFF") return { kind: "transfer", choice: "CONTRACTOR" }
      if (code === "TRANSFER") return { kind: "transfer", choice: "LOAN" }
      return { kind: "transfer", choice: "OTHER", other: otherText }
    }
    case "DEPOSIT": {
      if (code === "BIZ_INCOME") return { kind: "deposit", choice: "CLIENT" }
      if (code === "TRANSFER") return { kind: "deposit", choice: "OWNER_CONTRIB" }
      if (code === "PERSONAL") return { kind: "deposit", choice: "GIFT" }
      if (code === "WRITE_OFF") return { kind: "deposit", choice: "REFUND" }
      return { kind: "deposit", choice: "OTHER", other: otherText }
    }
    default:
      return null
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main entry point
// ────────────────────────────────────────────────────────────────────────

export async function generateAiProposals(
  taxYearId: string,
  opts: {
    runId: string
    actorUserId: string
    anthropic?: Anthropic
    reportProgress?: ProgressReporter
  },
): Promise<GenerateProposalsResult> {
  const taxYear = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: { businessProfile: true },
  })

  const stops = await prisma.stopItem.findMany({
    where: { taxYearId, state: "PENDING" },
    include: { merchantRule: true },
  })
  if (stops.length === 0) {
    return { generated: 0, withPriorCaseContext: 0, autoApplied: 0, pendingReview: 0, errors: 0, dropReasons: {} }
  }

  // Cross-client × all-years scope. Exclude the candidate stops themselves
  // so a self-match is never used.
  const scope = await accessibleUserIds(opts.actorUserId)
  const excludeIds = stops.map((s) => s.id)

  // Build per-stop bundles with prior cases.
  const bundles: StopBundle[] = []
  let withPriorCaseContext = 0

  // Pull the underlying transactions once (all stops' txn ids).
  const allTxIds = stops.flatMap((s) => s.transactionIds)
  const txns = allTxIds.length
    ? await prisma.transaction.findMany({
        where: { id: { in: allTxIds } },
        include: { account: true },
      })
    : []
  const txById = new Map(txns.map((t) => [t.id, t]))

  for (const stop of stops) {
    const affected = stop.transactionIds.flatMap((id) => {
      const t = txById.get(id)
      if (!t) return []
      return [{
        date: t.postedDate.toISOString().slice(0, 10),
        account: t.account.nickname ?? "",
        raw: t.merchantRaw,
        amount: Number(t.amountNormalized.toString()),
      }]
    })
    const totalAmount = affected.reduce((sum, t) => sum + Math.abs(t.amount), 0)
    const priorCases = await findSimilarResolvedStops(opts.actorUserId, stop, {
      limit: PRIOR_CASE_LIMIT_PER_STOP,
      userIdScope: scope,
      excludeStopIds: excludeIds,
    })
    if (priorCases.length > 0) withPriorCaseContext++

    bundles.push({
      stopId: stop.id,
      merchantKey: stop.merchantRule?.merchantKey ?? affected[0]?.raw ?? "UNKNOWN",
      category: stop.category,
      totalAmount,
      txnCount: affected.length,
      samples: affected.slice(0, 5),
      priorCases,
    })
  }

  // Resolve actor name for the prompt.
  const owner = await prisma.user
    .findUnique({ where: { id: taxYear.userId }, select: { name: true, email: true } })
    .catch(() => null)
  const ownerName = owner?.name ?? owner?.email ?? ""

  const clientNotes = await aggregateClientNotes(taxYearId).catch(() => "")

  const systemPrompt = buildSystemPrompt({
    ownerName,
    description: taxYear.businessProfile?.businessDescription ?? "",
    naics: taxYear.businessProfile?.naicsCode ?? "",
    year: taxYear.year,
    notes: clientNotes && clientNotes.trim().length > 0 ? clientNotes : undefined,
  })

  const anthropic = opts.anthropic ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  // Run AI in batches. Smaller batches than autoResolveStops because each
  // bundle now carries up to 5 prior cases — token budget is tighter.
  const totalBatches = Math.ceil(bundles.length / BATCH)
  const proposals = new Map<string, z.infer<typeof ProposalSchema>>()
  const dropReasons: Record<string, string> = {}

  for (let i = 0; i < bundles.length; i += BATCH) {
    const batch = bundles.slice(i, i + BATCH)
    const batchIdx = Math.floor(i / BATCH) + 1
    if (opts.reportProgress) {
      const samples = batch.slice(0, 4).map((b) => b.merchantKey.slice(0, 14)).join(", ")
      await opts.reportProgress({
        phase: "generate_proposals",
        processed: i,
        total: bundles.length,
        label: `Batch ${batchIdx} of ${totalBatches} · ${batch.length} stops · ${samples}`,
      })
    }
    const got = await runBatch(anthropic, systemPrompt, buildUserMessage(batch), batch.map((b) => b.stopId), dropReasons)
    for (const p of got) proposals.set(p.stopId, p)
  }

  // Mark anything not seen as missing.
  for (const b of bundles) {
    if (!proposals.has(b.stopId) && !dropReasons[b.stopId]) {
      dropReasons[b.stopId] = "missing_from_response"
    }
  }

  // Build ProposalRecord per stop, persist, optionally auto-apply.
  let autoApplied = 0
  let pendingReview = 0
  let errors = 0

  for (const bundle of bundles) {
    const stop = stops.find((s) => s.id === bundle.stopId)!
    const raw = proposals.get(bundle.stopId)
    if (!raw) {
      // No proposal — fall back to the heuristic.
      const heuristic = deriveAiSuggestion(stop)
      if (!heuristic) {
        // Truly nothing to propose. Skip — leave the stop PENDING with no proposal.
        continue
      }
      // Materialize a heuristic-only proposal so the review screen still has a row.
      const code = (() => {
        switch (heuristic.kind) {
          case "deposit":
            return heuristic.choice === "CLIENT" || heuristic.choice === "PLATFORM_1099" ? "BIZ_INCOME"
              : heuristic.choice === "REFUND" ? "WRITE_OFF"
              : "TRANSFER"
          case "transfer":
            return heuristic.choice === "CONTRACTOR" ? "WRITE_OFF"
              : heuristic.choice === "PERSONAL" ? "PERSONAL"
              : "TRANSFER"
          case "merchant":
            return heuristic.choice === "PERSONAL" ? "PERSONAL"
              : heuristic.choice === "DURING_TRIPS" ? "WRITE_OFF_TRAVEL"
              : "WRITE_OFF"
        }
      })() as TransactionCode

      const answer = codeToStopAnswer(
        stop.category,
        code,
        code === "BIZ_INCOME" ? 0 : code.startsWith("WRITE_OFF") ? 100 : 0,
        fallbackLineForCode(code),
        heuristic.reasoning ?? "",
      )
      if (!answer) continue
      const derived = deriveFromAnswer(answer, {
        ruleCode: stop.merchantRule?.code,
        ruleLine: stop.merchantRule?.scheduleCLine,
      })
      const record: ProposalRecord = {
        answer,
        code: derived.code,
        businessPct: derived.businessPct,
        scheduleCLine: derived.scheduleCLine,
        confidence: heuristic.confidence,
        reasoning: heuristic.reasoning ?? "Heuristic match (AI did not respond)",
        ircCitations: derived.ircCitations,
        priorCases: bundle.priorCases,
        generatedAt: new Date().toISOString(),
        generatedRunId: opts.runId,
        autoApplied: false,
        citedPriorCaseId: null,
      }
      try {
        await persistProposal(stop.id, record)
        if (record.confidence >= HIGH_CONFIDENCE_AUTO_APPLY_THRESHOLD) {
          await autoApply(stop, record, opts.actorUserId)
          autoApplied++
        } else {
          pendingReview++
        }
      } catch (err) {
        errors++
        console.error("[generateAiProposals] heuristic-only persist failed for", stop.id, err)
      }
      continue
    }

    // Validate + normalize.
    const code = raw.code as TransactionCode
    let line = raw.scheduleCLine ?? null
    if (code === "PAYMENT" || code === "TRANSFER" || code === "PERSONAL" || code === "NEEDS_CONTEXT" || code === "GRAY") {
      line = null
    } else if (!line) {
      line = fallbackLineForCode(code)
    }
    const businessPct = clampPct(raw.businessPct)
    const confidence = clampConfidence(raw.confidence)
    const ircCitations = raw.ircCitations.length > 0 ? raw.ircCitations : defaultCitationsFor(code)

    const answer = codeToStopAnswer(stop.category, code, businessPct, line, raw.reasoning)
    if (!answer) {
      // codeToStopAnswer now returns OTHER as a last resort for known
      // categories, so reaching null here means we got an unknown
      // category (SECTION_274D / PERIOD_GAP — neither has an AI-driven
      // form path). Skip without erroring; these stops are resolved
      // out-of-band (uploading a receipt or a missing statement).
      dropReasons[bundle.stopId] = "category_not_proposable"
      continue
    }

    const derived = deriveFromAnswer(answer, {
      ruleCode: stop.merchantRule?.code,
      ruleLine: stop.merchantRule?.scheduleCLine,
    })

    const record: ProposalRecord = {
      answer,
      code: derived.code,
      businessPct: derived.businessPct,
      scheduleCLine: derived.scheduleCLine,
      confidence,
      reasoning: raw.reasoning,
      ircCitations,
      priorCases: bundle.priorCases,
      generatedAt: new Date().toISOString(),
      generatedRunId: opts.runId,
      autoApplied: false,
      citedPriorCaseId: raw.citedPriorCaseId ?? null,
    }

    try {
      await persistProposal(stop.id, record)
      // Defensive auto-apply gate. Never auto-apply when the AI hedged:
      //   - code === "NEEDS_CONTEXT": writing this as the current
      //     classification triggers deriveStopsFromAssertions to
      //     immediately re-create a new PENDING DEPOSIT stop on the
      //     same transaction → infinite loop where every Generate
      //     run looks like it auto-applied N stops but the count
      //     never drops.
      //   - answer.choice === "OTHER": the model chose OTHER because
      //     it couldn't decide. Auto-applying that decision is worse
      //     than leaving the stop PENDING — the CPA gets no signal
      //     that the AI was uncertain.
      const isHedged =
        record.code === "NEEDS_CONTEXT" ||
        ("choice" in record.answer && record.answer.choice === "OTHER")
      if (!isHedged && record.confidence >= HIGH_CONFIDENCE_AUTO_APPLY_THRESHOLD) {
        await autoApply(stop, record, opts.actorUserId)
        autoApplied++
      } else {
        pendingReview++
      }
    } catch (err) {
      errors++
      console.error("[generateAiProposals] persist failed for", stop.id, err)
    }
  }

  return {
    generated: pendingReview + autoApplied,
    withPriorCaseContext,
    autoApplied,
    pendingReview,
    errors,
    dropReasons,
  }
}

// ────────────────────────────────────────────────────────────────────────
// Per-batch AI call with one retry + Haiku fallback (mirrors autoResolveStops).
// ────────────────────────────────────────────────────────────────────────

async function runBatch(
  anthropic: Anthropic,
  systemPrompt: string,
  userMsg: string,
  batchIds: string[],
  dropReasons: Record<string, string>,
): Promise<z.infer<typeof ProposalSchema>[]> {
  const models: Array<"claude-sonnet-4-6" | "claude-haiku-4-5"> = ["claude-sonnet-4-6", "claude-haiku-4-5"]
  for (let m = 0; m < models.length; m++) {
    const model = models[m]!
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const userInput = attempt === 0
          ? userMsg
          : `${userMsg}\n\nIMPORTANT: previous response was not valid JSON. Return ONLY a JSON array. Echo each stopId verbatim.`
        const res = await anthropic.messages.create({
          model,
          max_tokens: 4096,
          temperature: 0,
          system: systemPrompt,
          messages: [{ role: "user", content: userInput }],
        })
        const block = res.content[0]
        if (!block || block.type !== "text") continue
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
        const validated = ProposalArraySchema.safeParse(parsed)
        if (!validated.success) {
          if (Array.isArray(parsed)) {
            const partial: z.infer<typeof ProposalSchema>[] = []
            for (const row of parsed as unknown[]) {
              const r = ProposalSchema.safeParse(row)
              if (!r.success) {
                if (row && typeof row === "object" && "stopId" in row && typeof (row as { stopId: unknown }).stopId === "string") {
                  dropReasons[(row as { stopId: string }).stopId] = "validation_failed"
                }
                continue
              }
              if (batchIds.includes(r.data.stopId)) {
                partial.push(r.data)
              } else {
                dropReasons[r.data.stopId] = "unknown_stop_id"
              }
            }
            if (partial.length > 0) return partial
          }
          continue
        }
        return validated.data.filter((r) => {
          if (!batchIds.includes(r.stopId)) {
            dropReasons[r.stopId] = "unknown_stop_id"
            return false
          }
          return true
        })
      } catch (err) {
        const isLast = m === models.length - 1 && attempt === 1
        if (isLast) {
          for (const id of batchIds) if (!dropReasons[id]) dropReasons[id] = "api_error"
          console.error("[generateAiProposals] batch failed:", err)
        }
      }
    }
  }
  for (const id of batchIds) if (!dropReasons[id]) dropReasons[id] = "parse_error"
  return []
}

// ────────────────────────────────────────────────────────────────────────
// Persistence helpers
// ────────────────────────────────────────────────────────────────────────

async function persistProposal(stopId: string, record: ProposalRecord): Promise<void> {
  // Also write a `aiSuggestion` so the existing per-card pre-fill keeps
  // working without depending on the new aiProposal column. Belt+braces.
  const suggestion = aiSuggestionFromResolution(
    // category derivable from answer.kind
    record.answer.kind === "merchant" ? "MERCHANT"
      : record.answer.kind === "transfer" ? "TRANSFER"
      : record.answer.kind === "deposit" ? "DEPOSIT"
      : "MERCHANT",
    record.code,
    record.businessPct,
    record.scheduleCLine,
    record.confidence,
    record.reasoning,
  )
  await prisma.stopItem.update({
    where: { id: stopId },
    data: {
      aiProposal: record as unknown as Prisma.InputJsonValue,
      ...(suggestion ? { aiSuggestion: suggestion as unknown as Prisma.InputJsonValue } : {}),
    },
  })
}

async function autoApply(
  stop: StopItem & { merchantRule: MerchantRule | null },
  record: ProposalRecord,
  userId: string,
): Promise<void> {
  await prisma.$transaction(
    async (tx) => {
      for (const txId of stop.transactionIds) {
        await tx.classification.updateMany({
          where: { transactionId: txId, isCurrent: true },
          data: { isCurrent: false },
        })
        await tx.classification.create({
          data: {
            transactionId: txId,
            code: record.code,
            scheduleCLine: record.scheduleCLine,
            businessPct: record.businessPct,
            ircCitations: record.ircCitations,
            confidence: record.confidence,
            evidenceTier: 3,
            source: "AI" as ClassificationSource,
            reasoning: `Auto-approved (≥${HIGH_CONFIDENCE_AUTO_APPLY_THRESHOLD} confidence): ${record.reasoning}`,
            isCurrent: true,
            createdByUserId: userId,
          },
        })
      }
      await tx.stopItem.update({
        where: { id: stop.id },
        data: {
          state: "ANSWERED",
          answeredAt: new Date(),
          userAnswer: {
            autoApproved: true,
            via: "review_first_high_confidence",
            code: record.code,
            confidence: record.confidence,
            citedPriorCaseId: record.citedPriorCaseId,
          } as unknown as Prisma.InputJsonValue,
          // Mark the proposal as auto-applied (the /review screen reads this
          // to render the "auto-approved" section with override).
          aiProposal: { ...record, autoApplied: true } as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.auditEvent.create({
        data: {
          userId,
          actorType: "AI",
          eventType: "STOP_RESOLVED",
          entityType: "StopItem",
          entityId: stop.id,
          afterState: {
            code: record.code,
            businessPct: record.businessPct,
            confidence: record.confidence,
            autoApproved: true,
            via: "review_first_high_confidence",
            citedPriorCaseId: record.citedPriorCaseId,
          },
          rationale: record.reasoning,
        },
      })
    },
    { timeout: 60_000 },
  )
}
