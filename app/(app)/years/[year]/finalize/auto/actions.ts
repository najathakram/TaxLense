"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

async function resolveTaxYearId(year: number) {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, status: true, lockedSnapshotHash: true },
  })
  if (!taxYear) throw new Error("TaxYear not found")
  return taxYear
}

/**
 * Sequential auto-CPA orchestrator. Each stage is run synchronously inside one
 * server action — for Atif scale (~485 txns) the whole thing takes 60–120s
 * end to end (CPA_AUDIT is the longest leg). The action returns once every
 * stage completes; the client polls a heartbeat row to show progress.
 *
 * Stages run in this order:
 *   1. PRE_CLEANUP       — deterministic + Haiku
 *   2. CPA_AUDIT         — Opus 4.7 (or Sonnet fallback)
 *   3. COHAN_SWEEP       — Sonnet/Opus depending on exposure
 *   4. SUBSTANTIATION_QUEUE — Sonnet (template-only, no fabrication)
 *
 * After this completes, the user reviews findings on /years/[year]/findings
 * and clicks Apply. Then re-attempts lock from /years/[year]/lock — which now
 * runs RELOCK_VERIFY automatically and auto-generates position memos on
 * confirm.
 *
 * Idempotent — re-running supersedes prior PROPOSED findings via CPA_AUDIT's
 * supersession logic, and PRE_CLEANUP/COHAN_SWEEP only act on rows that still
 * match their predicates.
 */
export async function runAutoCpaFinalize(year: number): Promise<{
  preCleanup: unknown
  cpaAudit: unknown
  cohanSweep: unknown
  substantiationQueue: unknown
  errors: Array<{ stage: string; message: string }>
}> {
  const taxYear = await resolveTaxYearId(year)
  const errors: Array<{ stage: string; message: string }> = []

  // 1. PRE_CLEANUP
  let preCleanup: unknown = null
  try {
    const { runPreCleanup } = await import("@/lib/cleanup/preClassification")
    preCleanup = await runPreCleanup(taxYear.id)
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    errors.push({ stage: "PRE_CLEANUP", message: m })
    console.error("[runAutoCpaFinalize] PRE_CLEANUP failed:", m)
  }

  // 2. CPA_AUDIT
  let cpaAudit: unknown = null
  try {
    const { runCpaAudit } = await import("@/lib/ai/cpaAudit")
    cpaAudit = await runCpaAudit(taxYear.id)
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    errors.push({ stage: "CPA_AUDIT", message: m })
    console.error("[runAutoCpaFinalize] CPA_AUDIT failed:", m)
  }

  // 3. COHAN_SWEEP
  let cohanSweep: unknown = null
  try {
    const { runCohanSweep } = await import("@/lib/ai/cohanSweep")
    cohanSweep = await runCohanSweep(taxYear.id)
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    errors.push({ stage: "COHAN_SWEEP", message: m })
    console.error("[runAutoCpaFinalize] COHAN_SWEEP failed:", m)
  }

  // 4. SUBSTANTIATION_QUEUE
  let substantiationQueue: unknown = null
  try {
    const { runSubstantiationQueue } = await import("@/lib/ai/substantiationQueue")
    substantiationQueue = await runSubstantiationQueue(taxYear.id)
  } catch (err) {
    const m = err instanceof Error ? err.message : String(err)
    errors.push({ stage: "SUBSTANTIATION_QUEUE", message: m })
    console.error("[runAutoCpaFinalize] SUBSTANTIATION_QUEUE failed:", m)
  }

  revalidatePath(`/years/${year}/findings`)
  revalidatePath(`/years/${year}/stops`)
  revalidatePath(`/years/${year}/risk`)
  revalidatePath(`/years/${year}/finalize`)
  revalidatePath(`/years/${year}/finalize/auto`)

  return { preCleanup, cpaAudit, cohanSweep, substantiationQueue, errors }
}
