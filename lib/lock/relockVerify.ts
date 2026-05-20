/**
 * RELOCK_VERIFY — Stage 11 of the auto-CPA pipeline.
 *
 * Runs INSIDE confirmLock when a prior TAXYEAR_LOCKED event exists. Compares
 * the proposed snapshot's per-line Schedule C totals to the prior locked
 * snapshot's totals and surfaces drift. If drift exceeds thresholds, throws
 * DriftApprovalRequiredError; the UI catches this and shows a confirm dialog.
 *
 * 80% deterministic (line-by-line delta is arithmetic) / 20% AI (the narrative
 * cross-check between the unlock rationale and the actual deltas).
 */

import Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"

const DEDUCTIBLE_CODES: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

const SINGLE_LINE_DRIFT_THRESHOLD = 0.15 // 15%
const GROSS_RECEIPTS_DRIFT_THRESHOLD = 0.10 // 10%
const TOTAL_DEDUCTIONS_DRIFT_THRESHOLD = 0.15 // 15%

const MODEL = "claude-sonnet-4-6" as const

export interface RelockDriftReport {
  hasPriorLock: boolean
  perLineDrift: Array<{ line: string; before: number; after: number; deltaPct: number | null; severity: "OK" | "LOW" | "MEDIUM" | "HIGH" }>
  grossReceiptsDriftPct: number | null
  totalDeductionsDriftPct: number | null
  riskBandDrift: { before: string | null; after: string | null }
  unexpectedChanges: string[]
  approvalRequired: boolean
  // The hash of the proposed (about-to-be-written) snapshot — for caller use.
  proposedHash: string | null
  priorHash: string | null
}

export class DriftApprovalRequiredError extends Error {
  report: RelockDriftReport
  constructor(report: RelockDriftReport) {
    super("Relock drift exceeds thresholds — user approval required")
    this.name = "DriftApprovalRequiredError"
    this.report = report
  }
}

/**
 * Compute current per-line totals (used for both pre-flight drift check and
 * to capture into TAXYEAR_LOCKED.afterState on confirm).
 */
export async function computePerLineTotals(taxYearId: string): Promise<{
  perLineTotals: Record<string, number>
  grossReceipts: number
  totalDeductions: number
}> {
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  const perLineTotals: Record<string, number> = {}
  let grossReceipts = 0
  let totalDeductions = 0
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const amt = Number(t.amountNormalized)
    if (c.code === "BIZ_INCOME") grossReceipts += Math.abs(amt)
    if (DEDUCTIBLE_CODES.includes(c.code)) {
      let ded = Math.max(0, amt) * (c.businessPct / 100)
      if (c.code === "MEALS_50") ded *= 0.5
      const line = c.scheduleCLine ?? "(no line)"
      perLineTotals[line] = (perLineTotals[line] ?? 0) + ded
      totalDeductions += ded
    }
  }
  return { perLineTotals, grossReceipts, totalDeductions }
}

/**
 * Run the drift check. Returns the report; does NOT throw. Caller decides
 * whether to gate on approvalRequired.
 */
export async function runRelockVerify(taxYearId: string, options: {
  unlockRationale?: string | null
  anthropicClient?: Anthropic
} = {}): Promise<RelockDriftReport> {
  // Find prior TAXYEAR_LOCKED event for this year
  const taxYear = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { lockedSnapshotHash: true },
  })

  const priorLock = await prisma.auditEvent.findFirst({
    where: {
      entityType: "TaxYear",
      entityId: taxYearId,
      eventType: "TAXYEAR_LOCKED",
    },
    orderBy: { occurredAt: "desc" },
    select: { afterState: true },
  })

  const current = await computePerLineTotals(taxYearId)

  if (!priorLock) {
    return {
      hasPriorLock: false,
      perLineDrift: [],
      grossReceiptsDriftPct: null,
      totalDeductionsDriftPct: null,
      riskBandDrift: { before: null, after: null },
      unexpectedChanges: [],
      approvalRequired: false,
      proposedHash: null,
      priorHash: null,
    }
  }

  const priorState = (priorLock.afterState ?? {}) as {
    hash?: string
    band?: string
    estimatedDeductions?: number
    perLineTotals?: Record<string, number>
    grossReceipts?: number
  }

  const priorPerLine = priorState.perLineTotals ?? {}
  const priorBand = priorState.band ?? null
  const priorGrossReceipts = priorState.grossReceipts ?? 0
  const priorTotalDeductions = priorState.estimatedDeductions ?? 0

  // Per-line drift.
  //
  // Bug fix (Atif 2025 prod): when the prior snapshot's perLineTotals doesn't
  // contain a key (e.g. legacy snapshot pre-auto-CPA-framework, OR a line
  // label that was relabeled in this cycle from "(no line)" to "Part III
  // COGS"), the line shows up as `before=0, after>0`. The old logic flagged
  // that as HIGH severity (Infinity drift) which falsely tripped
  // approvalRequired on every relock with no real per-line baseline.
  //
  // New rule: only flag HIGH-severity drift on lines that EXIST in both
  // snapshots AND moved >15%. Lines that appear in only one snapshot are
  // surfaced as MEDIUM (informational) so the UI/AI narrative can still
  // explain the delta, but they don't trigger approvalRequired by themselves.
  const allLines = new Set([...Object.keys(priorPerLine), ...Object.keys(current.perLineTotals)])
  const perLineDrift: RelockDriftReport["perLineDrift"] = []
  let anyHighDrift = false

  for (const line of Array.from(allLines).sort()) {
    const before = priorPerLine[line] ?? 0
    const after = current.perLineTotals[line] ?? 0
    const presentBefore = Object.prototype.hasOwnProperty.call(priorPerLine, line) && before > 0
    let deltaPct: number | null = null
    if (presentBefore) {
      deltaPct = (after - before) / before
    } else if (after !== 0) {
      deltaPct = null // no baseline (key absent in prior snapshot); can't compute %
    } else {
      deltaPct = 0
    }
    let severity: "OK" | "LOW" | "MEDIUM" | "HIGH" = "OK"
    if (deltaPct == null) {
      // No baseline → informational only. Don't trip approvalRequired.
      severity = "MEDIUM"
    } else {
      const absPct = Math.abs(deltaPct)
      if (absPct >= SINGLE_LINE_DRIFT_THRESHOLD) {
        severity = "HIGH"
        anyHighDrift = true
      } else if (absPct >= 0.05) {
        severity = "MEDIUM"
      } else if (absPct >= 0.01) {
        severity = "LOW"
      }
    }
    perLineDrift.push({ line, before, after, deltaPct, severity })
  }

  const grossReceiptsDriftPct =
    priorGrossReceipts > 0 ? (current.grossReceipts - priorGrossReceipts) / priorGrossReceipts : null
  const totalDeductionsDriftPct =
    priorTotalDeductions > 0
      ? (current.totalDeductions - priorTotalDeductions) / priorTotalDeductions
      : null

  const grossDriftBig = grossReceiptsDriftPct != null && Math.abs(grossReceiptsDriftPct) > GROSS_RECEIPTS_DRIFT_THRESHOLD
  const totalDriftBig = totalDeductionsDriftPct != null && Math.abs(totalDeductionsDriftPct) > TOTAL_DEDUCTIONS_DRIFT_THRESHOLD

  // AI narrative — only when there's drift to explain
  let unexpectedChanges: string[] = []
  if (anyHighDrift || grossDriftBig || totalDriftBig) {
    try {
      const ai = options.anthropicClient ?? new Anthropic()
      const driftSummary = perLineDrift
        .filter((d) => d.severity !== "OK")
        .map(
          (d) =>
            `  ${d.line}: $${d.before.toFixed(2)} → $${d.after.toFixed(2)} (${d.deltaPct == null ? "new" : (d.deltaPct * 100).toFixed(1) + "%"})`
        )
        .join("\n")

      const response = await ai.messages.create({
        model: MODEL,
        max_tokens: 1024,
        temperature: 0,
        system: `You are a CPA reviewing a re-lock drift report. Your job is ONE narrative paragraph
identifying any drift that doesn't match the unlock rationale. Be concise (<150 words).`,
        messages: [
          {
            role: "user",
            content: `Unlock rationale: ${options.unlockRationale ?? "(not provided)"}

Per-line drift (only non-trivial rows shown):
${driftSummary || "  none"}

Gross receipts drift: ${grossReceiptsDriftPct == null ? "n/a" : (grossReceiptsDriftPct * 100).toFixed(1) + "%"}
Total deductions drift: ${totalDeductionsDriftPct == null ? "n/a" : (totalDeductionsDriftPct * 100).toFixed(1) + "%"}

List UNEXPECTED changes (one per line, start with "- "). If everything matches the rationale, return "- All drift consistent with rationale."`,
          },
        ],
      })
      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("\n")
      unexpectedChanges = text
        .split("\n")
        .map((l) => l.replace(/^[-*]\s*/, "").trim())
        .filter((l) => l.length > 0)
    } catch (err) {
      // AI narrative is best-effort; drift report is still valid.
      console.error("[relock_verify] AI narrative failed:", err)
    }
  }

  const approvalRequired = anyHighDrift || grossDriftBig || totalDriftBig

  return {
    hasPriorLock: true,
    perLineDrift,
    grossReceiptsDriftPct,
    totalDeductionsDriftPct,
    riskBandDrift: { before: priorBand, after: null },
    unexpectedChanges,
    approvalRequired,
    proposedHash: null,
    priorHash: priorState.hash ?? null,
  }
}
