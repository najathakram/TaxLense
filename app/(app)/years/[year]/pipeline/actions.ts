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
import { selectResidualCandidates } from "@/lib/ai/residualCandidates"
import { runResidualPass } from "@/lib/ai/residualTransaction"
import { runBulkClassifyPass } from "@/lib/ai/bulkClassify"
import { autoResolveStops } from "@/app/(app)/years/[year]/stops/actions"
import { deriveStopsFromAssertions } from "@/lib/stops/deriveFromAssertions"
import {
  startPipelineRun,
  executePipelineRun,
  getLatestRunByKind,
} from "@/lib/jobs/pipelineRun"
import type { Prisma, PipelineRunKind } from "@/app/generated/prisma/client"
import type { PipelineProgress, ProgressReporter } from "@/lib/jobs/pipelineRun"

async function getTaxYear(userId: string, year: number) {
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) throw new Error(`No tax year ${year}`)
  return taxYear
}

async function alreadyRunning(taxYearId: string, kind: PipelineRunKind): Promise<string | null> {
  const latest = await getLatestRunByKind(taxYearId, kind)
  return latest && latest.status === "RUNNING" ? latest.id : null
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
      const result = await op(taxYear.id, reporter)
      // Revalidate after the heavy work is done, so the page shows fresh data.
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
    return { ...result, ...stopsFromAssertions }
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
