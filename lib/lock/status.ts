/**
 * Lock-readiness derivation — shared by Workspace Inbox, Year Overview cards,
 * and the Finalize page so they all agree on whether a TaxYear can be locked.
 *
 * Background (B-fix-inbox): pre-fix the Inbox decided "READY to lock" purely
 * from `StopItem.state='PENDING'` count, while the Risk dashboard correctly
 * checked assertions + critical risk signals. The two disagreed for Atif's
 * 2025 (Inbox said READY, Risk said BLOCKED with 4 blockers), eroding CPA
 * trust. This helper is the single source of truth.
 *
 * Cost: runs `runLockAssertions` (one big ledger read) + `computeRiskScore`
 * (another ledger read) per TaxYear. Callers that iterate over many years
 * should batch via `summarizeLockBlockersBatch`.
 */

import { runLockAssertions } from "@/lib/validation/assertions"
import { computeRiskScore } from "@/lib/risk/score"

export interface LockBlockerSummary {
  taxYearId: string
  /** True if any blocking assertion failed OR any critical+blocking risk signal fired. */
  blocked: boolean
  /** Total count of blocking issues across both sources. */
  blockerCount: number
  /** Human-readable blockers; first 3 are surfaced in card UIs. */
  reasons: string[]
  /** Pending STOP count — informational, doesn't gate lock by itself. */
  pendingStops: number
}

export async function summarizeLockBlockers(
  taxYearId: string,
  pendingStops: number,
): Promise<LockBlockerSummary> {
  const [assertions, risk] = await Promise.all([
    runLockAssertions(taxYearId),
    computeRiskScore(taxYearId),
  ])
  const reasons: string[] = []
  for (const f of assertions.blockingFailures) reasons.push(`[${f.id}] ${f.name}`)
  for (const c of risk.critical) if (c.blocking) reasons.push(`[CRITICAL] ${c.title}`)
  return {
    taxYearId,
    blocked: reasons.length > 0,
    blockerCount: reasons.length,
    reasons,
    pendingStops,
  }
}

/**
 * Batch helper for the Workspace Inbox — runs assertion + risk computation
 * in parallel across N tax years. Each input row pre-supplies its
 * pendingStops count to avoid a separate round-trip.
 */
export async function summarizeLockBlockersBatch(
  inputs: Array<{ taxYearId: string; pendingStops: number }>,
): Promise<Map<string, LockBlockerSummary>> {
  const summaries = await Promise.all(
    inputs.map((i) => summarizeLockBlockers(i.taxYearId, i.pendingStops)),
  )
  const map = new Map<string, LockBlockerSummary>()
  for (const s of summaries) map.set(s.taxYearId, s)
  return map
}
