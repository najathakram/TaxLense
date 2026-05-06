/**
 * Audit Risk Score — spec §11.2.
 *
 * Deterministic scoring. No AI. Signals are transparent to the user.
 * Bands: ≤20 LOW, 21–40 MODERATE, 41–70 HIGH, >70 CRITICAL.
 *
 * Tax impact is a ballpark at 25% — clearly flagged as informational.
 */

import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"
import {
  DEDUCTIBLE_CODES as SHARED_DEDUCTIBLE_CODES,
  computeDeductibleAmt,
} from "@/lib/classification/deductible"
import { inYearWindow } from "@/lib/queries/yearWindow"

export type RiskSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"

export interface RiskSignal {
  id: string
  severity: RiskSeverity
  points: number
  title: string
  details: string
  blocking: boolean
  transactionIds?: string[]
}

export interface RiskReport {
  score: number
  band: "LOW" | "MODERATE" | "HIGH" | "CRITICAL"
  /** Number of blocking signals — surfaced separately from `score` so the UI
   *  can show "BLOCKED" prominently regardless of point total. */
  lockBlocked: boolean
  blockerCount: number
  critical: RiskSignal[]
  high: RiskSignal[]
  medium: RiskSignal[]
  low: RiskSignal[]
  estimatedDeductions: number
  estimatedTaxImpact: number
  estimatedTaxImpactNote: string
}

const DEDUCTIBLE_CODES = SHARED_DEDUCTIBLE_CODES as readonly TransactionCode[]

function band(score: number): RiskReport["band"] {
  if (score > 70) return "CRITICAL"
  if (score >= 41) return "HIGH"
  if (score >= 21) return "MODERATE"
  return "LOW"
}

export async function computeRiskScore(taxYearId: string): Promise<RiskReport> {
  const ty = await prisma.taxYear.findUnique({ where: { id: taxYearId }, select: { year: true, userId: true } })
  const yearWindow = ty ? inYearWindow(ty.year) : {}
  const [ledger, profile, pendingStops, lossHistory] = await Promise.all([
    prisma.transaction.findMany({
      where: { taxYearId, isSplit: false, ...yearWindow },
      include: { classifications: { where: { isCurrent: true }, take: 1 } },
    }),
    prisma.businessProfile.findUnique({ where: { taxYearId } }),
    prisma.stopItem.count({ where: { taxYearId, state: "PENDING" } }),
    prisma.taxYear.findMany({
      where: { userId: ty?.userId },
      orderBy: { year: "desc" },
      take: 3,
    }),
  ])

  const signals: RiskSignal[] = []

  // --- Compute totals ---
  let grossReceiptsCents = 0
  let totalDeductibleCents = 0
  let mealDeductibleCents = 0
  let otherLineCents = 0 // Line 27a "Other"
  let tier4_274d_rows: string[] = []
  let roundNumberRows: string[] = []
  let needsContextIds: string[] = []
  let mealRowsMissingSub: string[] = []

  for (const r of ledger) {
    const c = r.classifications[0]
    const amt = Number(r.amountNormalized)
    if (!c) continue
    if (c.code === "BIZ_INCOME") {
      grossReceiptsCents += Math.round(Math.abs(amt) * 100)
    }
    if (DEDUCTIBLE_CODES.includes(c.code)) {
      const dedCents = Math.round(computeDeductibleAmt(amt, c.code, c.businessPct) * 100)
      totalDeductibleCents += dedCents
      if (c.code === "MEALS_50" || c.code === "MEALS_100") mealDeductibleCents += dedCents
      if (c.scheduleCLine === "Line 27a Other Expenses") otherLineCents += dedCents
      // round-number: exact $100/$500/$1000/$2500/$5000 multiples
      const dollars = Math.round(Math.abs(amt))
      if (dedCents > 0 && [500, 1000, 2500, 5000].includes(dollars) && Math.abs(amt) === dollars) {
        roundNumberRows.push(r.id)
      }
      const has274d = c.ircCitations.some((cit) => cit.startsWith("§274(d)"))
      if (has274d && c.evidenceTier >= 4) tier4_274d_rows.push(r.id)
    }
    if (c.code === "NEEDS_CONTEXT") needsContextIds.push(r.id)
    if (c.code === "MEALS_50" || c.code === "MEALS_100") {
      const sub = c.substantiation as { attendees?: string; purpose?: string } | null
      if (!sub?.attendees || !sub?.purpose) mealRowsMissingSub.push(r.id)
    }
  }

  // --- Signal: meal ratio > 5% of gross ---
  if (grossReceiptsCents > 0) {
    const ratio = mealDeductibleCents / grossReceiptsCents
    if (ratio > 0.05) {
      signals.push({
        id: "MEAL_RATIO",
        severity: "HIGH",
        points: 15,
        title: "Meal deductions exceed 5% of gross receipts",
        details: `Meals ${(ratio * 100).toFixed(1)}% of gross (industry norm ~3%)`,
        blocking: false,
      })
    }
  }

  // --- Signal: vehicle business pct ---
  const vehicle = (profile?.vehicleConfig as { has?: boolean; bizPct?: number } | null) ?? null
  if (vehicle?.has) {
    if (vehicle.bizPct === 100) {
      signals.push({
        id: "VEHICLE_100",
        severity: "HIGH",
        points: 20,
        title: "Vehicle claimed at 100% business",
        details: "Statistically implausible for most self-employed taxpayers",
        blocking: false,
      })
    } else if ((vehicle.bizPct ?? 0) > 75) {
      signals.push({
        id: "VEHICLE_75",
        severity: "HIGH",
        points: 10,
        title: `Vehicle claimed at ${vehicle.bizPct}% business`,
        details: ">75% triggers agent scrutiny",
        blocking: false,
      })
    }
  }

  // --- Signal: Schedule C loss year (N² points) ---
  // Simple approximation: count of recent tax years (including this one) where deductions > income
  let lossYearN = 0
  for (const ty of lossHistory) {
    const txns = await prisma.transaction.findMany({
      where: { taxYearId: ty.id, isSplit: false, ...inYearWindow(ty.year) },
      include: { classifications: { where: { isCurrent: true }, take: 1 } },
    })
    let inc = 0
    let ded = 0
    for (const r of txns) {
      const c = r.classifications[0]
      if (!c) continue
      if (c.code === "BIZ_INCOME") inc += Math.abs(Number(r.amountNormalized))
      if (DEDUCTIBLE_CODES.includes(c.code)) {
        ded += computeDeductibleAmt(Number(r.amountNormalized), c.code, c.businessPct)
      }
    }
    if (ded > inc) lossYearN++
    else break
  }
  if (lossYearN > 0) {
    const pts = lossYearN * lossYearN
    signals.push({
      id: "LOSS_YEAR",
      severity: lossYearN >= 2 ? "HIGH" : "MEDIUM",
      points: pts,
      title: `Schedule C loss — year ${lossYearN}`,
      details: lossYearN >= 3 ? "§183 hobby-loss watch active; position memo recommended" : "§183 watch",
      blocking: false,
    })
  }

  // --- Signal: round-number deductions > 3 ---
  if (roundNumberRows.length > 3) {
    signals.push({
      id: "ROUND_NUMBERS",
      severity: "MEDIUM",
      points: roundNumberRows.length * 5,
      title: `${roundNumberRows.length} round-number deductions`,
      details: "Verify these are actual charges, not estimates",
      blocking: false,
      transactionIds: roundNumberRows,
    })
  }

  // --- Signal: Line 27a "Other" > 10% of total expenses ---
  if (totalDeductibleCents > 0) {
    const otherRatio = otherLineCents / totalDeductibleCents
    if (otherRatio > 0.1) {
      signals.push({
        id: "LINE_27A_HIGH",
        severity: "MEDIUM",
        points: 10,
        title: `Line 27a "Other" is ${(otherRatio * 100).toFixed(1)}% of expenses`,
        details: "High Line 27a usage invites agent follow-up; reclassify where possible",
        blocking: false,
      })
    }
  }

  // --- Signal: Tier-4 §274(d) rows (shouldn't exist at lock) ---
  if (tier4_274d_rows.length > 0) {
    signals.push({
      id: "TIER4_274D",
      severity: "CRITICAL",
      points: tier4_274d_rows.length * 3,
      title: `${tier4_274d_rows.length} §274(d) rows at weak evidence (Tier 4+)`,
      details: "§274(d) categories cannot rely on Cohan — substantiate or demote",
      blocking: true,
      transactionIds: tier4_274d_rows,
    })
  }

  // --- Signal: gross receipts short vs. expected platforms ---
  const incomeSources = (profile?.incomeSources as Array<{ platform: string; expectedTotal?: number }> | null) ?? []
  const expectedIncome = incomeSources.reduce((sum, s) => sum + (Number(s.expectedTotal) || 0), 0)
  if (expectedIncome > 0 && grossReceiptsCents / 100 < expectedIncome) {
    const shortfall = expectedIncome - grossReceiptsCents / 100
    signals.push({
      id: "INCOME_SHORT",
      severity: shortfall > 1000 ? "CRITICAL" : "HIGH",
      points: 25,
      title: `Gross receipts below expected by $${shortfall.toFixed(2)}`,
      details: "Missing 1099-K-able platform income suspected",
      blocking: shortfall > 1000,
    })
  }

  // --- Signal: unclassified deposits (CRITICAL block) ---
  const unclassifiedDeposits = ledger.filter((r) => {
    const amt = Number(r.amountNormalized)
    const c = r.classifications[0]
    return amt < 0 && (!c || c.code === "NEEDS_CONTEXT")
  })
  if (unclassifiedDeposits.length > 0) {
    const total = unclassifiedDeposits.reduce((s, r) => s + Math.abs(Number(r.amountNormalized)), 0)
    signals.push({
      id: "UNCLASSIFIED_DEPOSITS",
      severity: "CRITICAL",
      points: 0,
      title: `${unclassifiedDeposits.length} unclassified deposits ($${total.toFixed(2)})`,
      details: "Resolve via STOPs before lock",
      blocking: true,
      transactionIds: unclassifiedDeposits.map((r) => r.id),
    })
  }

  // --- Signal: §274(d) substantiation missing ---
  if (mealRowsMissingSub.length > 0) {
    signals.push({
      id: "MEAL_SUB_MISSING",
      severity: "CRITICAL",
      points: 0,
      title: `${mealRowsMissingSub.length} meal rows missing attendees/purpose`,
      details: "§274(d) substantiation required before lock",
      blocking: true,
      transactionIds: mealRowsMissingSub,
    })
  }

  // --- Signal: NEEDS_CONTEXT remaining ---
  if (needsContextIds.length > 0) {
    signals.push({
      id: "NEEDS_CONTEXT",
      severity: "CRITICAL",
      points: 0,
      title: `${needsContextIds.length} transactions need context`,
      details: "Resolve via STOPs or ledger edits before lock",
      blocking: true,
      transactionIds: needsContextIds,
    })
  }

  // --- Signal: pending stops ---
  if (pendingStops > 0) {
    signals.push({
      id: "PENDING_STOPS",
      severity: "CRITICAL",
      points: 0,
      title: `${pendingStops} pending STOP items`,
      details: "Answer or defer each STOP before lock",
      blocking: true,
    })
  }

  // --- Low / informational signals ---
  const tier4Count = ledger.filter((r) => {
    const c = r.classifications[0]
    return c && c.evidenceTier === 4 && DEDUCTIBLE_CODES.includes(c.code)
  }).length
  if (tier4Count > 0) {
    signals.push({
      id: "TIER4_COHAN",
      severity: "MEDIUM",
      points: 0,
      title: `${tier4Count} Tier-4 Cohan estimates`,
      details: "Acceptable for §162 but flagged; receipts strengthen these",
      blocking: false,
    })
  }

  // --- Roll up ---
  // Pre-blocker score: just the sum of scoring signals.
  const preBlockerScore = signals.reduce((s, sig) => s + sig.points, 0)
  const blockerCount = signals.filter((s) => s.blocking).length
  const lockBlocked = blockerCount > 0

  // Floor the displayed score at MODERATE (21) when ANY blocker is present.
  // Without this, a return with $35K of unclassified deposits + 51 wrong-year
  // rows can read "1/100 LOW" — the score would lie about audit readiness.
  // We surface the floor as a synthetic signal so the user can see why.
  if (lockBlocked && preBlockerScore < 21) {
    signals.push({
      id: "LOCK_BLOCKED_FLOOR",
      severity: "CRITICAL",
      points: 21 - preBlockerScore,
      title: `Lock blocked by ${blockerCount} issue${blockerCount === 1 ? "" : "s"}`,
      details:
        "Risk score floored at MODERATE until blockers resolve — the underlying signals are listed above; this entry only exists to bring the displayed score in line with reality.",
      blocking: false,
    })
  }

  const score = signals.reduce((s, sig) => s + sig.points, 0)
  const critical = signals.filter((s) => s.severity === "CRITICAL")
  const high = signals.filter((s) => s.severity === "HIGH")
  const medium = signals.filter((s) => s.severity === "MEDIUM")
  const low = signals.filter((s) => s.severity === "LOW")

  const estimatedDeductions = totalDeductibleCents / 100
  const estimatedTaxImpact = estimatedDeductions * 0.25

  return {
    score,
    band: band(score),
    lockBlocked,
    blockerCount,
    critical,
    high,
    medium,
    low,
    estimatedDeductions,
    estimatedTaxImpact,
    estimatedTaxImpactNote:
      "Informational estimate at 25% combined federal + SE + state. Actual impact depends on bracket, QBI, SE tax, and state — consult your CPA.",
  }
}
