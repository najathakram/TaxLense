/**
 * CPA_AUDIT — Stage 6 of the auto-CPA pipeline (post-classification, pre-lock).
 *
 * Replaces the out-of-band Opus 4.7 audit workflow that produced
 * reviews/atif-2025-review.md. Reads the entire classified ledger as a compact
 * summary and emits structured LedgerFinding rows.
 *
 * Output finding categories (mirror Atif's 7 production findings):
 *   - DOUBLE_COUNT     — bounced check / reversal coded as expense
 *   - PHANTOM_TRANSFER — single-sided transfer with same-amount counterpart elsewhere
 *   - MISSING_LINE     — deductible row with no scheduleCLine assigned (fallback escape)
 *   - DUP_LINE_BUCKET  — same canonical Schedule C line spelled two ways
 *   - MISSING_W9       — 1099-NEC recipient lacks a W-9 on file
 *   - DIF_RISK         — DIF-score danger zone (Line 27a > 10%, meals > 5%, etc.)
 *   - PERSONAL_ANOMALY — large PERSONAL row that might be missed §162 deduction
 *   - SUSPECT_CLASS    — generic anomaly (PERSONAL inflow named INCOME etc.)
 *
 * Each finding carries proposedAction { kind: "RECLASSIFY" | "STOP" | "BLOCK" | "NOTE" }
 * which is applied later by lib/findings/apply.ts (after user batch-approves).
 *
 * Model: claude-opus-4-7, temp 0. Cost target ~$3.50 / run at Atif scale.
 * The model is given a compact ~3 KB ledger summary (per-line totals + 30
 * largest + 30 smallest + PERSONAL > $500 + counterparties on both sides) —
 * NOT the full ledger. Opus's job is pattern recognition over the summary,
 * not arithmetic; the totals are computed deterministically in TypeScript.
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"
import type { ProgressReporter } from "@/lib/jobs/pipelineRun"
import { fmtUSD } from "@/lib/format/currency"

const MODEL = "claude-opus-4-7" as const
const FALLBACK_MODEL = "claude-sonnet-4-6" as const
const MAX_TOKENS = 16384

const DEDUCTIBLE_CODES: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

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

const VALID_CATEGORIES = [
  "DOUBLE_COUNT",
  "PHANTOM_TRANSFER",
  "MISSING_LINE",
  "DIF_RISK",
  "SUSPECT_CLASS",
  "MISSING_W9",
  "DUP_LINE_BUCKET",
  "PERSONAL_ANOMALY",
] as const

const VALID_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "COSMETIC"] as const

// ─────────────────────────────────────────────────────────────────────────────
// Output schema (per AI response)
// ─────────────────────────────────────────────────────────────────────────────

const ReclassifyAction = z.object({
  kind: z.literal("RECLASSIFY"),
  txnIds: z.array(z.string()).min(1),
  code: z.enum(VALID_CODES as [TransactionCode, ...TransactionCode[]]),
  businessPct: z.number().int().min(0).max(100),
  scheduleCLine: z.string().nullable(),
  ircCitations: z.array(z.string()),
  evidenceTier: z.number().int().min(1).max(5),
})

const StopAction = z.object({
  kind: z.literal("STOP"),
  category: z.string(),
  question: z.string(),
  transactionIds: z.array(z.string()),
})

const BlockAction = z.object({
  kind: z.literal("BLOCK"),
  reason: z.string(),
})

const NoteAction = z.object({
  kind: z.literal("NOTE"),
  suggestion: z.string(),
})

const ProposedAction = z.discriminatedUnion("kind", [
  ReclassifyAction,
  StopAction,
  BlockAction,
  NoteAction,
])

const FindingSchema = z.object({
  severity: z.enum(VALID_SEVERITIES as unknown as [string, ...string[]]),
  category: z.enum(VALID_CATEGORIES as unknown as [string, ...string[]]),
  title: z.string().min(5).max(150),
  rationale: z.string().min(20),
  autoFixable: z.boolean(),
  proposedAction: ProposedAction,
  citedTxnIds: z.array(z.string()),
})

const AuditResponseSchema = z.object({
  findings: z.array(FindingSchema),
})

export type CpaAuditFinding = z.infer<typeof FindingSchema>

// ─────────────────────────────────────────────────────────────────────────────
// Compact summary builder (deterministic — feeds Opus the numbers)
// ─────────────────────────────────────────────────────────────────────────────

interface LedgerSummary {
  perLineTotals: Record<string, { count: number; total: number }>
  perCodeTotals: Record<string, { count: number; total: number }>
  top30Largest: Array<{ id: string; date: string; merchant: string; amount: number; code: string; line: string | null }>
  top30Smallest: Array<{ id: string; date: string; merchant: string; amount: number; code: string; line: string | null }>
  personalOver500: Array<{ id: string; date: string; merchant: string; amount: number; reason: string | null }>
  twoSidedCounterparties: Array<{ merchant: string; inflowCount: number; outflowCount: number; netCents: number }>
  grossReceipts: number
  totalDeductions: number
  meals50Count: number
  meals100Count: number
  travelCount: number
  noLineDeductibleCount: number
  cohanCount: number
}

async function buildLedgerSummary(taxYearId: string): Promise<LedgerSummary> {
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
    orderBy: { postedDate: "asc" },
  })

  const summary: LedgerSummary = {
    perLineTotals: {},
    perCodeTotals: {},
    top30Largest: [],
    top30Smallest: [],
    personalOver500: [],
    twoSidedCounterparties: [],
    grossReceipts: 0,
    totalDeductions: 0,
    meals50Count: 0,
    meals100Count: 0,
    travelCount: 0,
    noLineDeductibleCount: 0,
    cohanCount: 0,
  }

  const byMerchant = new Map<string, { inflowCount: number; outflowCount: number; netCents: number }>()

  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const amt = Number(t.amountNormalized)
    const absAmt = Math.abs(amt)

    // per-code
    const codeKey = c.code
    if (!summary.perCodeTotals[codeKey]) summary.perCodeTotals[codeKey] = { count: 0, total: 0 }
    summary.perCodeTotals[codeKey].count++
    summary.perCodeTotals[codeKey].total += absAmt

    // per-line (deductibles only)
    if (DEDUCTIBLE_CODES.includes(c.code)) {
      const line = c.scheduleCLine ?? "(no line)"
      if (!summary.perLineTotals[line]) summary.perLineTotals[line] = { count: 0, total: 0 }
      let ded = Math.max(0, amt) * (c.businessPct / 100)
      if (c.code === "MEALS_50") ded *= 0.5
      summary.perLineTotals[line].count++
      summary.perLineTotals[line].total += ded
      summary.totalDeductions += ded
      if (!c.scheduleCLine) summary.noLineDeductibleCount++
      if (c.cohanFlag) summary.cohanCount++
    }
    if (c.code === "BIZ_INCOME") summary.grossReceipts += absAmt
    if (c.code === "MEALS_50") summary.meals50Count++
    if (c.code === "MEALS_100") summary.meals100Count++
    if (c.code === "WRITE_OFF_TRAVEL") summary.travelCount++

    // counterparty tally
    const merchantKey = (t.merchantNormalized ?? t.merchantRaw).toUpperCase().slice(0, 60)
    const cp = byMerchant.get(merchantKey) ?? { inflowCount: 0, outflowCount: 0, netCents: 0 }
    if (amt < 0) cp.inflowCount++
    else cp.outflowCount++
    cp.netCents += Math.round(amt * 100)
    byMerchant.set(merchantKey, cp)

    if (c.code === "PERSONAL" && absAmt > 500) {
      summary.personalOver500.push({
        id: t.id,
        date: t.postedDate.toISOString().slice(0, 10),
        merchant: t.merchantRaw,
        amount: amt,
        reason: c.reasoning,
      })
    }
  }

  // Top largest / smallest by absolute amount (within deductible rows only — most relevant)
  const deductibleSorted = [...txns]
    .filter((t) => {
      const c = t.classifications[0]
      return c && DEDUCTIBLE_CODES.includes(c.code)
    })
    .sort((a, b) => Math.abs(Number(b.amountNormalized)) - Math.abs(Number(a.amountNormalized)))

  summary.top30Largest = deductibleSorted.slice(0, 30).map((t) => ({
    id: t.id,
    date: t.postedDate.toISOString().slice(0, 10),
    merchant: t.merchantRaw,
    amount: Number(t.amountNormalized),
    code: t.classifications[0]!.code,
    line: t.classifications[0]!.scheduleCLine,
  }))
  summary.top30Smallest = deductibleSorted.slice(-30).map((t) => ({
    id: t.id,
    date: t.postedDate.toISOString().slice(0, 10),
    merchant: t.merchantRaw,
    amount: Number(t.amountNormalized),
    code: t.classifications[0]!.code,
    line: t.classifications[0]!.scheduleCLine,
  }))
  summary.personalOver500 = summary.personalOver500.slice(0, 50)

  // Two-sided counterparties (merchants appearing as BOTH inflow + outflow)
  for (const [merchant, c] of byMerchant.entries()) {
    if (c.inflowCount > 0 && c.outflowCount > 0 && Math.abs(c.netCents) < 100 * 100) {
      summary.twoSidedCounterparties.push({
        merchant,
        inflowCount: c.inflowCount,
        outflowCount: c.outflowCount,
        netCents: c.netCents,
      })
    }
  }
  summary.twoSidedCounterparties.sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents))
  summary.twoSidedCounterparties = summary.twoSidedCounterparties.slice(0, 20)

  return summary
}

function renderSummary(s: LedgerSummary): string {
  const perCode = Object.entries(s.perCodeTotals)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([k, v]) => `  ${k}: ${v.count} txns, ${fmtUSD(v.total, { cents: true })}`)
    .join("\n")
  const perLine = Object.entries(s.perLineTotals)
    .sort((a, b) => b[1].total - a[1].total)
    .map(([k, v]) => `  ${k}: ${v.count} txns, ${fmtUSD(v.total, { cents: true })}`)
    .join("\n")

  return [
    `=== LEDGER SUMMARY ===`,
    ``,
    `Gross Receipts: ${fmtUSD(s.grossReceipts, { cents: true })}`,
    `Total Deductions: ${fmtUSD(s.totalDeductions, { cents: true })}`,
    `MEALS_50 rows: ${s.meals50Count} / MEALS_100 rows: ${s.meals100Count} / WRITE_OFF_TRAVEL rows: ${s.travelCount}`,
    `Cohan-flagged: ${s.cohanCount} / Deductible rows missing Schedule C line: ${s.noLineDeductibleCount}`,
    ``,
    `--- per-code totals ---`,
    perCode || "  (none)",
    ``,
    `--- per-Schedule-C-line totals ---`,
    perLine || "  (none)",
    ``,
    `--- top 30 largest deductible rows ---`,
    ...s.top30Largest.map(
      (r) =>
        `  ${r.id} | ${r.date} | ${r.merchant.slice(0, 40)} | ${fmtUSD(r.amount, { cents: true })} | ${r.code} | ${r.line ?? "(no line)"}`
    ),
    ``,
    `--- top 30 smallest deductible rows ---`,
    ...s.top30Smallest.map(
      (r) =>
        `  ${r.id} | ${r.date} | ${r.merchant.slice(0, 40)} | ${fmtUSD(r.amount, { cents: true })} | ${r.code} | ${r.line ?? "(no line)"}`
    ),
    ``,
    `--- PERSONAL rows with abs amount > $500 ---`,
    ...s.personalOver500.map(
      (r) =>
        `  ${r.id} | ${r.date} | ${r.merchant.slice(0, 40)} | ${fmtUSD(r.amount, { cents: true })} | ${r.reason?.slice(0, 100) ?? "(no reason)"}`
    ),
    ``,
    `--- counterparties on BOTH sides of ledger (near-zero net) ---`,
    ...s.twoSidedCounterparties.map(
      (r) =>
        `  ${r.merchant} | inflows: ${r.inflowCount} | outflows: ${r.outflowCount} | net: ${fmtUSD(r.netCents / 100, { cents: true })}`
    ),
  ].join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt — examples drawn from Atif's reviews/atif-2025-review.md findings
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an IRS-auditor-style CPA reviewing a tax-year ledger BEFORE the return is locked and filed.

Your job: find every defect a real auditor would flag, and emit STRUCTURED findings with proposed fixes.

You do NOT do arithmetic — all per-line totals + per-code totals are computed for you and shown in the summary. Your job is PATTERN RECOGNITION: spot the rows that don't fit, the double-counts, the missed deductions, the DIF-score risks.

REAL-WORLD FINDING EXAMPLES (from a recent production audit — match this style):

Example 1 — CRITICAL bounced check double-count:
  Pattern: One large inflow (BIZ_INCOME, +$X) followed within 1–3 days by a same-amount outflow labeled
  "DEPOSITED ITEM RETURNED" / "RETURN OF POSTED CHECK" / "REVERSAL" / "CHARGEBACK" coded as WRITE_OFF.
  Finding: { severity: CRITICAL, category: DOUBLE_COUNT,
    proposedAction: { kind: RECLASSIFY, txnIds:[outflowTxId], code: PERSONAL,
      businessPct: 0, scheduleCLine: null, ircCitations: [], evidenceTier: 2 },
    autoFixable: true }

Example 2 — MEDIUM Wise wallet phantom transfer:
  Pattern: A single POSITIVE-amount row on a money-mover account (Wise/PayPal/etc.) whose merchant string
  matches "SENT MONEY TO X" but is coded BIZ_INCOME. The 28 other SENT MONEY rows for X are all negative.
  Finding: { severity: MEDIUM, category: PHANTOM_TRANSFER,
    proposedAction: { kind: RECLASSIFY, txnIds:[phantomId], code: TRANSFER,
      businessPct: 0, scheduleCLine: null, ircCitations: [], evidenceTier: 2 },
    autoFixable: true }

Example 3 — LOW deductible rows missing Schedule C line:
  Pattern: 5+ rows with code=WRITE_OFF, deductible>0, but scheduleCLine=null. The line fallback should
  have assigned Line 27a but didn't run for these rows (legacy data).
  Finding: { severity: LOW, category: MISSING_LINE,
    proposedAction: { kind: RECLASSIFY, txnIds:[...], code: WRITE_OFF,
      businessPct: 100, scheduleCLine: "Line 27a Other Expenses", ircCitations: ["§162"], evidenceTier: 2 },
    autoFixable: true }

Example 4 — COSMETIC duplicate line buckets:
  Pattern: Two per-line totals for the SAME canonical line ("Line 27a Other Expenses" vs "Line 27a";
  "Line 16b Interest" vs "Line 16b") — legacy spelling drift.
  Finding: { severity: COSMETIC, category: DUP_LINE_BUCKET,
    proposedAction: { kind: NOTE, suggestion: "merge legacy labels to canonical" },
    autoFixable: false }

Example 5 — REVIEW missing W-9 for 1099-NEC recipient:
  Pattern: Contractor paid ≥$600 via Zelle / Contract Labor line. No W-9 in the year.
  Finding: { severity: HIGH, category: MISSING_W9,
    proposedAction: { kind: BLOCK, reason: "Collect W-9 from <recipient> before generating 1099-NEC" },
    autoFixable: false }

Example 6 — WATCH Line 27a as % of total deductions:
  Pattern: Line 27a Other Expenses > 10% of total deductions. DIF-score risk for Schedule C audits.
  Finding: { severity: MEDIUM, category: DIF_RISK,
    proposedAction: { kind: NOTE, suggestion: "Review the N largest Line 27a rows for re-home to specific lines (Line 17, 18, 22, 23)" },
    autoFixable: false }

Example 7 — OPPORTUNITY large PERSONAL rows that look business:
  Pattern: PERSONAL row with abs amount > $500 + merchant matching the taxpayer's NAICS (e.g.,
  Pocketsflow on a dropshipping client, AuthNet/Stripe on an e-commerce client, Wise to identified
  Pakistan supplier).
  Finding: { severity: LOW, category: PERSONAL_ANOMALY,
    proposedAction: { kind: STOP, category: MERCHANT, question: "<merchant> $<amt> looks business-adjacent — promote to WRITE_OFF or confirm personal?", transactionIds:[...] },
    autoFixable: false }

HARD RAILS:
1. proposedAction.code MUST be in VALID_CODES.
2. proposedAction.ircCitations MUST be in VALID_CITATIONS (§61, §162, §162(a), §263A, §274(d), §274(n), §274(n)(1), §274(n)(2), §262, §1402, §280A, §280A(c), §168(k), §179, §280F, §195, §6001, §163(h), §471, §471(c), Cohan).
3. autoFixable=true is ONLY allowed for kind=RECLASSIFY with a single homogeneous merchant cluster (all rows have the same merchant + same proposed code).
4. autoFixable=false REQUIRED when proposedAction.code is MEALS_50, MEALS_100, or WRITE_OFF_TRAVEL — those go to the SUBSTANTIATION_QUEUE.
5. Never invent transaction IDs. citedTxnIds and proposedAction.txnIds MUST be from the provided summary.
6. Severity scale: CRITICAL (income/deduction error >$1K), HIGH (>$500 or W-9 blocker), MEDIUM ($100–500), LOW (<$100 or cosmetic with audit implication), COSMETIC (no audit implication).

OUTPUT FORMAT — STRICT JSON ONLY (no prose, no markdown):

{
  "findings": [
    {
      "severity": "CRITICAL",
      "category": "DOUBLE_COUNT",
      "title": "Bounced check $X.XX double-counted",
      "rationale": "Detailed explanation citing the specific txn IDs and amounts...",
      "autoFixable": true,
      "proposedAction": { "kind": "RECLASSIFY", "txnIds": ["tx_xxx"], "code": "PERSONAL", "businessPct": 0, "scheduleCLine": null, "ircCitations": [], "evidenceTier": 2 },
      "citedTxnIds": ["tx_xxx", "tx_yyy"]
    }
  ]
}

Return AT MOST 20 findings, ranked most-severe first. If you find none, return { "findings": [] }.`

// ─────────────────────────────────────────────────────────────────────────────
// Runner
// ─────────────────────────────────────────────────────────────────────────────

export interface CpaAuditResult {
  proposed: number
  superseded: number
  totalCost: number
  modelUsed: string
}

export async function runCpaAudit(
  taxYearId: string,
  reportProgress?: ProgressReporter,
  options: { runId?: string; anthropicClient?: Anthropic } = {}
): Promise<CpaAuditResult> {
  const client = options.anthropicClient ?? new Anthropic()
  if (reportProgress) {
    await reportProgress({
      phase: "cpa_audit",
      processed: 0,
      total: 3,
      label: "Building ledger summary…",
    })
  }

  const summary = await buildLedgerSummary(taxYearId)
  const summaryText = renderSummary(summary)

  // Profile context
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { naicsCode: true, businessDescription: true, entityType: true, primaryState: true },
  })

  const userPrompt = `Taxpayer profile:
NAICS: ${profile?.naicsCode ?? "Unknown"}
Description: ${profile?.businessDescription ?? "Unknown"}
Entity: ${profile?.entityType ?? "SOLE_PROP"}
State: ${profile?.primaryState ?? "Unknown"}

${summaryText}

Find every defect a real auditor would flag. Respond with STRICT JSON only.`

  if (reportProgress) {
    await reportProgress({
      phase: "cpa_audit",
      processed: 1,
      total: 3,
      label: `Opus 4.7 reviewing ledger (${Object.keys(summary.perCodeTotals).length} codes, ${Object.keys(summary.perLineTotals).length} lines)…`,
    })
  }

  let modelUsed: string = MODEL
  let parsed: { findings: CpaAuditFinding[] } | null = null
  let lastError: string | null = null

  // First attempt: Opus
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userPrompt }],
    })
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
    parsed = AuditResponseSchema.parse(JSON.parse(stripFences(text)))
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.error("[cpa_audit] Opus attempt failed:", lastError)
  }

  // Fallback: Sonnet (cheaper, still good for pattern recognition)
  if (!parsed) {
    try {
      const response = await client.messages.create({
        model: FALLBACK_MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT + "\n\nPREVIOUS ATTEMPT FAILED JSON PARSE — return strict JSON only.",
        messages: [{ role: "user", content: userPrompt }],
      })
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
      parsed = AuditResponseSchema.parse(JSON.parse(stripFences(text)))
      modelUsed = FALLBACK_MODEL
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
      console.error("[cpa_audit] Sonnet fallback also failed:", lastError)
    }
  }

  // Graceful fall-through: write a single LOW finding noting the audit didn't run
  if (!parsed) {
    await prisma.ledgerFinding.create({
      data: {
        taxYearId,
        generatedRunId: options.runId ?? null,
        severity: "LOW",
        category: "DIF_RISK",
        title: "CPA audit pass failed — manual review recommended",
        rationale: `Both Opus and Sonnet attempts failed: ${lastError ?? "unknown"}`,
        autoFixable: false,
        proposedAction: { kind: "NOTE", suggestion: "Re-run CPA_AUDIT or review manually." },
        citedTxnIds: [],
      },
    })
    await prisma.auditEvent.create({
      data: {
        actorType: "AI",
        eventType: "CPA_AUDIT_RUN",
        entityType: "TaxYear",
        entityId: taxYearId,
        afterState: { success: false, modelUsed, error: lastError },
      },
    })
    return { proposed: 0, superseded: 0, totalCost: 0, modelUsed }
  }

  if (reportProgress) {
    await reportProgress({
      phase: "cpa_audit",
      processed: 2,
      total: 3,
      label: `Supersing prior findings and writing ${parsed.findings.length} new findings…`,
    })
  }

  // Supersede prior PROPOSED findings, write the new set
  let superseded = 0
  let proposed = 0
  await prisma.$transaction(async (tx) => {
    const supersedeTargets = await tx.ledgerFinding.findMany({
      where: { taxYearId, state: "PROPOSED" },
      select: { id: true },
    })
    if (supersedeTargets.length > 0) {
      await tx.ledgerFinding.updateMany({
        where: { id: { in: supersedeTargets.map((s) => s.id) } },
        data: { state: "SUPERSEDED" },
      })
      superseded = supersedeTargets.length
    }

    for (const f of parsed!.findings) {
      // Defensive: drop findings with empty citedTxnIds when category requires them
      if (f.proposedAction.kind === "RECLASSIFY" && f.proposedAction.txnIds.length === 0) continue
      const created = await tx.ledgerFinding.create({
        data: {
          taxYearId,
          generatedRunId: options.runId ?? null,
          severity: f.severity,
          category: f.category,
          title: f.title,
          rationale: f.rationale,
          autoFixable: f.autoFixable,
          proposedAction: f.proposedAction,
          citedTxnIds: f.citedTxnIds,
          supersedesId: null,
        },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "AI",
          eventType: "LEDGER_FINDING_PROPOSED",
          entityType: "LedgerFinding",
          entityId: created.id,
          afterState: { severity: f.severity, category: f.category, autoFixable: f.autoFixable },
        },
      })
      proposed++
    }
  })

  await prisma.auditEvent.create({
    data: {
      actorType: "AI",
      eventType: "CPA_AUDIT_RUN",
      entityType: "TaxYear",
      entityId: taxYearId,
      afterState: { success: true, modelUsed, proposed, superseded },
    },
  })

  if (reportProgress) {
    await reportProgress({
      phase: "cpa_audit",
      processed: 3,
      total: 3,
      label: `Done · ${proposed} findings proposed · ${superseded} prior superseded`,
    })
  }

  return { proposed, superseded, totalCost: 0, modelUsed }
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
}
