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
import { benchmarksForNaics, type IrsBenchmark } from "@/lib/analytics/irsBenchmarks"

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
  "OWNER_EQUITY",
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
  "OWNER_ACTIVITY",
  // Deduction-opportunity-mining categories. Added 2026-05-21 after a CPA
  // walkthrough of Atif's 2025 found ~$7-13K of likely-missed §162 deductions
  // that the prior audit prompt did not surface. The auditor's job isn't
  // only to catch defects — it's also to spot lines that should have spend
  // but don't, and items in COGS that belong on operating-expense lines.
  "DEDUCTION_GAP",
  "MISCLASSIFIED_LINE",
  "ABOVE_THE_LINE",
] as const

const VALID_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "COSMETIC"] as const

// ─────────────────────────────────────────────────────────────────────────────
// Output schema (per AI response)
// ─────────────────────────────────────────────────────────────────────────────

// Schema is permissive on optional/aliased fields so the AI's natural variance
// doesn't crash the whole audit. Opus tends to use `txnIds` for both RECLASSIFY
// and STOP actions even when the prompt names them differently; we accept
// either spelling, and missing transactionIds defaults to []. The downstream
// FINDINGS_APPLY layer enforces stricter invariants at apply time.
const ReclassifyAction = z.object({
  kind: z.literal("RECLASSIFY"),
  txnIds: z.array(z.string()).min(1),
  code: z.enum(VALID_CODES as [TransactionCode, ...TransactionCode[]]),
  businessPct: z.number().int().min(0).max(100),
  scheduleCLine: z.string().nullable(),
  ircCitations: z.array(z.string()),
  evidenceTier: z.number().int().min(1).max(5),
  cohanFlag: z.boolean().optional(),
  substantiation: z.record(z.string(), z.unknown()).optional(),
})

const StopAction = z
  .object({
    kind: z.literal("STOP"),
    category: z.string(),
    question: z.string(),
    // Either spelling is accepted; the runner normalizes to transactionIds.
    transactionIds: z.array(z.string()).optional(),
    txnIds: z.array(z.string()).optional(),
  })
  .transform((s) => ({
    kind: s.kind,
    category: s.category,
    question: s.question,
    transactionIds: s.transactionIds ?? s.txnIds ?? [],
  }))

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

// Permissive top-level schema. The AI's wording variance + category
// invention + over-long titles shouldn't crash a whole batch:
//   - severity: known string set with passthrough; unknown → "LOW"
//   - category: free string; unknown values written verbatim (DB is String not enum)
//   - title: capped via slice() in post-process, not refused
//   - citedTxnIds: empty array default
const FindingSchema = z
  .object({
    severity: z.string().default("LOW"),
    category: z.string().default("DIF_RISK"),
    title: z.string().default(""),
    rationale: z.string().default(""),
    autoFixable: z.boolean().default(false),
    proposedAction: ProposedAction,
    citedTxnIds: z.array(z.string()).default([]),
  })
  .transform((f) => ({
    ...f,
    severity: (VALID_SEVERITIES as readonly string[]).includes(f.severity)
      ? f.severity
      : "LOW",
    // Category stays free-form — the DB column is String. Unknown values are
    // preserved so a future migration can group them, but the apply layer
    // treats anything outside VALID_CATEGORIES as advisory.
    title: f.title.length > 200 ? f.title.slice(0, 197) + "..." : f.title,
  }))

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
  /**
   * Deduction-opportunity-mining inputs. Deterministic comparisons against
   * IRS SOI per-NAICS benchmarks. Opus's job is to translate these into
   * DEDUCTION_GAP / MISCLASSIFIED_LINE / ABOVE_THE_LINE findings — it does
   * NOT compute the ratios; we compute them in TypeScript so the AI can
   * spend its tokens on judgment, not arithmetic.
   */
  deductionGap: {
    naicsPrefix: string
    benchmarks: Array<{
      label: string
      scheduleCLine: string
      expectedShare: number       // 0..1 from IRS SOI benchmark
      actualAmount: number        // dollars currently on this line for THIS taxpayer
      actualShare: number         // actualAmount / totalDeductions
      gapAmount: number           // (expectedShare - actualShare) * totalDeductions; positive = under-claimed
      severity: "ZERO" | "UNDER" | "INLINE" | "OVER"
    }>
    /** Common payment-processor / wire fees that ended up coded WRITE_OFF_COGS
     *  instead of an operating-expense line. Same deductible amount; moving
     *  them off COGS reduces audit-flag risk on the gross-margin ratio. */
    feeRowsInCogs: Array<{ id: string; merchant: string; amount: number; line: string | null }>
  }
}

// Heuristic patterns for fees masquerading as COGS. Match against the
// normalized merchant string — these vendors are almost universally
// financial-service fees, not inventory cost. The pattern list is
// intentionally narrow; broader payment-processor detection lives in
// lib/ai/feeGuards.ts and the CPA agent's runtime guards.
const COGS_FEE_PATTERNS = [
  /^WISE/i,         // Wise (formerly TransferWise) wire fees
  /\bSTRIPE\b/i,    // Stripe TRANSFER / merchant fees
  /\bPAYPAL\b/i,    // PayPal fees
  /\bSQUARE\b/i,    // Square fees
  /AUTHNET/i,       // Authorize.net gateway
  /WORLDPAY/i,      // WorldPay processor
  /\bACH\b/i,       // generic ACH service fees
]

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
    deductionGap: {
      naicsPrefix: "",
      benchmarks: [],
      feeRowsInCogs: [],
    },
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

  // ── Deduction-opportunity-mining: NAICS-benchmark gap analysis ──────────
  // Fetch NAICS to pick the right benchmark set. Falls back to DEFAULT when
  // profile.naicsCode is null (rare for a year that's reached cpa_audit).
  const profileForGap = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { naicsCode: true },
  })
  const naics = profileForGap?.naicsCode ?? null
  const bench: IrsBenchmark[] = benchmarksForNaics(naics)
  summary.deductionGap.naicsPrefix = naics ? naics.slice(0, 2) : "default"
  summary.deductionGap.benchmarks = bench.map((b) => {
    // Sum across canonical + legacy-spelling buckets for the same line.
    // "Line 27a Other Expenses" and bare "Line 27a" both map to the same
    // Schedule C line in tax software; treat them as one for the gap calc.
    const canonicalRoot = b.scheduleCLine.replace(/ Other Expenses$/, "").replace(/ Other deductions$/, "")
    const actualAmount = Object.entries(summary.perLineTotals)
      .filter(([line]) => line === b.scheduleCLine || line.startsWith(canonicalRoot))
      .reduce((sum, [, t]) => sum + t.total, 0)
    const actualShare = summary.totalDeductions > 0 ? actualAmount / summary.totalDeductions : 0
    const gapAmount = (b.deductionShare - actualShare) * summary.totalDeductions
    let severity: "ZERO" | "UNDER" | "INLINE" | "OVER"
    if (actualAmount === 0 && b.deductionShare >= 0.04) severity = "ZERO"        // $0 on a line industry spends ≥4% on
    else if (actualShare < b.deductionShare * 0.5 && gapAmount > 200) severity = "UNDER"  // <50% of benchmark AND material
    else if (actualShare > b.deductionShare * 1.5) severity = "OVER"             // 1.5× benchmark (also a DIF signal)
    else severity = "INLINE"
    return {
      label: b.label,
      scheduleCLine: b.scheduleCLine,
      expectedShare: b.deductionShare,  // local field renamed for clarity in the prompt
      actualAmount,
      actualShare,
      gapAmount,
      severity,
    }
  })

  // Fee-rows-in-COGS detection. Iterate deductible rows once more — cheaper
  // than re-querying the DB. We only care about COGS-coded rows here; rows
  // in WRITE_OFF Line 17/27a are already on the right operating-expense line.
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    if (c.code !== "WRITE_OFF_COGS" && c.scheduleCLine !== "Part III COGS") continue
    const m = (t.merchantNormalized ?? t.merchantRaw).toUpperCase()
    if (COGS_FEE_PATTERNS.some((rx) => rx.test(m))) {
      summary.deductionGap.feeRowsInCogs.push({
        id: t.id,
        merchant: t.merchantRaw,
        amount: Math.abs(Number(t.amountNormalized)),
        line: c.scheduleCLine,
      })
    }
  }
  // Sort by amount desc, cap at 30 rows so the prompt stays compact.
  summary.deductionGap.feeRowsInCogs.sort((a, b) => b.amount - a.amount)
  summary.deductionGap.feeRowsInCogs = summary.deductionGap.feeRowsInCogs.slice(0, 30)

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
    ``,
    `--- deduction-gap analysis vs IRS SOI benchmark (NAICS prefix ${s.deductionGap.naicsPrefix}) ---`,
    `(Industry medians from IRS SOI Table 1A. ZERO = $0 on a line industry spends ≥4% on. UNDER = <50% of benchmark AND material. INLINE = within normal range. OVER = >150% of benchmark, also a DIF signal.)`,
    ...s.deductionGap.benchmarks.map(
      (b) =>
        `  ${b.severity.padEnd(6)} | ${b.scheduleCLine.padEnd(40)} | expected ${(b.expectedShare * 100).toFixed(1)}% | actual ${(b.actualShare * 100).toFixed(1)}% (${fmtUSD(b.actualAmount, { cents: true })}) | gap ${fmtUSD(b.gapAmount, { cents: true, signed: true })}`
    ),
    ``,
    `--- fee-rows-in-COGS (likely belong on Line 17/27a, NOT Part III COGS) ---`,
    s.deductionGap.feeRowsInCogs.length === 0
      ? `  (none detected — Wise/Stripe/PayPal/Square/AuthNet/WorldPay/ACH patterns are clean)`
      : s.deductionGap.feeRowsInCogs
          .map(
            (r) => `  ${r.id} | ${r.merchant.slice(0, 50)} | ${fmtUSD(r.amount, { cents: true })} | currently on ${r.line ?? "(no line)"}`
          )
          .join("\n"),
  ].join("\n")
}

// ─────────────────────────────────────────────────────────────────────────────
// Prompt — examples drawn from Atif's reviews/atif-2025-review.md findings
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an IRS-auditor-style CPA reviewing a tax-year ledger BEFORE the return is locked and filed.

Your job has TWO halves of equal weight:

  (A) DEFECT HUNTING — find every error a real auditor would flag (double-counts, phantom transfers, missing W-9s, DIF-score risks, §274(d) leaks, code/line mismatches).
  (B) OPPORTUNITY MINING — find every legitimate §162 deduction the taxpayer is leaving on the table. A senior CPA does NOT just fix what's wrong; they catch what's missing. The ledger is what the taxpayer's connected accounts saw — if a category that every business at this NAICS has is $0 here, ASK about it. If a payment-processor fee landed in COGS instead of Line 17, MOVE it. If the entity is sole prop and no above-the-line SE health insurance / retirement contribution is on file, FLAG it.

You do NOT do arithmetic — all per-line totals + per-code totals + NAICS-benchmark gap analysis are computed for you and shown in the summary. Your job is PATTERN RECOGNITION + JUDGMENT: spot the rows that don't fit, the double-counts, the missed deductions, the DIF-score risks, AND the $0 lines that should have spend.

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

Example 8 — OWNER_ACTIVITY: owner contributions / draws hidden in TRANSFER or PERSONAL:
  Pattern (Sole Prop / SMLLC only — skip if entityType is S_CORP / LLC_MULTI / C_CORP / PARTNERSHIP):
  A current Classification (TRANSFER, PERSONAL, or PAYMENT) appears to be owner equity movement
  that should be OWNER_EQUITY instead. Direction by amountNormalized sign:
    > 0 (outflow from business): owner DRAW / distribution
    < 0 (inflow to business):    owner CONTRIBUTION
  Surface when:
    - ATM withdrawals from business account currently coded PERSONAL or TRANSFER
    - "OWNER DRAW", "OWNER CONTRIBUTION", "TRANSFER TO PERSONAL", "TRANSFER FROM PERSONAL"
      literally in description
    - Zelle/Venmo/Cash App movements to/from the owner's known name or known personal aliases
    - PAYMENT-style rows to a card NOT tracked as a FinancialAccount (likely owner's personal CC)
    - Large cross-account TRANSFER pairs where one side is mixed-use / personal
    - **Routing-number signals**: merchantRaw contains a 9-digit ABA routing number (e.g.,
      "Aba/Contr Bnk-021000021" = JPMorgan Chase) AND the user's tracked FinancialAccounts at
      that institution either don't match the amount/date or the user has multiple Chase
      accounts so the routing alone is ambiguous → likely a personal Chase account funding
      the business or vice versa. (See lib/pairing/transfers.ts hint-based OWNER_EQUITY pass
      — already handles obvious cases; this finding picks up edges where the hint pass
      missed because the merchant wording was non-standard.)
    - **Bank-product hints**: "ADV PLUS BANKING" (BofA), "TOTAL CHECKING" (Chase), etc., when
      the user doesn't have a tracked account at that institution → external source.
    - **Mask hints**: "Transfer To Checking 7403" or "CC ending in NNNN" where NNNN doesn't
      match any tracked FinancialAccount.mask → external/personal destination.
  Finding: { severity: MEDIUM, category: OWNER_ACTIVITY,
    proposedAction: { kind: RECLASSIFY, txnIds: [...], code: OWNER_EQUITY, businessPct: 0,
      scheduleCLine: null, ircCitations: ["§61"] (inflow) or ["§263"] (outflow), evidenceTier: 2,
      cohanFlag: false },
    autoFixable: true }
  Hard invariants on OWNER_EQUITY: businessPct=0, scheduleCLine=null, cohanFlag=false. FINDINGS_APPLY
  rejects any violation.

Example 9 — HIGH DEDUCTION_GAP missing-category (opportunity mining):
  Pattern: The deduction-gap analysis shows a Schedule C line at severity=ZERO or severity=UNDER with
  a material gap dollar amount (positive gapAmount > $500). For example, a dropshipping client
  (NAICS 454110) with $0 on Line 8 Advertising, or a freelance client (NAICS 54) with $0 on Line 25
  Utilities. The expected % is from IRS SOI medians — actual being $0 strongly suggests the spend
  exists but is on a non-connected account, paid in cash, or paid from a personal card.
  Finding: { severity: HIGH (when gap > $1K) or MEDIUM (gap $250-$1K) or LOW (gap < $250),
    category: DEDUCTION_GAP,
    title: "Line X $0 actual vs ~Y% NAICS-benchmark — gap ~$Z",
    rationale: "For NAICS <prefix>, the SOI Table 1A median for <line label> is <expected%> of total
      deductions. This taxpayer has $0 on this line. Common explanations: paid from a non-connected
      personal card / cash / a different bank. Ask the taxpayer for receipts or platform exports
      (Meta Ads, Google Ads, T-Mobile, Comcast, etc.) before filing.",
    proposedAction: { kind: STOP, category: DEPOSIT, question: "Do you have <line label> spend paid from
      a non-connected account? If yes, upload receipts or share platform export.", transactionIds: [] },
    autoFixable: false }
  Use category=STOP not RECLASSIFY — the AI can't classify spend it doesn't see. The user supplies it.

Example 10 — MEDIUM MISCLASSIFIED_LINE payment-processor fees in COGS:
  Pattern: The "fee-rows-in-COGS" list at the bottom of the summary names specific rows where
  Wise / Stripe / PayPal / Square / AuthNet / WorldPay / generic ACH fees are coded WRITE_OFF_COGS
  with scheduleCLine="Part III COGS". These are financial-service fees, not inventory cost. Moving
  them off COGS doesn't change the deductible total, but it fixes the gross-margin ratio (a key DIF
  signal) and puts the spend on the correct line per Reg §1.162-1 (ordinary & necessary business
  expense) rather than Reg §1.471 (inventory).
  Finding: { severity: MEDIUM, category: MISCLASSIFIED_LINE,
    title: "Wise/Stripe/PayPal fees $X currently in Part III COGS — move to Line 17/27a",
    rationale: "<N> rows totaling $<X> are payment-processor fees miscoded as COGS. Same deduction,
      cleaner line. Reduces COGS ratio and clarifies gross margin on Schedule C / Form 1065 page 1.",
    proposedAction: { kind: RECLASSIFY, txnIds: [...fee row ids...],
      code: WRITE_OFF, businessPct: 100,
      scheduleCLine: "Line 17 Legal & Professional" (for AuthNet/Stripe gateway-style fees)
        OR "Line 27a Other Expenses" (for Wise/PayPal/ACH wire fees),
      ircCitations: ["§162"], evidenceTier: 3 },
    autoFixable: true }
  This is the rare RECLASSIFY where the deductible amount doesn't change — only the line.
  Apply path enforces the cohanGuards layer; this never touches §274(d) categories.

Example 11 — HIGH ABOVE_THE_LINE opportunity (Sole Prop / SMLLC ONLY):
  Pattern: Entity is SOLE_PROP or LLC_SINGLE (disregarded), the taxpayer has positive net SE income,
  AND none of the standard above-the-line self-employment deductions are referenced anywhere in the
  ledger or profile. These don't appear as transactions — they're elections the taxpayer has to
  make. Three to ask about:
    (a) Self-employed health insurance — 100% above-the-line on Schedule 1 if the taxpayer pays
        their own health premiums and isn't eligible for spouse's employer plan (§162(l)).
    (b) Retirement — SEP-IRA: up to 25% of net SE income; Solo 401(k): up to $23,500 employee
        deferral 2025 + 25% employer (Reg §1.401(k)-1). Even a small contribution is meaningful.
    (c) Home-office actual method (only when current is simplified $500 and home office is large
        enough that depreciation + utilities + mortgage interest × biz% > $500).
  Finding: { severity: HIGH (combined potential lift > $3K) or MEDIUM (< $3K),
    category: ABOVE_THE_LINE,
    title: "Above-the-line: SE health / retirement / home-office actual method",
    rationale: "Net SE income is $<NET>. Three above-the-line options the taxpayer should evaluate
      before filing: (a) §162(l) self-employed health insurance — 100% deductible if eligible;
      (b) SEP-IRA up to ~25% of net SE income (≈$<EST_SEP>) or Solo 401(k) up to $23,500 + employer;
      (c) Form 8829 actual method may exceed simplified $500 if home office is dedicated and
      utilities/depreciation are material. None of these show up automatically — must come from
      the taxpayer.",
    proposedAction: { kind: STOP, category: DEPOSIT, question: "Did you pay your own health
      insurance? Do you have / want to fund a SEP-IRA or Solo 401(k)? Should we compute Form 8829
      actual method?", transactionIds: [] },
    autoFixable: false }
  Skip this finding for S_CORP / LLC_MULTI / C_CORP / PARTNERSHIP — those use different mechanics
  (W-2 health, employer-side retirement contributions, no Schedule C).

Example 12 — MEDIUM DEDUCTION_GAP PERSONAL row with business signal (promote candidate):
  Pattern: A PERSONAL row whose merchant or description strongly matches an industry expense pattern
  for the taxpayer's NAICS. Examples: TEXACO / SHELL / CHEVRON gas on a sole prop with vehicle
  configured for business use; T-MOBILE / VERIZON / COMCAST cell or internet for a sole prop with
  home office; BEST BUY / APPLE STORE / DELL for an e-commerce taxpayer with no Line 13 depreciation;
  STAPLES / OFFICE DEPOT for a service business with $0 on Line 18.
  Finding: { severity: MEDIUM (when amount > $200) or LOW,
    category: DEDUCTION_GAP,
    title: "<merchant> $<amt> coded PERSONAL — likely <Line X> if substantiated",
    rationale: "<NAICS context>. Without a mileage log / phone bill / receipt this can't be moved
      autonomously; surface as STOP for the taxpayer to confirm and upload documentation.",
    proposedAction: { kind: STOP, category: MERCHANT, question: "<merchant> $<amt> on <date> —
      personal or business? If business, upload supporting documentation (mileage log, phone bill,
      receipt).", transactionIds: [<rowId>] },
    autoFixable: false }

HARD RAILS:
1. proposedAction.code MUST be in VALID_CODES (now 12 codes including OWNER_EQUITY).
2. proposedAction.ircCitations MUST be in VALID_CITATIONS (§61, §162, §162(a), §162(l), §263, §263A, §274(d), §274(n), §274(n)(1), §274(n)(2), §262, §1402, §280A, §280A(c), §168(k), §179, §280F, §195, §6001, §163(h), §471, §471(c), Cohan).
3. autoFixable=true is ONLY allowed for kind=RECLASSIFY with a single homogeneous cluster:
   - Same merchant pattern + same proposed code, OR
   - The "fee-rows-in-COGS" MISCLASSIFIED_LINE case where each row is independently identified by id and the new code is a same-deduction line move (Line 17 / 27a).
4. autoFixable=false REQUIRED when proposedAction.code is MEALS_50, MEALS_100, or WRITE_OFF_TRAVEL — those go to the SUBSTANTIATION_QUEUE.
5. OWNER_EQUITY proposals MUST have businessPct=0, scheduleCLine=null, cohanFlag=false. Use citations ["§61"] for contributions (inflow) or ["§263"] for draws (outflow).
6. Never invent transaction IDs. citedTxnIds and proposedAction.txnIds MUST be from the provided summary.
7. Severity scale: CRITICAL (income/deduction error >$1K), HIGH (>$500 or W-9 blocker, or DEDUCTION_GAP/ABOVE_THE_LINE with potential lift >$1K), MEDIUM ($100–500 defect, or DEDUCTION_GAP with lift $250-$1K), LOW (<$100 or cosmetic with audit implication, or DEDUCTION_GAP/PROMOTE candidate <$250), COSMETIC (no audit implication).
8. DEDUCTION_GAP / ABOVE_THE_LINE / MISCLASSIFIED_LINE findings are first-class — they are the OPPORTUNITY MINING half of your job and must appear when the summary indicates them. Do not skip them to stay under the 20-finding cap; promote them ABOVE cosmetic/low-severity defects when ranking.
9. Above-the-line / opportunity STOPs (Examples 9, 11) carry transactionIds: [] — there are no specific transactions yet; the user has to surface them.

OPPORTUNITY MINING CHECKLIST (work through this AFTER the defect-hunt pass):
  □ Read the "deduction-gap analysis vs IRS SOI benchmark" table. For each row with severity=ZERO,
    emit a DEDUCTION_GAP finding asking about that category.
  □ For each row with severity=UNDER and gapAmount > $250, emit a DEDUCTION_GAP finding.
  □ Read the "fee-rows-in-COGS" list. If non-empty, emit ONE MISCLASSIFIED_LINE finding covering
    the whole cluster (one finding, txnIds = all listed rows).
  □ Scan PERSONAL rows > $200 in the personalOver500 list for industry-expected patterns
    (gas/fuel for sole prop with vehicle, internet/cell for home-office, Best Buy/Apple Store
    for e-commerce equipment, office-supply chains for service businesses). Emit DEDUCTION_GAP
    PROMOTE candidates with transactionIds populated.
  □ If entity is SOLE_PROP or LLC_SINGLE and net SE income (grossReceipts - totalDeductions) is
    positive, emit ONE ABOVE_THE_LINE finding for SE health / retirement / home-office actual.
    Skip this for S_CORP / LLC_MULTI / C_CORP / PARTNERSHIP.
  □ If Line 22 Supplies is under $50 AND gross receipts > $20K, surface as DEDUCTION_GAP — a real
    business buys more supplies than that.

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

  // Graceful fall-through: supersede ANY prior PROPOSED CPA_AUDIT-fallthrough
  // findings (don't accumulate stale ones), then write a single LOW finding.
  if (!parsed) {
    let supersededOnFailure = 0
    await prisma.$transaction(async (tx) => {
      const priorFallthroughs = await tx.ledgerFinding.findMany({
        where: {
          taxYearId,
          state: "PROPOSED",
          category: "DIF_RISK",
          title: "CPA audit pass failed — manual review recommended",
        },
        select: { id: true },
      })
      if (priorFallthroughs.length > 0) {
        await tx.ledgerFinding.updateMany({
          where: { id: { in: priorFallthroughs.map((f) => f.id) } },
          data: { state: "SUPERSEDED" },
        })
        supersededOnFailure = priorFallthroughs.length
      }
      await tx.ledgerFinding.create({
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
      await tx.auditEvent.create({
        data: {
          actorType: "AI",
          eventType: "CPA_AUDIT_RUN",
          entityType: "TaxYear",
          entityId: taxYearId,
          afterState: { success: false, modelUsed, error: lastError, supersededOnFailure },
        },
      })
    })
    return { proposed: 0, superseded: supersededOnFailure, totalCost: 0, modelUsed }
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
          // Round-trip through JSON so Prisma's InputJsonValue is happy with
          // the optional `substantiation` Record on ReclassifyAction.
          proposedAction: JSON.parse(JSON.stringify(f.proposedAction)),
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
