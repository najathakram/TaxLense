/**
 * Pipeline runner — executes a long-running pipeline operation in a background
 * container while the page-level server action returns within a second.
 *
 * Replaces the 30s server-action ceiling that was hanging the "Apply Rules"
 * button on the pipeline page. The page now subscribes to the PipelineRun row
 * (short polling) and rerenders progress as the runner updates it.
 *
 * Usage from a server action:
 *
 *   const run = await startPipelineRun(taxYearId, "APPLY_RULES")
 *   after(async () => {
 *     await executePipelineRun(run.id)
 *   })
 *   return run.id
 *
 * Each PipelineRunKind maps to one of the existing functions in lib/ai/* or
 * lib/classification/* — the runner just provides progress, error capture,
 * and a single source of truth that survives the request lifecycle.
 */
import type { Prisma, PipelineRunKind } from "@/app/generated/prisma/client"
import { prisma } from "@/lib/db"
import { auth } from "@/auth"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"

/**
 * Shared progress shape that every long-running pipeline operation reports.
 * The pipeline page renders this directly into a floating progress panel.
 *
 * `phase` is a stable machine string ("merchant_ai", "bulk_classify",
 * "residual_ai", "apply_rules", "auto_resolve_stops") so the UI can pick
 * a friendly label and color. `label` is the human-readable detail line
 * shown under the phase title (e.g. "TIM HORTONS · batch 12 of 27").
 */
export interface PipelineProgress {
  phase: string
  processed: number
  total: number
  label?: string
  costUsd?: number
}

/**
 * Optional reporter passed to AI/classification functions so they can call
 * back into the runner with per-step progress. Intentionally permissive in
 * its return shape — sync `void` is fine, async fire-and-forget is fine too.
 */
export type ProgressReporter = (p: PipelineProgress) => Promise<void> | void

export interface StartPipelineRunOptions {
  taxYearId: string
  kind: PipelineRunKind
  /** Initial freeform progress JSON. Optional. */
  progress?: Prisma.InputJsonValue
}

/**
 * Insert a PipelineRun row in `RUNNING` status and return it. Caller is
 * expected to fire `executePipelineRun(run.id)` from inside an `after()`
 * hook so the request can return immediately.
 */
export async function startPipelineRun({ taxYearId, kind, progress }: StartPipelineRunOptions) {
  const session = await auth()
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()

  return prisma.pipelineRun.create({
    data: {
      taxYearId,
      kind,
      status: "RUNNING",
      progress: progress ?? {},
      initiatedByUserId: session?.user?.id ?? null,
      actorCpaUserId: cpaCtx?.cpaId ?? adminCpaCtx?.cpaId ?? null,
      actorAdminUserId: adminCpaCtx?.adminId ?? null,
    },
  })
}

/**
 * Update the progress JSON on a running row. Idempotent. Logs nothing on a
 * disappeared run (caller may have cancelled).
 */
export async function updatePipelineProgress(runId: string, progress: Prisma.InputJsonValue) {
  await prisma.pipelineRun.updateMany({
    where: { id: runId, status: "RUNNING" },
    data: { progress },
  })
}

/**
 * Mark a run as DONE with the final result payload.
 */
export async function completePipelineRun(runId: string, result: Prisma.InputJsonValue) {
  await prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: "DONE", result, finishedAt: new Date() },
  })
}

/**
 * Mark a run as FAILED with the captured error string.
 */
export async function failPipelineRun(runId: string, lastError: string) {
  await prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: "FAILED", lastError, finishedAt: new Date() },
  })
}

/**
 * Wraps a synchronous async operation, recording status transitions to
 * the PipelineRun row. The `op` receives a `setProgress` helper.
 */
export async function executePipelineRun(
  runId: string,
  op: (setProgress: (p: Prisma.InputJsonValue) => Promise<void>) => Promise<Prisma.InputJsonValue>,
): Promise<void> {
  const setProgress = (p: Prisma.InputJsonValue) => updatePipelineProgress(runId, p)
  try {
    const result = await op(setProgress)
    await completePipelineRun(runId, result)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await failPipelineRun(runId, msg)
  }
}

/**
 * Returns the most recent run for a given TaxYear, or null.
 */
export async function getLatestRunForTaxYear(taxYearId: string) {
  return prisma.pipelineRun.findFirst({
    where: { taxYearId },
    orderBy: { startedAt: "desc" },
  })
}

/**
 * Returns the most recent run by kind (used by the "Apply Rules" button to
 * detect a still-running operation and skip enqueueing a duplicate).
 */
export async function getLatestRunByKind(taxYearId: string, kind: PipelineRunKind) {
  return prisma.pipelineRun.findFirst({
    where: { taxYearId, kind },
    orderBy: { startedAt: "desc" },
  })
}
