/**
 * Autonomous CPA Agent — Phase 1 of the architectural rewrite.
 *
 * Replaces the multi-stage deterministic-pipeline + STOP-driven flow with a
 * single Sonnet-led pass over the unified ledger. Outputs one audit memo
 * (JSON + human-readable PDF) instead of a stack of user-blocking STOPs.
 *
 * Decisions locked in (per the approved plan and CLAUDE.md updates):
 *   - "AI-decides default": uncertain §274(d) rows default to PERSONAL with
 *     a "not-claimed" line in the audit memo so the user can promote them
 *     later by uploading a receipt or note.
 *   - Deductible triples preserved: every deductible classification still
 *     carries IRC citation, evidence tier, and confidence.
 *   - Append-only ledger preserved: Classifications are inserted with
 *     isCurrent=true; prior rows flipped to isCurrent=false.
 *   - No fabrication: AI never invents §274(d) attendees, business-purpose
 *     details, or 1099-K amounts. Missing substantiation → conservative
 *     default + memo entry.
 *
 * Flow:
 *   Phase B — Deterministic plumbing (normalize, transfers, payments, refunds).
 *             Fast, no AI. Reused as-is.
 *   Phase C — Whole-ledger CPA pass. ~150 rows per Sonnet call, with the full
 *             profile + entity context + neighbor windows as context. Each
 *             call returns per-row classification triples + per-row reasoning.
 *   Phase D — Sanity sweep. One final Sonnet call sees the chunked outputs
 *             as a unified ledger draft and emits the audit memo.
 *
 * Extraction quality re-pass (Phase A) and advanced UI disclosure are
 * scheduled for a follow-up PR.
 */

import Anthropic from "@anthropic-ai/sdk"
import { writeFile } from "node:fs/promises"
import { join } from "node:path"
import { prisma } from "@/lib/db"
import type {
  TransactionCode,
  Prisma,
} from "@/app/generated/prisma/client"
import { matchTransfers } from "@/lib/pairing/transfers"
import { matchCardPayments } from "@/lib/pairing/payments"
import { matchRefunds } from "@/lib/pairing/refunds"
import { normalizeMerchantsForYear } from "@/lib/classification/apply"
import { aggregateClientNotes } from "@/lib/ai/merchantIntelligence"
import { inYearWindow } from "@/lib/queries/yearWindow"
import { getFormSpec } from "@/lib/forms/registry"
import { uploadDir } from "@/lib/uploads/storage"
import type { ProgressReporter } from "@/lib/jobs/pipelineRun"

const MODEL_PRIMARY = "claude-sonnet-4-6" as const
const MODEL_OPUS = "claude-opus-4-7" as const

// Chunk size — number of ledger rows per Sonnet call. Halved from 60 to 30
// because at 60 the response (one detailed JSON object per row, ~250 tokens
// each including reasoning + citations) hit the 8192 max_tokens ceiling and
// got truncated mid-array. Truncation made JSON parse fail and the whole
// chunk silently returned []; on Atif's prod ledger this caused the 8-chunk
// agent run to commit zero classifications even though the floating progress
// advanced through every chunk and the audit memo got written. 30 keeps
// response size comfortably under the new 32K ceiling and improves per-chunk
// visibility for the user.
const CHUNK_SIZE = 30
// Output token ceiling — was 8192, raised to 32768. Sonnet supports up to 64K
// output; this is well within the limit while leaving headroom for very
// detailed reasoning on tricky rows.
const CHUNK_MAX_TOKENS = 32768

// Allowed classification codes (mirror lib/ai/merchantIntelligence.ts).
const VALID_CODES: TransactionCode[] = [
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
]
const VALID_CODE_SET = new Set<string>(VALID_CODES)

const VALID_CITATIONS = new Set([
  "§61", "§162", "§162(a)", "§263A", "§274(d)", "§274(n)", "§274(n)(1)", "§274(n)(2)",
  "§262", "§1402", "§280A", "§280A(c)", "§168(k)", "§179", "§280F", "§195", "§6001",
  "§163(h)", "§471", "§471(c)",
  "Cohan",
])

function sanitizeCitations(arr: unknown[]): string[] {
  return arr
    .filter((c): c is string => typeof c === "string")
    .map((c) => (VALID_CITATIONS.has(c) ? c : "[VERIFY]"))
}

/**
 * Build a human-readable preview label for a chunk that's about to be sent
 * to Sonnet. Shows the date range and up to 4 unique merchant names so the
 * user can see what's actually in flight during the 30-60s API wait — instead
 * of a static "Chunk 3 of 8 · 0 decisions" that looks frozen.
 *
 * Example output: "Chunk 3 of 8 · 60 txns May 02–May 24 · WISE, EMS, STRIPE, AUTHNET +56"
 */
function chunkPreviewLabel(
  chunkIdx: number,
  totalChunks: number,
  chunk: Array<{ postedDate: Date; merchantNormalized: string | null; merchantRaw: string }>,
): string {
  if (chunk.length === 0) return `Chunk ${chunkIdx} of ${totalChunks}`
  const dates = chunk.map((t) => t.postedDate.getTime())
  const minD = new Date(Math.min(...dates))
  const maxD = new Date(Math.max(...dates))
  const fmt = (d: Date) =>
    d.toLocaleDateString("en-US", { month: "short", day: "2-digit", timeZone: "UTC" })
  const dateRange = minD.getTime() === maxD.getTime() ? fmt(minD) : `${fmt(minD)}–${fmt(maxD)}`

  const seen = new Set<string>()
  const samples: string[] = []
  for (const t of chunk) {
    const m = (t.merchantNormalized || t.merchantRaw || "").trim()
    if (!m) continue
    const short = m.length > 14 ? `${m.slice(0, 13)}…` : m
    if (seen.has(short)) continue
    seen.add(short)
    samples.push(short)
    if (samples.length >= 4) break
  }
  const more = chunk.length - samples.length
  const merchantBlurb =
    samples.length === 0
      ? ""
      : ` · ${samples.join(", ")}${more > 0 ? ` +${more}` : ""}`

  return `Chunk ${chunkIdx} of ${totalChunks} · ${chunk.length} txns ${dateRange}${merchantBlurb}`
}

// --- Per-row output schema -------------------------------------------------

interface RowDecision {
  txId: string
  code: TransactionCode
  scheduleLine: string | null
  businessPct: number
  ircCitations: string[]
  evidenceTier: number
  confidence: number
  reasoning: string
  /** When AI defaulted to PERSONAL because substantiation is missing. */
  notClaimedReason?: string
  /** Gray-area calls that the audit memo should highlight. */
  riskNote?: string
  /** When true, AI used Cohan as a strategic call rather than a rescue. */
  cohanFlag?: boolean
}

// --- Audit memo schema -----------------------------------------------------

export interface AuditMemo {
  taxYearId: string
  generatedAt: string
  model: string
  totalsClaimedByLine: Record<string, number>
  totalsNotClaimed: Record<string, number>
  grayAreaCalls: Array<{ txId: string; choseCode: string; alternativeCode: string; reason: string }>
  followUps: Array<{ kind: string; promptForUser: string; txIds?: string[] }>
  coverageGaps: string[]
  riskFlags: string[]
  summary: string
}

// --- Public API ------------------------------------------------------------

export interface CpaAgentOptions {
  anthropicClient?: Anthropic
  reportProgress?: ProgressReporter
  /** When true, bypass the cached deterministic-plumbing step (assume already run). */
  skipPlumbing?: boolean
}

export interface CpaAgentResult {
  rowsConsidered: number
  rowsClassified: number
  rowsLeftAsPersonal: number
  memoDocumentId: string | null
  /** How many chunks failed to return decisions (Sonnet truncation, parse
   *  fail, etc). Surfaced so the floating-progress completion summary and
   *  the run audit event can flag a partial run. */
  failedChunks: number
  /** How many legacy PENDING StopItems the inline archival hook flipped to
   *  ANSWERED. On Atif's prod ledger this stayed 0 even after a clean
   *  agent run — surfacing the count makes the silent failure visible. */
  archivedStops: number
  memo: AuditMemo
}

export async function runCpaAgent(taxYearId: string, opts: CpaAgentOptions = {}): Promise<CpaAgentResult> {
  const reporter = opts.reportProgress
  const client = opts.anthropicClient ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  const taxYear = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: { ruleVersion: true },
  })

  // ── Phase B — Deterministic plumbing (idempotent, ~seconds) ─────────────
  if (!opts.skipPlumbing) {
    if (reporter) await reporter({ phase: "cpa_agent", processed: 0, total: 4, label: "Normalizing merchants…" })
    await normalizeMerchantsForYear(taxYearId)
    if (reporter) await reporter({ phase: "cpa_agent", processed: 1, total: 4, label: "Pairing transfers…" })
    await matchTransfers(taxYearId)
    if (reporter) await reporter({ phase: "cpa_agent", processed: 2, total: 4, label: "Pairing card payments…" })
    await matchCardPayments(taxYearId)
    if (reporter) await reporter({ phase: "cpa_agent", processed: 3, total: 4, label: "Pairing refunds…" })
    await matchRefunds(taxYearId)
  }

  // ── Phase C — Whole-ledger CPA pass ─────────────────────────────────────

  // Pull every in-year, non-paired, non-split transaction for classification.
  // (Paired transfers/payments are excluded from Schedule C totals; we leave
  // them as-is and let the AI know about them via the system context only.)
  const allTxns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isStale: false,
      isDuplicateOf: null,
      ...inYearWindow(taxYear.year),
    },
    include: {
      account: true,
      classifications: { where: { isCurrent: true }, take: 1 },
    },
    orderBy: [{ postedDate: "asc" }, { id: "asc" }],
  })

  const profile = await prisma.businessProfile.findUniqueOrThrow({
    where: { taxYearId },
    include: { trips: true, knownEntities: true },
  })

  const clientNotes = await aggregateClientNotes(taxYearId)
  const systemPrompt = buildAgentSystemPrompt(profile, clientNotes, profile.entityType)

  // Skip already-paired rows (transfers/payments already classified by
  // the deterministic pairing logic). Process every other row.
  const candidates = allTxns.filter(
    (t) => !t.isTransferPairedWith && !t.isPaymentPairedWith,
  )

  const chunks: typeof candidates[] = []
  for (let i = 0; i < candidates.length; i += CHUNK_SIZE) {
    chunks.push(candidates.slice(i, i + CHUNK_SIZE))
  }

  if (reporter) {
    await reporter({
      phase: "cpa_agent",
      processed: 0,
      total: chunks.length,
      label: `Reviewing ${candidates.length} transaction${candidates.length === 1 ? "" : "s"} in ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}…`,
    })
  }

  const allDecisions: RowDecision[] = []
  let failedChunks = 0
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i]!
    // Emit a "starting chunk" event BEFORE the Sonnet call so the user sees
    // what's actually in flight during the long wait (one Sonnet call on 60
    // rows can take 30-60s). Without this, the panel reads "Chunk 3 of 8 · 0
    // decisions" the whole time and looks frozen.
    if (reporter) {
      await reporter({
        phase: "cpa_agent",
        processed: i,
        total: chunks.length,
        label: chunkPreviewLabel(i + 1, chunks.length, chunk),
      })
    }
    const decisions = await classifyChunkAsCpa(chunk, systemPrompt, client)
    if (decisions.length === 0 && chunk.length > 0) failedChunks++
    allDecisions.push(...decisions)
    if (reporter) {
      const failureSuffix = failedChunks > 0 ? ` · ${failedChunks} chunk${failedChunks === 1 ? "" : "s"} failed` : ""
      await reporter({
        phase: "cpa_agent",
        processed: i + 1,
        total: chunks.length,
        label: `Chunk ${i + 1} of ${chunks.length} · ${allDecisions.length} decisions so far${failureSuffix}`,
      })
    }
  }

  // Persist classifications (flip-and-insert pattern, append-only ledger).
  // Each decision flashes through the floating progress feed in real time —
  // the user sees "TIM HORTONS · MEALS_50 100% · $4.50" land one after the
  // next as the AI commits its judgments. Up to 5 most-recent decisions are
  // kept in the progress payload so the UI can render them as a fading stack.
  const txnLookupById = new Map(allTxns.map((t) => [t.id, t]))
  const recent: Array<{ merchant: string; code: string; businessPct: number; amount: number }> = []
  let leftAsPersonal = 0
  let writeIdx = 0
  for (const d of allDecisions) {
    await prisma.$transaction(async (tx) => {
      await tx.classification.updateMany({
        where: { transactionId: d.txId, isCurrent: true },
        data: { isCurrent: false },
      })
      await tx.classification.create({
        data: {
          transactionId: d.txId,
          code: d.code,
          scheduleCLine: d.scheduleLine,
          businessPct: d.businessPct,
          ircCitations: d.ircCitations,
          confidence: d.confidence,
          evidenceTier: d.evidenceTier,
          source: "AI",
          reasoning: d.reasoning,
          isCurrent: true,
        },
      })
    }, { timeout: 30_000 })

    if (d.code === "PERSONAL" && d.notClaimedReason) leftAsPersonal++

    writeIdx++

    if (reporter) {
      const tx = txnLookupById.get(d.txId)
      const merchantBase = tx?.merchantNormalized || tx?.merchantRaw || "(unknown)"
      const merchant = merchantBase.length > 28 ? `${merchantBase.slice(0, 27)}…` : merchantBase
      const amount = tx ? Math.abs(Number(tx.amountNormalized.toString())) : 0
      const flash = { merchant, code: d.code, businessPct: d.businessPct, amount }
      recent.push(flash)
      if (recent.length > 5) recent.shift()

      await reporter({
        phase: "cpa_agent",
        processed: chunks.length,
        total: chunks.length,
        label: `${merchant} → ${d.code}${d.businessPct === 100 ? "" : ` ${d.businessPct}%`}${amount > 0 ? ` · $${amount.toFixed(2)}` : ""}`,
        recentDecisions: [...recent],
      })
    }
  }

  // ── Archive legacy PENDING STOPs that this run has now classified ──────
  //
  // Critical unblocker: pre-Phase-1 ledgers carry STOPs from the old multi-
  // stage pipeline. The CPA agent re-classifies the underlying transactions
  // cleanly, but the StopItem rows persist as PENDING — and each PENDING
  // STOP is itself a lock blocker (Critical signal). Without this step the
  // year stays unfileable forever even after the user runs the canonical
  // CTA.
  //
  // We mark every PENDING STOP whose transactions the agent just classified
  // as ANSWERED with a `cpaAgentArchived: true` userAnswer so the audit
  // history records that the new agent superseded the old STOP.
  const classifiedTxIds = new Set(allDecisions.map((d) => d.txId))
  const pendingStopsForArchive = await prisma.stopItem.findMany({
    where: { taxYearId, state: "PENDING" },
    select: { id: true, transactionIds: true },
  })
  let archivedStops = 0
  for (const stop of pendingStopsForArchive) {
    // Archive only if at least one of the STOP's underlying transactions
    // was classified by this agent run. Empty STOPs (transactionIds = [])
    // are also archived since they're holdovers from edge cases.
    const hasClassifiedTx =
      stop.transactionIds.length === 0 ||
      stop.transactionIds.some((id) => classifiedTxIds.has(id))
    if (!hasClassifiedTx) continue
    await prisma.stopItem.update({
      where: { id: stop.id },
      data: {
        state: "ANSWERED",
        answeredAt: new Date(),
        userAnswer: {
          cpaAgentArchived: true,
          archivedAt: new Date().toISOString(),
          reason: "Superseded by autonomous CPA agent classification",
        } as Prisma.InputJsonValue,
      },
    })
    archivedStops++
  }
  if (archivedStops > 0 && reporter) {
    await reporter({
      phase: "cpa_agent",
      processed: chunks.length,
      total: chunks.length,
      label: `Archived ${archivedStops} legacy STOP${archivedStops === 1 ? "" : "s"} superseded by this run`,
    })
  }

  // ── Phase D — Sanity sweep + audit memo ─────────────────────────────────

  if (reporter) {
    await reporter({
      phase: "cpa_agent",
      processed: chunks.length,
      total: chunks.length,
      label: "Generating audit memo (Sonnet)…",
    })
  }

  const memo = await buildAuditMemo({
    taxYearId,
    decisions: allDecisions,
    txnsById: new Map(allTxns.map((t) => [t.id, t])),
    profile,
    clientNotes,
    client,
  })

  // Persist the memo as a Document so it surfaces under /clients/<id>/documents.
  // The memo JSON is written to disk under the year's upload dir so the
  // existing /api/documents/[id]/file route can stream it back — previously
  // the filePath was the literal string "(virtual: ...)" which made the
  // route return 410 "File missing on disk" when the user clicked the doc.
  // If creation fails (schema drift, unique-constraint collision, file IO,
  // etc.) we record the failure as an AuditEvent so the user has a surface
  // to diagnose — silently swallowing the error left users staring at
  // "Other · 0" with no signal that the run had even completed.
  let memoDocumentId: string | null = null
  let memoCreateError: string | null = null
  try {
    const memoJson = JSON.stringify(memo, null, 2)
    const dir = await uploadDir(taxYearId)
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const memoFilename = `cpa-agent-memo-${stamp}.json`
    const memoPath = join(dir, memoFilename)
    await writeFile(memoPath, memoJson, "utf8")
    const memoDoc = await prisma.document.create({
      data: {
        userId: taxYear.userId,
        taxYearId,
        category: "OTHER",
        title: `CPA Agent audit memo · ${new Date().toISOString().slice(0, 10)}`,
        description: memo.summary.slice(0, 500),
        filePath: memoPath,
        originalFilename: memoFilename,
        mimeType: "application/json",
        sizeBytes: Buffer.byteLength(memoJson, "utf8"),
        tags: ["audit-memo", "cpa-agent"],
      },
    })
    memoDocumentId = memoDoc.id
  } catch (err) {
    memoCreateError = err instanceof Error ? err.message : String(err)
    console.error("[cpaAgent] failed to persist audit memo as Document:", err)
    // Surface the failure as its own audit event so the run history shows
    // *why* no memo appeared. Otherwise the user has no way to tell the
    // difference between "memo failed" and "agent never ran."
    await prisma.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "AI",
        eventType: "CPA_AGENT_MEMO_FAILED",
        entityType: "TaxYear",
        entityId: taxYearId,
        afterState: {
          error: memoCreateError,
          decisionsCount: allDecisions.length,
        } as Prisma.InputJsonValue,
        rationale: `Audit memo Document.create threw: ${memoCreateError.slice(0, 300)}`,
      },
    })
  }

  // Audit event for the run.
  await prisma.auditEvent.create({
    data: {
      userId: taxYear.userId,
      actorType: "AI",
      eventType: "CPA_AGENT_RUN_COMPLETE",
      entityType: "TaxYear",
      entityId: taxYearId,
      afterState: {
        rowsConsidered: candidates.length,
        rowsClassified: allDecisions.length,
        leftAsPersonal,
        memoDocumentId,
        memoCreateError,
        archivedStops,
        chunks: chunks.length,
      } as Prisma.InputJsonValue,
      rationale: memo.summary.slice(0, 500),
    },
  })

  return {
    rowsConsidered: candidates.length,
    rowsClassified: allDecisions.length,
    rowsLeftAsPersonal: leftAsPersonal,
    memoDocumentId,
    failedChunks,
    archivedStops,
    memo,
  }
}

// --- System prompt ---------------------------------------------------------

function buildAgentSystemPrompt(
  profile: {
    naicsCode: string | null
    businessDescription: string | null
    primaryState: string
    entityType: string
    accountingMethod: string
    grossReceiptsEstimate: Prisma.Decimal | null
    homeOfficeConfig: unknown
    vehicleConfig: unknown
    inventoryConfig: unknown
    revenueStreams: string[]
    firstYear: boolean
    trips: Array<{ name: string; destination: string; startDate: Date; endDate: Date; purpose: string; deliverableDescription: string | null; isConfirmed: boolean }>
    knownEntities: Array<{ displayName: string; kind: string; matchKeywords: string[]; notes: string | null }>
  },
  clientNotes: string,
  entityType: string,
): string {
  const form = getFormSpec(entityType)
  const lineMap = form.lines.map((l) => `"${l}"`).join(", ")
  const entitySpecific = entityType === "S_CORP"
    ? `\n=== S-CORP SPECIFIC RULES ===\n- Owner W-2 wages must be reasonable per §1402; if owner W-2 = $0, set riskNote on the largest WRITE_OFF row to flag the IRS audit trigger.\n- No SE tax — distributions to shareholders are NOT subject to §1402 self-employment tax.\n- Health insurance for >2% shareholders: classify as WRITE_OFF (line "18 Employee benefit programs") with §1402(a)(13) and the riskNote "Shareholder-employee health insurance — must be added to W-2 Box 1 per Notice 2008-1."\n- Officer compensation goes on its own line; non-officer salaries on line 8.\n- Distributions to shareholders are NOT deductible — code = TRANSFER (basis), not WRITE_OFF.`
    : entityType === "LLC_MULTI" || entityType === "PARTNERSHIP"
    ? `\n=== PARTNERSHIP SPECIFIC RULES ===\n- Guaranteed payments to partners are deductible by the partnership (line 10) but ordinary income to the partner; flag with riskNote.\n- Each partner gets a K-1; ordinary income flows to Box 1 and is subject to SE tax for general partners.`
    : entityType === "C_CORP"
    ? `\n=== C-CORP SPECIFIC RULES ===\n- Officer compensation (line 12) must be reasonable; excess flagged as a riskNote.\n- Dividends paid to shareholders are NOT deductible (line 19 charitable contributions are; dividends go on 1099-DIV later).\n- 21% flat federal rate after deductions and §199A NOL.`
    : "" // SOLE_PROP / LLC_SINGLE — Schedule C (default behavior).
  const tripsBlock = profile.trips.length === 0
    ? "None confirmed."
    : profile.trips
        .map((t) => `- "${t.name}" → ${t.destination} | ${t.startDate.toISOString().slice(0, 10)} to ${t.endDate.toISOString().slice(0, 10)} | Purpose: ${t.purpose}${t.deliverableDescription ? ` | Deliverable: ${t.deliverableDescription}` : ""}${t.isConfirmed ? " [confirmed]" : " [unconfirmed]"}`)
        .join("\n")

  const entitiesBlock = profile.knownEntities.length === 0
    ? "None defined."
    : profile.knownEntities
        .map((e) => `- ${e.displayName} [${e.kind}]: keywords ${e.matchKeywords.join(", ")}${e.notes ? ` — ${e.notes}` : ""}`)
        .join("\n")

  const inv = profile.inventoryConfig as { has?: boolean; dropship?: boolean } | null
  const inventoryBlock = (inv?.has || inv?.dropship)
    ? `\nINVENTORY POSTURE: ${inv.dropship ? "Dropshipping" : "Physical inventory"}. Supplier wires (Wise, Alibaba, AliExpress, DHGate, 3PL fees, customs duties) → WRITE_OFF_COGS with line "Part III COGS" at 100% biz pct.`
    : ""

  const notesBlock = clientNotes && clientNotes.trim().length > 0
    ? `\n\n=== CLIENT-PROVIDED CONTEXT (from upload sessions; treat as corroboration, not law) ===\n${clientNotes.trim()}`
    : ""

  return `You are the autonomous CPA agent for TaxLens — an audit-defense bookkeeping tool for US self-employed taxpayers.

You operate as a senior CPA / bookkeeper for THIS specific taxpayer. You will receive a chunk of their ledger transactions and must classify each one. Your goals, in order:

  1. Maximize legitimate deductions within US tax law. Be strategic, not timid.
  2. Never cross into fraud. Never invent attendees, business purposes, dates, or facts you don't have.
  3. When substantiation is missing for a §274(d) category (meals, travel, vehicle, gifts, listed property), default the row to PERSONAL with a "notClaimedReason" so the taxpayer can promote it later by uploading a receipt or note. DO NOT generate a STOP — that's the old flow.
  4. For §162 expenses where evidence tier 3 is supportable, claim the deduction and cite §162. Cohan is allowed strategically — set cohanFlag=true so the audit memo highlights it.
  5. Every deductible classification carries the triple: (IRC citation, evidence tier 1-5, confidence 0-1). Strip any of the three and the deduction is not claimable.
${notesBlock}

=== NON-NEGOTIABLE RULES ===
- Use ONLY these 11 codes:
    WRITE_OFF, WRITE_OFF_TRAVEL, WRITE_OFF_COGS, MEALS_50, MEALS_100,
    GRAY, PERSONAL, TRANSFER, PAYMENT, BIZ_INCOME, NEEDS_CONTEXT
- IRC citations must come from this allowlist. Anything else → "[VERIFY]":
    §61, §162, §162(a), §263A, §274(d), §274(n)(1), §274(n)(2),
    §262, §1402, §280A, §280A(c), §168(k), §179, §280F, §195, §6001,
    §163(h), §471(c), Cohan
- Personal interest (CASH ADVANCE INTEREST CHARGE, INTEREST CHARGE on
  personal cards) → PERSONAL with §163(h). Late fees on a mixed-use card →
  GRAY with §163(h) until card-purpose confirmed.
- NEVER classify a merchant as MEALS_50 or MEALS_100 with businessPct=0.
  A 0%-business meal is PERSONAL with §262.
- INFLOWS (negative amount in our convention — money INTO the account)
  can NEVER carry a deductible code. WRITE_OFF / WRITE_OFF_COGS /
  WRITE_OFF_TRAVEL / MEALS_50 / MEALS_100 / GRAY all describe outflows.
  An inflow on a Wise / payment-processor row is most often a TRANSFER
  (owner top-up from Chase) or a refund/reversal, not a deduction.
  When you see an inflow without clear context, prefer TRANSFER (if
  mid-account-to-account pattern), BIZ_INCOME (if from a customer/
  marketplace), PERSONAL, or NEEDS_CONTEXT. Never WRITE_OFF on a
  positive-into-account row.
- Card payments + transfers between the taxpayer's own accounts are
  already paired (excluded from this chunk). Don't classify them.

=== TAXPAYER PROFILE ===
NAICS: ${profile.naicsCode ?? "unknown"}
Business: ${profile.businessDescription ?? "Not specified"}
State: ${profile.primaryState}
Entity: ${profile.entityType}
Accounting method: ${profile.accountingMethod}
Gross receipts estimate: $${profile.grossReceiptsEstimate?.toString() ?? "unknown"}
Vehicle: ${(() => {
  const v = profile.vehicleConfig as { has?: boolean; bizPct?: number } | null
  return v?.has ? `Yes — ${v.bizPct ?? 60}% business use` : "No vehicle"
})()}
Home office: ${(() => {
  const h = profile.homeOfficeConfig as { has?: boolean; dedicated?: boolean; officeSqft?: number; homeSqft?: number } | null
  return h?.has ? `Yes — ${h.dedicated ? "dedicated" : "non-dedicated"} ${h.officeSqft ?? "?"}sqft of ${h.homeSqft ?? "?"}sqft` : "No"
})()}
First year: ${profile.firstYear ? "Yes (§195 startup costs may apply)" : "No"}
Revenue streams: ${profile.revenueStreams.join(", ") || "Not specified"}${inventoryBlock}

=== CONFIRMED BUSINESS TRIPS ===
${tripsBlock}

=== KNOWN ENTITIES ===
${entitiesBlock}

=== TARGET FORM ===
This taxpayer files: ${form.primaryReturn}
${form.k1 ? `Owners receive: Schedule K-1 per ${entityType === "S_CORP" ? "shareholder" : "partner"}.` : "No K-1 — owner reports on their own 1040."}
SE tax applies: ${form.seTax ? "Yes (owner pays SE tax on net business income)" : "No (no SE tax on this entity's distributions)"}.
Owner payroll required: ${form.requiresOwnerPayroll ? "Yes (W-2 reasonable comp)" : "No"}.

=== ALLOWED scheduleLine VALUES (use the exact string verbatim, or null) ===
${lineMap}, null${entitySpecific}

=== EVIDENCE TIERS ===
1 = Receipt + calendar + trip context + deliverable link (rare)
2 = Statement + ≥1 corroborator (trip-window match, known-entity match, profile affirmation)
3 = Statement + plausible biz nexus from NAICS + profile (DEFAULT for clear §162 cases)
4 = Weak (statement only, no corroboration; §162 Cohan-eligible; §274(d) disallowed)
5 = Indefensible — must be PERSONAL

=== OUTPUT FORMAT ===
Return ONLY a JSON array of decisions, one per input transaction in the SAME order. No prose, no markdown fences:
[
  {
    "txId": "<echo input id>",
    "code": "ONE_OF_11_CODES",
    "scheduleLine": "Line 18 Office Expense" | null,
    "businessPct": 0-100,
    "ircCitations": ["§162", "§274(d)"],
    "evidenceTier": 1-5,
    "confidence": 0.0-1.0,
    "reasoning": "Specific reasoning citing this txn's date, amount, neighbors, trip context, or profile.",
    "notClaimedReason": "Optional — when code=PERSONAL because §274(d) substantiation is missing.",
    "riskNote": "Optional — gray-area calls the audit memo should highlight.",
    "cohanFlag": true | false (optional; default false)
  },
  ...
]
`
}

// --- Per-chunk classification ---------------------------------------------

interface AgentTxnInput {
  id: string
  postedDate: Date
  amountNormalized: Prisma.Decimal
  merchantRaw: string
  merchantNormalized: string | null
  descriptionRaw: string | null
  account: { type: string; nickname: string | null; institution: string }
  classifications: Array<{ code: TransactionCode; businessPct: number }>
}

async function classifyChunkAsCpa(
  txns: AgentTxnInput[],
  systemPrompt: string,
  client: Anthropic,
): Promise<RowDecision[]> {
  const inputs = txns.map((t) => ({
    txId: t.id,
    date: t.postedDate.toISOString().slice(0, 10),
    amount: Number(t.amountNormalized.toString()),
    merchantRaw: t.merchantRaw,
    merchantNormalized: t.merchantNormalized,
    description: t.descriptionRaw,
    accountType: t.account.type,
    accountNickname: t.account.nickname ?? t.account.institution,
    currentCode: t.classifications[0]?.code ?? null,
  }))

  const userMsg = [
    "Classify these ledger transactions. Same order, return ONE decision per input.\n",
    JSON.stringify(inputs, null, 0),
  ].join("")

  // Anthropic now refuses non-streaming calls when (max_tokens * estimated
  // time-per-token) could exceed 10 minutes. CHUNK_MAX_TOKENS=32768 trips
  // that guard with the error "Streaming is required for operations that
  // may take longer than 10 minutes." Switch to the streaming SDK and
  // collect the final Message — same shape, no 10-min ceiling. Atif's
  // round-5 prod reclassify failed all 15 chunks on this guard before the
  // switch, leaving 0 rows reclassified.
  const callOnce = async (model: typeof MODEL_PRIMARY | typeof MODEL_OPUS) => {
    const stream = client.messages.stream({
      model,
      max_tokens: CHUNK_MAX_TOKENS,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userMsg }],
    })
    return stream.finalMessage()
  }

  let res
  try {
    res = await callOnce(MODEL_PRIMARY)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error("[cpaAgent] classifyChunkAsCpa: API call failed", msg)
    // Anthropic credit / billing errors are terminal for this run — every
    // subsequent chunk will fail the same way. Re-throw so executePipelineRun
    // marks the run FAILED and the user sees the real error in the floating
    // progress panel instead of "0 classifications" with a buried memo.
    // Same for auth errors (invalid API key).
    if (
      /credit balance is too low|insufficient_quota|invalid x-api-key|authentication_error|invalid_api_key/i.test(msg)
    ) {
      throw new Error(
        `Anthropic API unavailable: ${msg.slice(0, 200)}. The autonomous CPA agent cannot run until the API key has credits / is valid.`,
      )
    }
    return []
  }
  const block = res.content[0]
  if (!block || block.type !== "text") {
    console.error("[cpaAgent] classifyChunkAsCpa: response had no text block", res.stop_reason)
    return []
  }
  // Surface truncation explicitly — was the silent killer on Atif's run. If
  // Sonnet hit the output cap, log so we know to bump CHUNK_MAX_TOKENS or
  // shrink CHUNK_SIZE further.
  if (res.stop_reason === "max_tokens") {
    console.error(
      `[cpaAgent] classifyChunkAsCpa: Sonnet hit max_tokens (${CHUNK_MAX_TOKENS}) on ${txns.length}-row chunk — response truncated. Reduce CHUNK_SIZE.`,
    )
  }
  const text = block.text
  const start = text.indexOf("[")
  const end = text.lastIndexOf("]")
  if (start < 0 || end <= start) {
    console.error(
      `[cpaAgent] classifyChunkAsCpa: no JSON array brackets in response (stop_reason=${res.stop_reason}, len=${text.length})`,
    )
    return []
  }
  let parsed: unknown[]
  try {
    parsed = JSON.parse(text.slice(start, end + 1)) as unknown[]
  } catch (err) {
    console.error(
      `[cpaAgent] classifyChunkAsCpa: JSON parse failed (stop_reason=${res.stop_reason}, slice len=${end - start})`,
      err instanceof Error ? err.message : err,
    )
    return []
  }
  if (!Array.isArray(parsed)) {
    console.error("[cpaAgent] classifyChunkAsCpa: parsed value was not an array")
    return []
  }

  const out: RowDecision[] = []
  for (let i = 0; i < parsed.length && i < txns.length; i++) {
    const item = parsed[i] as Record<string, unknown> | undefined
    if (!item || typeof item !== "object") continue
    const txId = typeof item["txId"] === "string" ? item["txId"] : txns[i]!.id
    const codeRaw = item["code"]
    const code: TransactionCode = typeof codeRaw === "string" && VALID_CODE_SET.has(codeRaw)
      ? (codeRaw as TransactionCode)
      : "NEEDS_CONTEXT"
    const scheduleLine = typeof item["scheduleLine"] === "string" ? item["scheduleLine"] : null
    const businessPct = typeof item["businessPct"] === "number"
      ? Math.max(0, Math.min(100, Math.round(item["businessPct"])))
      : 0
    const ircCitations = Array.isArray(item["ircCitations"])
      ? sanitizeCitations(item["ircCitations"])
      : ["[VERIFY]"]
    const evidenceTier = typeof item["evidenceTier"] === "number"
      ? Math.max(1, Math.min(5, Math.round(item["evidenceTier"])))
      : 3
    const confidence = typeof item["confidence"] === "number"
      ? Math.max(0, Math.min(1, item["confidence"]))
      : 0.5
    const reasoning = typeof item["reasoning"] === "string" ? item["reasoning"] : ""
    const notClaimedReason = typeof item["notClaimedReason"] === "string" ? item["notClaimedReason"] : undefined
    const riskNote = typeof item["riskNote"] === "string" ? item["riskNote"] : undefined
    const cohanFlag = item["cohanFlag"] === true

    // Cross-field invariants — defensive, mirrors merchantIntelligence.ts.
    let finalCode = code
    let finalPct = businessPct
    let finalNotClaimed = notClaimedReason
    if ((finalCode === "MEALS_50" || finalCode === "MEALS_100") && finalPct === 0) {
      finalCode = "PERSONAL"
      finalPct = 0
      finalNotClaimed = finalNotClaimed ?? "Meal with 0% business use cannot be deducted; defaulted to PERSONAL."
    }
    // Inflows can NEVER be deductible-coded. The agent saw Wise inflows
    // (+$1853.15 etc.) and tagged them WRITE_OFF / WRITE_OFF_COGS because
    // it pattern-matched on "Wise" → supplier rail without checking the
    // sign of the amount. Force inflows to a non-deductible code so the
    // analytics + Schedule C totals can't double-count them. NEEDS_CONTEXT
    // surfaces these to the user instead of silently disappearing them.
    const inputTx = txns[i]
    const amtSign =
      inputTx ? Number(inputTx.amountNormalized.toString()) : 0
    const isInflow = amtSign < 0
    const DEDUCTIBLE_FOR_INVARIANT = new Set<TransactionCode>([
      "WRITE_OFF",
      "WRITE_OFF_TRAVEL",
      "WRITE_OFF_COGS",
      "MEALS_50",
      "MEALS_100",
      "GRAY",
    ])
    if (isInflow && DEDUCTIBLE_FOR_INVARIANT.has(finalCode)) {
      // Most Wise inflows are owner top-ups from Chase — TRANSFER is the
      // best default. But we don't have the pairing here, so default to
      // NEEDS_CONTEXT so the user sees it. The transfer-pairing pass can
      // upgrade these later.
      finalCode = "NEEDS_CONTEXT"
      finalPct = 0
    }

    out.push({
      txId,
      code: finalCode,
      scheduleLine,
      businessPct: finalPct,
      ircCitations,
      evidenceTier,
      confidence,
      reasoning,
      notClaimedReason: finalNotClaimed,
      riskNote,
      cohanFlag,
    })
  }
  return out
}

// --- Phase D — audit memo --------------------------------------------------

interface BuildMemoArgs {
  taxYearId: string
  decisions: RowDecision[]
  txnsById: Map<string, AgentTxnInput>
  profile: { businessDescription: string | null; naicsCode: string | null; entityType: string; primaryState: string }
  clientNotes: string
  client: Anthropic
}

async function buildAuditMemo({ taxYearId, decisions, txnsById, profile, client }: BuildMemoArgs): Promise<AuditMemo> {
  // Compute deterministic totals first — feed them as ground truth into the
  // sanity-sweep prompt so the AI doesn't hallucinate numbers.
  const totalsClaimedByLine: Record<string, number> = {}
  const totalsNotClaimed: Record<string, number> = {}
  const grayCalls: Array<{ txId: string; choseCode: string; alternativeCode: string; reason: string }> = []
  const followUps: Array<{ kind: string; promptForUser: string; txIds?: string[] }> = []
  const riskFlags: string[] = []
  let cohanCount = 0
  let mealsTotal = 0
  let writeOffTotal = 0
  let cogsTotal = 0
  let mealsNotClaimed = 0

  for (const d of decisions) {
    const tx = txnsById.get(d.txId)
    if (!tx) continue
    const amt = Number(tx.amountNormalized.toString())
    const outflow = Math.max(0, amt)
    const deductible = outflow * (d.businessPct / 100)
    const halved = d.code === "MEALS_50" ? deductible * 0.5 : deductible

    if (d.code === "PERSONAL" && d.notClaimedReason) {
      const key = d.scheduleLine ?? "Personal / not claimed"
      totalsNotClaimed[key] = (totalsNotClaimed[key] ?? 0) + outflow
      if (d.notClaimedReason.toLowerCase().includes("meal") || tx.merchantRaw.toUpperCase().includes("MEAL")) {
        mealsNotClaimed += outflow
      }
    } else if (d.scheduleLine && deductible > 0) {
      totalsClaimedByLine[d.scheduleLine] = (totalsClaimedByLine[d.scheduleLine] ?? 0) + halved
    }

    if (d.code === "WRITE_OFF") writeOffTotal += halved
    if (d.code === "WRITE_OFF_COGS") cogsTotal += halved
    if (d.code === "MEALS_50" || d.code === "MEALS_100") mealsTotal += halved

    if (d.cohanFlag) cohanCount++
    if (d.riskNote) {
      grayCalls.push({
        txId: d.txId,
        choseCode: d.code,
        alternativeCode: d.code === "PERSONAL" ? "WRITE_OFF" : "PERSONAL",
        reason: d.riskNote,
      })
    }
  }

  const totalDeductions = Object.values(totalsClaimedByLine).reduce((a, b) => a + b, 0)
  if (mealsTotal > 0 && mealsTotal / Math.max(totalDeductions, 1) > 0.05) {
    riskFlags.push(`Meals ratio ${((mealsTotal / totalDeductions) * 100).toFixed(1)}% exceeds 5% — IRS DIF flag.`)
  }
  if (cohanCount > 0) {
    riskFlags.push(`${cohanCount} Cohan-flagged classification${cohanCount === 1 ? "" : "s"} — review evidence tier 4 reliance.`)
  }
  if (mealsNotClaimed > 0) {
    followUps.push({
      kind: "UPLOAD_RECEIPT",
      promptForUser: `Meals totaling $${mealsNotClaimed.toFixed(2)} are currently NOT claimed because §274(d) substantiation is missing. Upload receipts or add attendees to claim them.`,
    })
  }

  // Detect coverage gaps — months in the year window with zero transactions.
  const monthsCovered = new Set<string>()
  for (const tx of txnsById.values()) {
    monthsCovered.add(tx.postedDate.toISOString().slice(0, 7))
  }
  const taxYear = await prisma.taxYear.findUniqueOrThrow({ where: { id: taxYearId } })
  const coverageGaps: string[] = []
  for (let m = 0; m < 12; m++) {
    const ym = `${taxYear.year}-${String(m + 1).padStart(2, "0")}`
    if (!monthsCovered.has(ym)) coverageGaps.push(ym)
  }
  if (coverageGaps.length > 0) {
    followUps.push({
      kind: "UPLOAD_STATEMENT",
      promptForUser: `${coverageGaps.length} month${coverageGaps.length === 1 ? "" : "s"} have no transactions: ${coverageGaps.join(", ")}. Upload the missing statements to ensure complete coverage.`,
    })
  }

  // Ask Sonnet for a 2-3 paragraph summary that the CPA can read at a glance.
  let summary = ""
  try {
    const summaryPrompt = `You are summarizing the autonomous-bookkeeping run for a CPA.
Taxpayer: ${profile.businessDescription ?? "(not specified)"} (NAICS ${profile.naicsCode ?? "?"}, ${profile.entityType}, ${profile.primaryState}).
Decisions: ${decisions.length} total. Claimed by line: ${JSON.stringify(totalsClaimedByLine)}. Not claimed (default-PERSONAL for missing substantiation): ${JSON.stringify(totalsNotClaimed)}. Cohan-flagged: ${cohanCount}. Risk flags: ${JSON.stringify(riskFlags)}. Coverage gaps: ${coverageGaps.length} month(s).

Write a 2-3 paragraph executive summary the CPA can read in 30 seconds:
- What the AI claimed and how confident.
- The biggest gray-area calls and the rationale.
- What additional work the taxpayer needs to do (substantiation uploads, missing statements).
Return plain text only — no JSON, no markdown.`

    const res = await client.messages.create({
      model: MODEL_PRIMARY,
      max_tokens: 1024,
      temperature: 0,
      messages: [{ role: "user", content: summaryPrompt }],
    })
    const block = res.content[0]
    if (block && block.type === "text") summary = block.text.trim()
  } catch (err) {
    summary = `Autonomous bookkeeping run completed: ${decisions.length} classifications, $${totalDeductions.toFixed(2)} total deductions across ${Object.keys(totalsClaimedByLine).length} line${Object.keys(totalsClaimedByLine).length === 1 ? "" : "s"}. ${riskFlags.length} risk flag${riskFlags.length === 1 ? "" : "s"}. Sonnet summary unavailable (${err instanceof Error ? err.message : "unknown error"}).`
  }

  return {
    taxYearId,
    generatedAt: new Date().toISOString(),
    model: MODEL_PRIMARY,
    totalsClaimedByLine,
    totalsNotClaimed,
    grayAreaCalls: grayCalls,
    followUps,
    coverageGaps,
    riskFlags,
    summary,
  }
}
