/**
 * PRE_CLEANUP — Stage 1 of the auto-CPA pipeline.
 *
 * Replaces 9 .mjs cleanup scripts that we've been running via Railway env vars
 * on each new client. Mostly deterministic; the only AI escape hatch is identity
 * rename (Haiku 4.5) when display-name ambiguity warrants it.
 *
 * Sub-functions, in order:
 *   1. fixInflowMisclassifications     — flip Classifications where inflow got deductible code → NEEDS_CONTEXT
 *   2. markOutOfYearStale              — Transaction.isStale=true for rows outside year boundary
 *   3. archiveSupersededStops          — archive PENDING StopItems whose txns have current Classifications
 *   4. backfillDocuments               — create Document rows from StatementImports without one
 *
 * Each sub-function is idempotent (predicate find + upsert / flip-and-insert),
 * append-only, and writes its own AuditEvent per mutation. Failure of any
 * sub-function records its error in the summary and continues — pre-cleanup
 * is best-effort sweep, never a blocker for the next stage.
 *
 * Replaces: scripts/fix-inflow-misclassifications.mjs, scripts/mark-out-of-year-stale.mjs,
 * scripts/archive-superseded-stops.mjs, scripts/backfill-documents.mjs.
 */

import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"
import type { ProgressReporter } from "@/lib/jobs/pipelineRun"

const DEDUCTIBLE_CODES: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

export interface PreCleanupSummary {
  inflowFlipped: number
  outOfYearStaled: number
  stopsArchived: number
  documentsBackfilled: number
  bizIncomePctBackfilled: number
  errors: Array<{ step: string; message: string }>
}

export async function runPreCleanup(
  taxYearId: string,
  reportProgress?: ProgressReporter
): Promise<PreCleanupSummary> {
  const summary: PreCleanupSummary = {
    inflowFlipped: 0,
    outOfYearStaled: 0,
    stopsArchived: 0,
    documentsBackfilled: 0,
    bizIncomePctBackfilled: 0,
    errors: [],
  }

  const steps: Array<{ name: string; fn: () => Promise<number>; key: keyof Omit<PreCleanupSummary, "errors"> }> = [
    { name: "fix_inflow_misclassifications", fn: () => fixInflowMisclassifications(taxYearId), key: "inflowFlipped" },
    { name: "backfill_biz_income_business_pct", fn: () => backfillBizIncomeBusinessPct(taxYearId), key: "bizIncomePctBackfilled" },
    { name: "mark_out_of_year_stale", fn: () => markOutOfYearStale(taxYearId), key: "outOfYearStaled" },
    { name: "archive_superseded_stops", fn: () => archiveSupersededStops(taxYearId), key: "stopsArchived" },
    { name: "backfill_documents", fn: () => backfillDocuments(taxYearId), key: "documentsBackfilled" },
  ]

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]!
    if (reportProgress) {
      await reportProgress({
        phase: "pre_cleanup",
        processed: i,
        total: steps.length,
        label: step.name,
      })
    }
    try {
      const count = await step.fn()
      summary[step.key] = count
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      summary.errors.push({ step: step.name, message: msg })
      console.error(`[pre_cleanup] ${step.name} failed:`, msg)
    }
  }

  if (reportProgress) {
    await reportProgress({
      phase: "pre_cleanup",
      processed: steps.length,
      total: steps.length,
      label: `Done · ${summary.inflowFlipped} inflows · ${summary.bizIncomePctBackfilled} biz-pct · ${summary.outOfYearStaled} stale · ${summary.stopsArchived} stops · ${summary.documentsBackfilled} docs`,
    })
  }

  return summary
}

// ─────────────────────────────────────────────────────────────────────────────
// Sub-functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Flip Classifications where the underlying Transaction is an inflow
 * (negative amountNormalized) but the code is deductible. Insert a fresh
 * NEEDS_CONTEXT row so the next AI pass triages.
 *
 * Pre-existing invariants in apply.ts and cpaAgent.ts prevent NEW occurrences;
 * this sweep cleans up legacy data from before the invariant landed.
 */
export async function fixInflowMisclassifications(taxYearId: string): Promise<number> {
  const offenders = await prisma.classification.findMany({
    where: {
      isCurrent: true,
      code: { in: DEDUCTIBLE_CODES },
      transaction: {
        taxYearId,
        amountNormalized: { lt: 0 },
        isStale: false,
        isSplit: false,
      },
    },
    select: { id: true, transactionId: true, code: true },
  })

  let fixed = 0
  for (const offender of offenders) {
    await prisma.$transaction(async (tx) => {
      await tx.classification.update({
        where: { id: offender.id },
        data: { isCurrent: false },
      })
      await tx.classification.create({
        data: {
          transactionId: offender.transactionId,
          code: "NEEDS_CONTEXT",
          scheduleCLine: null,
          businessPct: 0,
          ircCitations: [],
          confidence: 0.5,
          evidenceTier: 3,
          source: "AI",
          reasoning: `Pre-cleanup: inflow row was coded ${offender.code} (deductible). Demoted to NEEDS_CONTEXT for triage.`,
          isCurrent: true,
        },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          eventType: "PRECLEANUP_INFLOW_FLIPPED",
          entityType: "Classification",
          entityId: offender.id,
          beforeState: { code: offender.code },
          afterState: { code: "NEEDS_CONTEXT" },
          rationale: "Inflow row had deductible code — demoted to NEEDS_CONTEXT",
        },
      })
    })
    fixed++
  }
  return fixed
}

/**
 * Backfill businessPct=100 on BIZ_INCOME Classifications that still carry the
 * legacy default 0.
 *
 * Semantic intent: for income / non-deductible codes, businessPct doesn't drive
 * any tax math (gross-receipts sums use the absolute amount; the deductible
 * formula short-circuits to 0). But the stored 0 is misleading on the ledger
 * UI and forward-incompatible with any future allocation logic (K-1 owner
 * splits, multi-entity allocations). PR #N normalizes the data: every
 * BIZ_INCOME row carries `businessPct=100` going forward.
 *
 * Idempotent: only flips rows currently at pct=0. Append-only flip-and-insert
 * preserves the audit chain.
 */
export async function backfillBizIncomeBusinessPct(taxYearId: string): Promise<number> {
  const offenders = await prisma.classification.findMany({
    where: {
      isCurrent: true,
      code: "BIZ_INCOME",
      businessPct: 0,
      transaction: {
        taxYearId,
        isStale: false,
        isSplit: false,
      },
    },
    select: {
      id: true,
      transactionId: true,
      scheduleCLine: true,
      ircCitations: true,
      confidence: true,
      evidenceTier: true,
      source: true,
      reasoning: true,
      substantiation: true,
      cohanFlag: true,
    },
  })

  let fixed = 0
  for (const o of offenders) {
    await prisma.$transaction(async (tx) => {
      await tx.classification.update({
        where: { id: o.id },
        data: { isCurrent: false },
      })
      await tx.classification.create({
        data: {
          transactionId: o.transactionId,
          code: "BIZ_INCOME",
          scheduleCLine: o.scheduleCLine,
          businessPct: 100,
          ircCitations: o.ircCitations,
          confidence: o.confidence,
          evidenceTier: o.evidenceTier,
          source: o.source,
          reasoning: o.reasoning,
          substantiation: o.substantiation ?? undefined,
          cohanFlag: o.cohanFlag,
          isCurrent: true,
        },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          eventType: "PRECLEANUP_BIZ_INCOME_PCT_FIXED",
          entityType: "Classification",
          entityId: o.id,
          beforeState: { businessPct: 0 },
          afterState: { businessPct: 100 },
          rationale:
            "BIZ_INCOME businessPct backfilled to 100 — semantic consistency with the rest of the pipeline (cohanSweep, derive.ts already write 100).",
        },
      })
    })
    fixed++
  }
  return fixed
}

/**
 * Mark Transactions outside the year boundary as isStale=true. Out-of-year
 * leakage typically comes from December PDFs that include the first few days
 * of January and vice versa.
 */
export async function markOutOfYearStale(taxYearId: string): Promise<number> {
  const taxYear = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { year: true },
  })
  const startOfYear = new Date(Date.UTC(taxYear.year, 0, 1))
  const endOfYear = new Date(Date.UTC(taxYear.year + 1, 0, 1))

  const offenders = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isStale: false,
      OR: [
        { postedDate: { lt: startOfYear } },
        { postedDate: { gte: endOfYear } },
      ],
    },
    select: { id: true, postedDate: true },
  })

  if (offenders.length === 0) return 0

  await prisma.$transaction(async (tx) => {
    for (const o of offenders) {
      await tx.transaction.update({
        where: { id: o.id },
        data: {
          isStale: true,
          staleReason: `Posted ${o.postedDate.toISOString().slice(0, 10)} — outside tax year ${taxYear.year}`,
        },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          eventType: "PRECLEANUP_STALE_MARKED",
          entityType: "Transaction",
          entityId: o.id,
          afterState: { isStale: true, postedDate: o.postedDate.toISOString() },
          rationale: `Out of year ${taxYear.year}`,
        },
      })
    }
  })

  return offenders.length
}

/**
 * Archive PENDING StopItems where every cited Transaction now has a current
 * Classification. The CPA agent (or a later AI pass) has already triaged the
 * underlying rows; the leftover STOP is stale.
 */
export async function archiveSupersededStops(taxYearId: string): Promise<number> {
  const pending = await prisma.stopItem.findMany({
    where: { taxYearId, state: "PENDING" },
    select: { id: true, transactionIds: true, category: true },
  })

  let archived = 0
  for (const stop of pending) {
    if (stop.transactionIds.length === 0) continue

    const classifiedCount = await prisma.classification.count({
      where: {
        transactionId: { in: stop.transactionIds },
        isCurrent: true,
      },
    })

    if (classifiedCount < stop.transactionIds.length) continue

    await prisma.$transaction(async (tx) => {
      await tx.stopItem.update({
        where: { id: stop.id },
        data: {
          state: "ANSWERED",
          userAnswer: { source: "pre_cleanup_superseded" },
          answeredAt: new Date(),
        },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          eventType: "PRECLEANUP_STOP_ARCHIVED",
          entityType: "StopItem",
          entityId: stop.id,
          rationale: "All cited transactions now have current classifications",
        },
      })
    })
    archived++
  }

  return archived
}

/**
 * Create Document rows for StatementImports that don't have a corresponding
 * Document (category=STATEMENT). This unifies the Documents view so the CPA
 * sees every uploaded artifact in one place.
 */
export async function backfillDocuments(taxYearId: string): Promise<number> {
  const taxYear = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { userId: true },
  })

  const imports = await prisma.statementImport.findMany({
    where: { taxYearId },
    include: { account: true },
  })

  // Existing Documents tagged with this taxYearId + category STATEMENT.
  const existingDocs = await prisma.document.findMany({
    where: { taxYearId, category: "STATEMENT" },
    select: { filePath: true },
  })
  const existingPaths = new Set(existingDocs.map((d) => d.filePath))

  let created = 0
  for (const imp of imports) {
    if (existingPaths.has(imp.filePath)) continue

    await prisma.$transaction(async (tx) => {
      const doc = await tx.document.create({
        data: {
          userId: taxYear.userId,
          taxYearId,
          category: "STATEMENT",
          title: `${imp.account.institution} ${imp.account.type} — ${imp.originalFilename}`,
          filePath: imp.filePath,
          originalFilename: imp.originalFilename,
          mimeType: imp.fileType,
          tags: [imp.account.institution, imp.account.type].filter(Boolean) as string[],
        },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "SYSTEM",
          eventType: "PRECLEANUP_DOCUMENT_BACKFILLED",
          entityType: "Document",
          entityId: doc.id,
          afterState: { statementImportId: imp.id, filePath: imp.filePath },
        },
      })
    })
    created++
  }

  return created
}
