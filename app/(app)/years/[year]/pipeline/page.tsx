import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { PipelineClient } from "./pipeline-client"
import { NextStopsBanner } from "@/components/pipeline/next-stops-banner"
import { buildReceipt, type Receipt } from "@/lib/jobs/receipts"
import type { PipelineRunKind } from "@/app/generated/prisma/client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function PipelinePage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  // --- Stats ---
  const totalTx = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isDuplicateOf: null },
  })

  const normalizedTx = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isDuplicateOf: null, merchantNormalized: { not: null } },
  })

  const transferPairs = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isTransferPairedWith: { not: null } },
  })

  const paymentPairs = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isPaymentPairedWith: { not: null } },
  })

  const refundPairs = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isRefundPairedWith: { not: null } },
  })

  const merchantRules = await prisma.merchantRule.count({
    where: { taxYearId: taxYear.id },
  })

  const classified = await prisma.classification.count({
    where: {
      transaction: { taxYearId: taxYear.id },
      isCurrent: true,
    },
  })

  const stops = await prisma.stopItem.count({
    where: { taxYearId: taxYear.id, state: "PENDING" },
  })

  // Distinct backlog counts so steps 7, 8, 9 each show what they would
  // actually consume — not the same "94 stops pending" value three times.
  //
  // Step 7 (Residual AI) — proxy for selectResidualCandidates() without the
  //   heavy outlier / trip-boundary scan. The MULTI_CANDIDATE gate (GRAY
  //   rule, confidence < 0.85) is the dominant signal in practice.
  // Step 8 (Bulk Classify) — current classifications stamped NEEDS_CONTEXT
  //   are exactly the input set to runBulkClassifyPass.
  // Step 9 (Auto-Resolve) — same as the existing PENDING StopItem count.
  const [residualCandidates, needsContextCount, pendingStops] = await Promise.all([
    prisma.merchantRule.count({
      where: { taxYearId: taxYear.id, code: "GRAY", confidence: { lt: 0.85 } },
    }),
    prisma.classification.count({
      where: {
        transaction: { taxYearId: taxYear.id },
        isCurrent: true,
        code: "NEEDS_CONTEXT",
      },
    }),
    prisma.stopItem.count({
      where: { taxYearId: taxYear.id, state: "PENDING" },
    }),
  ])

  // Idempotency receipts (Tier 2.8) — fetch the most recent DONE run for each
  // pipeline kind in one round trip, then project each row to the unified
  // {changed, unchanged, skipped, summary, durationMs} shape. The pipeline
  // client renders one line per step beneath the Run button, so the user can
  // see at-a-glance whether the last run did anything.
  const trackedKinds: PipelineRunKind[] = [
    "NORMALIZE_MERCHANTS",
    "MATCH_TRANSFERS",
    "MATCH_PAYMENTS",
    "MATCH_REFUNDS",
    "MERCHANT_AI",
    "APPLY_RULES",
    "RESIDUAL_AI",
    "BULK_CLASSIFY",
    "AUTO_RESOLVE_STOPS",
    "CPA_AGENT",
    "EXTRACT_REPASS",
  ]
  const latestRuns = await prisma.pipelineRun.findMany({
    where: {
      taxYearId: taxYear.id,
      status: "DONE",
      kind: { in: trackedKinds },
    },
    select: {
      kind: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      result: true,
    },
    orderBy: { startedAt: "desc" },
  })
  const seen = new Set<PipelineRunKind>()
  const receipts: Partial<Record<PipelineRunKind, Receipt>> = {}
  for (const r of latestRuns) {
    if (seen.has(r.kind)) continue
    seen.add(r.kind)
    const receipt = buildReceipt(
      {
        kind: r.kind,
        status: r.status,
        startedAt: r.startedAt,
        finishedAt: r.finishedAt,
        result: r.result,
      },
      { totalTx },
    )
    if (receipt) receipts[r.kind] = receipt
  }
  // Convert Date objects into ISO strings so the client component can hydrate
  // the receipts without RSC serialization complaints.
  const wireReceipts: Record<string, {
    changed: number
    unchanged: number | null
    skipped: number | null
    summary: string
    durationMs: number
    finishedAt: string
  }> = {}
  for (const [kind, r] of Object.entries(receipts)) {
    if (!r) continue
    wireReceipts[kind] = {
      changed: r.changed,
      unchanged: r.unchanged,
      skipped: r.skipped,
      summary: r.summary,
      durationMs: r.durationMs,
      finishedAt: r.finishedAt.toISOString(),
    }
  }

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pipeline — {year}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run each phase in order. Each step is idempotent — safe to re-run.
        </p>
      </div>

      <NextStopsBanner
        year={year}
        pendingStops={pendingStops}
        classified={classified}
        totalTx={totalTx}
      />

      <PipelineClient
        year={year}
        initial={{
          totalTx,
          normalizedTx,
          transferPairs,
          paymentPairs,
          refundPairs,
          merchantRules,
          classified,
          stops,
          residualCandidates,
          needsContextCount,
          pendingStops,
        }}
        receipts={wireReceipts}
      />
    </div>
  )
}
