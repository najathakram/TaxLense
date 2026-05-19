"use server"

import { after } from "next/server"
import { revalidatePath } from "next/cache"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { normalizeMerchantsForYear, applyMerchantRules } from "@/lib/classification/apply"
import { matchTransfers } from "@/lib/pairing/transfers"
import { matchCardPayments } from "@/lib/pairing/payments"
import { matchRefunds } from "@/lib/pairing/refunds"
import { runMerchantIntelligence } from "@/lib/ai/merchantIntelligence"
import { runCpaAgent } from "@/lib/ai/cpaAgent"
import { reExtractLowConfidence } from "@/lib/parsers/reExtract"
import { selectResidualCandidates } from "@/lib/ai/residualCandidates"
import { runResidualPass } from "@/lib/ai/residualTransaction"
import { runBulkClassifyPass } from "@/lib/ai/bulkClassify"
import { autoResolveStops } from "@/app/(app)/years/[year]/stops/actions"
import { generateAiProposals } from "@/lib/ai/generateProposals"
import { deriveStopsFromAssertions } from "@/lib/stops/deriveFromAssertions"
import { deriveP2pRoundTripStops } from "@/lib/pairing/p2pRoundTrip"
import {
  startPipelineRun,
  executePipelineRun,
  getLatestRunByKind,
} from "@/lib/jobs/pipelineRun"
import { recomputeStatus } from "@/lib/taxYear/status"
import type { Prisma, PipelineRunKind } from "@/app/generated/prisma/client"
import type { PipelineProgress, ProgressReporter } from "@/lib/jobs/pipelineRun"

async function getTaxYear(userId: string, year: number) {
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) throw new Error(`No tax year ${year}`)
  return taxYear
}

/**
 * Stuck-run threshold: any RUNNING PipelineRun whose startedAt is older than
 * this is treated as dead and auto-failed. The CPA agent's largest legit
 * runtime is ~10 minutes (8 chunks × 60s + memo), so 15 min is comfortably
 * beyond the normal envelope while still recovering before the user gives
 * up. Without this detector, a Railway redeploy mid-run leaves the row
 * stuck "RUNNING" forever and de-dup blocks every subsequent click.
 */
const STUCK_RUN_AGE_MS = 15 * 60 * 1000

async function alreadyRunning(taxYearId: string, kind: PipelineRunKind): Promise<string | null> {
  const latest = await getLatestRunByKind(taxYearId, kind)
  if (!latest || latest.status !== "RUNNING") return null
  const age = Date.now() - latest.startedAt.getTime()
  if (age > STUCK_RUN_AGE_MS) {
    // Auto-fail and let the new click proceed. Records the reason in
    // lastError so the user can see *why* the prior run died.
    await prisma.pipelineRun.update({
      where: { id: latest.id },
      data: {
        status: "FAILED",
        lastError: `Stuck — no completion ${Math.round(age / 60000)} min after start (likely killed by deploy or container restart). Auto-failed so a new run can proceed.`,
        finishedAt: new Date(),
      },
    })
    return null
  }
  return latest.id
}

/**
 * Generic background-runner wrapper. Returns the runId so the page can poll
 * its status. The `op` is executed inside an `after()` hook so the calling
 * server action returns within ~100ms regardless of how long the AI work
 * takes.
 */
type RunOp = (
  taxYearId: string,
  setProgress: ProgressReporter,
  runId: string,
) => Promise<unknown>

/**
 * Round-trips through JSON to drop Decimals / Dates / unsupported types from
 * the pipeline-step return values before persisting in PipelineRun.result.
 */
function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null))
}

async function enqueue(
  year: number,
  kind: PipelineRunKind,
  op: RunOp,
): Promise<{ runId: string; reused?: boolean }> {
  const userId = await getCurrentUserId()
  const taxYear = await getTaxYear(userId, year)

  // De-dupe: if a run of the same kind is already RUNNING, return its id
  // instead of starting another one.
  const existing = await alreadyRunning(taxYear.id, kind)
  if (existing) return { runId: existing, reused: true }

  const run = await startPipelineRun({ taxYearId: taxYear.id, kind })
  after(async () => {
    await executePipelineRun(run.id, async (setProgress) => {
      // Adapt the runner's raw-JSON setProgress into a typed ProgressReporter
      // so downstream functions can publish a structured PipelineProgress
      // payload without knowing about Prisma's InputJsonValue.
      const reporter: ProgressReporter = (p: PipelineProgress) =>
        setProgress(p as unknown as Prisma.InputJsonValue)
      const result = await op(taxYear.id, reporter, run.id)
      // Auto-promote the year's status based on what's actually in the DB now
      // (e.g. INGESTION → CLASSIFICATION once the first row is classified;
      // CLASSIFICATION → REVIEW once every row is classified and STOPs == 0).
      await recomputeStatus(taxYear.id)
      // Revalidate after the heavy work is done, so the page shows fresh data.
      revalidatePath(`/years/${year}`)
      revalidatePath(`/years/${year}/pipeline`)
      revalidatePath(`/years/${year}/ledger`)
      revalidatePath(`/years/${year}/stops`)
      return toJson(result)
    })
  })

  return { runId: run.id }
}

export async function runNormalizeMerchants(year: number) {
  return enqueue(year, "NORMALIZE_MERCHANTS", async (taxYearId) => {
    const updated = await normalizeMerchantsForYear(taxYearId)
    return { updated }
  })
}

export async function runMatchTransfers(year: number) {
  return enqueue(year, "MATCH_TRANSFERS", async (taxYearId) => {
    return matchTransfers(taxYearId)
  })
}

export async function runMatchPayments(year: number) {
  return enqueue(year, "MATCH_PAYMENTS", async (taxYearId) => {
    return matchCardPayments(taxYearId)
  })
}

export async function runMatchRefunds(year: number) {
  return enqueue(year, "MATCH_REFUNDS", async (taxYearId) => {
    return matchRefunds(taxYearId)
  })
}

export async function runMerchantAI(year: number) {
  return enqueue(year, "MERCHANT_AI", async (taxYearId, setProgress) => {
    return runMerchantIntelligence(taxYearId, undefined, setProgress)
  })
}

export async function runApplyRules(year: number) {
  return enqueue(year, "APPLY_RULES", async (taxYearId, setProgress) => {
    const result = await applyMerchantRules(taxYearId, { reportProgress: setProgress })
    // After applying rules, materialize STOPs for the conditions that A08 and
    // A13 detect (missing meal substantiation and unclassified deposits) so the
    // dashboard and the STOPs queue stay in agreement.
    const stopsFromAssertions = await deriveStopsFromAssertions(taxYearId)
    // Also detect P2P round-trip counterparties (same person on both sides
    // of the ledger) — see lib/pairing/p2pRoundTrip.ts. Atif's prod ledger
    // had Pocketsflow inflows from Kirsten/Shawna and outflows TO the same
    // people coded as Contract Labor — a logically inconsistent pattern
    // the CPA must resolve.
    const p2p = await deriveP2pRoundTripStops(taxYearId)
    return { ...result, ...stopsFromAssertions, p2pCounterpartyStops: p2p.counterpartyStops }
  })
}

export async function runResidualAI(year: number) {
  return enqueue(year, "RESIDUAL_AI", async (taxYearId, setProgress) => {
    const candidates = await selectResidualCandidates(taxYearId)
    const result = await runResidualPass(taxYearId, candidates, undefined, setProgress)
    return {
      candidates: candidates.length,
      classified: result.classified,
      escalated: result.stops,
    }
  })
}

export async function runBulkClassify(year: number) {
  const userId = await getCurrentUserId()
  return enqueue(year, "BULK_CLASSIFY", async (taxYearId, setProgress) => {
    return runBulkClassifyPass(taxYearId, userId, undefined, setProgress)
  })
}

export async function runAutoResolveStops(year: number) {
  return enqueue(year, "AUTO_RESOLVE_STOPS", async (_taxYearId, setProgress) => {
    return autoResolveStops(year, setProgress)
  })
}

/**
 * Review-first replacement for runAutoResolveStops. Generates an
 * AI proposal per PENDING stop (with prior-case context) and auto-applies
 * anything ≥0.85 confidence. The remaining proposals land in /review for
 * the CPA to approve in bulk.
 */
export async function runGenerateAiProposals(year: number) {
  const userId = await getCurrentUserId()
  return enqueue(year, "GENERATE_AI_PROPOSALS", async (taxYearId, setProgress, runId) => {
    return generateAiProposals(taxYearId, {
      runId,
      actorUserId: userId,
      reportProgress: setProgress,
    })
  })
}

/**
 * Phase A — Sonnet vision re-extraction for low-confidence PDFs. Finds
 * StatementImports with parseConfidence < 0.85 (Haiku-extracted, possibly
 * scanned/noisy), re-runs Sonnet vision over each, and upserts higher-
 * quality transactions via the existing idempotencyKey constraint.
 */
export async function runExtractRePass(year: number) {
  return enqueue(year, "EXTRACT_REPASS", async (taxYearId, setProgress) => {
    return reExtractLowConfidence(taxYearId, { reportProgress: setProgress })
  })
}

/**
 * Phase 1 — Autonomous CPA Agent. Replaces the multi-stage pipeline with one
 * Sonnet-led pass that thinks like a CPA, classifies the whole ledger in
 * chunks, and emits a single audit memo (stored as a Document under the
 * client's account).
 *
 * Use the floating progress panel to watch the run live; on DONE the page
 * reloads and the audit memo appears in /clients/<id>/documents under
 * "Other" (tagged "audit-memo", "cpa-agent").
 */
export async function runCpaAgentAction(year: number) {
  return enqueue(year, "CPA_AGENT", async (taxYearId, setProgress) => {
    const result = await runCpaAgent(taxYearId, { reportProgress: setProgress })
    // After the agent commits its decisions, materialize STOP items for
    // the conditions A08/A13 detect (missing meal substantiation,
    // unclassified inflows). Without this, the user sees "26 unclassified
    // deposits" on the Risk page but "0 deposits" on the STOPs queue —
    // because the agent never emits DEPOSIT-category stops itself.
    let depositStops = 0
    let section274dStops = 0
    let p2pCounterpartyStops = 0
    try {
      const dr = await deriveStopsFromAssertions(taxYearId)
      depositStops = dr.depositStops
      section274dStops = dr.section274dStops
    } catch (err) {
      console.error("[runCpaAgent] deriveStopsFromAssertions failed:", err)
    }
    try {
      const p2p = await deriveP2pRoundTripStops(taxYearId)
      p2pCounterpartyStops = p2p.counterpartyStops
    } catch (err) {
      console.error("[runCpaAgent] deriveP2pRoundTripStops failed:", err)
    }
    return {
      rowsConsidered: result.rowsConsidered,
      rowsClassified: result.rowsClassified,
      rowsLeftAsPersonal: result.rowsLeftAsPersonal,
      memoDocumentId: result.memoDocumentId,
      failedChunks: result.failedChunks,
      archivedStops: result.archivedStops,
      depositStops,
      section274dStops,
      p2pCounterpartyStops,
      summary: result.memo.summary,
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Auto-CPA framework — new stage runners
// ─────────────────────────────────────────────────────────────────────────────

export async function runPreCleanupAction(year: number) {
  return enqueue(year, "PRE_CLEANUP", async (taxYearId, setProgress) => {
    const { runPreCleanup } = await import("@/lib/cleanup/preClassification")
    return runPreCleanup(taxYearId, setProgress)
  })
}

export async function runCpaAuditAction(year: number) {
  return enqueue(year, "CPA_AUDIT", async (taxYearId, setProgress, runId) => {
    const { runCpaAudit } = await import("@/lib/ai/cpaAudit")
    return runCpaAudit(taxYearId, setProgress, { runId })
  })
}

export async function runCohanSweepAction(year: number) {
  return enqueue(year, "COHAN_SWEEP", async (taxYearId, setProgress, runId) => {
    const { runCohanSweep } = await import("@/lib/ai/cohanSweep")
    return runCohanSweep(taxYearId, setProgress, { runId })
  })
}

export async function runSubstantiationQueueAction(year: number) {
  return enqueue(year, "SUBSTANTIATION_QUEUE", async (taxYearId, setProgress, runId) => {
    const { runSubstantiationQueue } = await import("@/lib/ai/substantiationQueue")
    return runSubstantiationQueue(taxYearId, setProgress, { runId })
  })
}

export async function runFindingsApplyAction(year: number) {
  return enqueue(year, "FINDINGS_APPLY", async (taxYearId) => {
    const { applyAcceptedFindings } = await import("@/lib/findings/apply")
    return applyAcceptedFindings(taxYearId)
  })
}

/**
 * Status-polling endpoint exposed as a server action. The pipeline page calls
 * this periodically while a run is RUNNING.
 */
export async function getPipelineRunStatus(runId: string) {
  const run = await prisma.pipelineRun.findUnique({
    where: { id: runId },
    select: {
      id: true,
      status: true,
      progress: true,
      result: true,
      lastError: true,
      kind: true,
      startedAt: true,
      finishedAt: true,
    },
  })
  return run
}
