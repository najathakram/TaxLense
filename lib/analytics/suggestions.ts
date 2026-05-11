/**
 * Analytics 'what to do' suggestions — for each industry-comparison outlier
 * surfaced on /years/[year]/analytics, generate a concrete CPA-actionable
 * recommendation (not just "this is high vs median").
 *
 * Pure function: takes the benchmark deltas + ledger summary; returns a
 * sorted list of suggestions with severity, deep-link target, and the §
 * citation tying the suggestion to law.
 */

import { benchmarksForNaics, RED_FLAG_THRESHOLDS, type IrsBenchmark } from "./irsBenchmarks"

export interface SuggestionInput {
  year: number
  naicsCode: string | null
  grossReceipts: number
  totalDeductions: number
  /** Per-line totals from the ledger (Schedule C / 1120-S / etc. line strings). */
  lineTotals: Map<string, number>
  /** Per-classification-code aggregate (e.g. MEALS_50 + MEALS_100). */
  mealsTotal: number
  /** Vehicle business-use percentage (0-100). 0 if no vehicle config. */
  vehicleBizPct: number
}

export interface AnalyticsSuggestion {
  id: string
  severity: "INFO" | "WARN" | "CRITICAL"
  title: string
  message: string
  /** What to click — typically a /ledger filter or /stops deep-link. */
  href?: (year: number) => string
  hrefLabel?: string
  authority: string
}

export function buildAnalyticsSuggestions(input: SuggestionInput): AnalyticsSuggestion[] {
  const out: AnalyticsSuggestion[] = []
  const benchmarks = benchmarksForNaics(input.naicsCode)
  const totalDed = input.totalDeductions

  // Per-line industry comparison
  for (const b of benchmarks) {
    const actual = input.lineTotals.get(b.scheduleCLine) ?? 0
    if (actual === 0) continue
    const actualShare = totalDed > 0 ? actual / totalDed : 0
    const deltaPct = (actualShare - b.deductionShare) / b.deductionShare
    if (deltaPct > 1.5) {
      // > 2.5x industry median
      out.push(buildBenchmarkSuggestion(b, actual, actualShare, "CRITICAL"))
    } else if (deltaPct > 0.7) {
      out.push(buildBenchmarkSuggestion(b, actual, actualShare, "WARN"))
    }
  }

  // Meals ratio (IRS DIF score driver)
  if (input.grossReceipts > 0) {
    const mealsRatio = input.mealsTotal / input.grossReceipts
    if (mealsRatio > RED_FLAG_THRESHOLDS.mealsRatioOfReceipts) {
      out.push({
        id: "meals-ratio-high",
        severity: "WARN",
        title: `Meals at ${(mealsRatio * 100).toFixed(1)}% of receipts (industry median ~2%)`,
        message:
          `Meals deductions over 5% of gross receipts is a top IRS DIF-score trigger. Review the meals roster and confirm each has §274(d) substantiation (attendees, business purpose, location). Consider reclassifying client-meeting meals to MEALS_100 if they qualify for the §274(n)(2) restaurant-meal full deduction.`,
        href: (y) => `/years/${y}/ledger?code=MEALS_50,MEALS_100`,
        hrefLabel: "Review meals →",
        authority: "IRC §274(n); Reg §1.274-12; IRS DIF discriminant function",
      })
    }
  }

  // Vehicle high biz pct
  if (input.vehicleBizPct >= RED_FLAG_THRESHOLDS.vehicleBizPct * 100) {
    out.push({
      id: "vehicle-biz-pct-high",
      severity: "WARN",
      title: `Vehicle business use ${input.vehicleBizPct}%`,
      message:
        `Vehicle business-use percentage above 90% is a frequent audit trigger — the IRS expects most owners to have at least some personal use (commute, errands). Confirm the contemporaneous mileage log under §274(d) supports this claim. Consider lowering to 75-85% if the log doesn't support 90%+.`,
      href: (y) => `/years/${y}/ledger?code=WRITE_OFF_TRAVEL`,
      hrefLabel: "Review vehicle classifications →",
      authority: "IRC §274(d); §280F; Cohan v. Commissioner",
    })
  }

  // Line 27a "Other Expenses" excessive
  const line27a =
    (input.lineTotals.get("Line 27a Other Expenses") ?? 0) +
    (input.lineTotals.get("19 Other deductions") ?? 0) +
    (input.lineTotals.get("20 Other deductions") ?? 0) +
    (input.lineTotals.get("26 Other deductions") ?? 0)
  if (totalDed > 0 && line27a / totalDed > RED_FLAG_THRESHOLDS.otherExpensesRatio) {
    out.push({
      id: "line-27a-excessive",
      severity: "WARN",
      title: `'Other Expenses' is ${((line27a / totalDed) * 100).toFixed(1)}% of total deductions`,
      message:
        `When Line 27a (Other Expenses) exceeds 10% of total deductions, the IRS asks "what's in there?" The agent will request itemization. Re-bucket as much as possible to specific Schedule C lines (Line 8 Advertising, Line 18 Office Expense, etc.) before lock.`,
      href: (y) => `/years/${y}/ledger`,
      hrefLabel: "Open ledger →",
      authority: "IRS Schedule C Instructions Rev. 2025; Form 1120-S Line 19 instructions",
    })
  }

  // Loss vs receipts (§183 territory)
  if (input.grossReceipts > 0 && totalDed > input.grossReceipts) {
    const lossRatio = (totalDed - input.grossReceipts) / Math.max(input.grossReceipts, 1)
    if (lossRatio > 0.5) {
      out.push({
        id: "hobby-loss-territory",
        severity: "CRITICAL",
        title: `Net loss is ${(lossRatio * 100).toFixed(0)}% of gross receipts`,
        message:
          `Losses substantially larger than receipts trigger §183 (hobby loss) scrutiny. The IRS presumes a profit motive only if you've shown profit in 3 of 5 years (2 of 7 for horse activities). Generate the §183 position memo to defend the profit motive — the audit packet will include it automatically at lock.`,
        href: (y) => `/years/${y}/memos/§183_hobby`,
        hrefLabel: "Open §183 memo →",
        authority: "IRC §183; Reg §1.183-2 (nine-factor profit-motive test)",
      })
    }
  }

  return out.sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
}

function buildBenchmarkSuggestion(
  b: IrsBenchmark,
  actual: number,
  actualShare: number,
  severity: AnalyticsSuggestion["severity"],
): AnalyticsSuggestion {
  return {
    id: `benchmark-${b.scheduleCLine.toLowerCase().replace(/\s+/g, "-")}`,
    severity,
    title: `${b.label}: ${(actualShare * 100).toFixed(1)}% of deductions vs industry median ${(b.deductionShare * 100).toFixed(1)}%`,
    message: `${b.label} (${b.scheduleCLine}) at $${actual.toLocaleString("en-US", { maximumFractionDigits: 0 })} is materially above the IRS Statistics-of-Income median for this NAICS prefix. Review the underlying classifications to confirm each is properly substantiated; consider whether some belong on a different line.`,
    href: (y) => `/years/${y}/ledger?line=${encodeURIComponent(b.scheduleCLine)}`,
    hrefLabel: `Review ${b.label} →`,
    authority: "IRS Statistics of Income (SOI) tax-return summaries",
  }
}

function severityRank(s: AnalyticsSuggestion["severity"]): number {
  return s === "CRITICAL" ? 3 : s === "WARN" ? 2 : 1
}
