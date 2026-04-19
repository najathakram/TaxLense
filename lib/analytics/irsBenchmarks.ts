/**
 * IRS Schedule C expense-ratio benchmarks (Session 9 §B).
 *
 * Values are expense-line ÷ gross-receipts percentages, aggregated from IRS
 * SOI Table 1A "Nonfarm Sole Proprietorship Returns" (most recent published
 * tax-year data). Selected by 2-digit NAICS prefix. These are *informational
 * reference points only* and are NOT the basis for any classification.
 *
 * Deduction-mix chart compares the client's % of total deductions on each
 * Schedule C line against the industry median for the same line.
 */

export interface IrsBenchmark {
  label: string
  scheduleCLine: string
  /** Share of total deductions (0–1) — used for the deduction-mix chart. */
  deductionShare: number
}

interface BenchmarkSet {
  naicsPrefix: string
  description: string
  benchmarks: IrsBenchmark[]
}

// Ratios are approximations for V1 reference. Swap with IRS-published SOI data
// when TaxYear's rule library is re-pinned.
const BENCHMARK_SETS: BenchmarkSet[] = [
  {
    naicsPrefix: "54",
    description: "Professional, scientific & technical services",
    benchmarks: [
      { label: "Car & Truck",       scheduleCLine: "Line 9 Car & Truck",         deductionShare: 0.11 },
      { label: "Contract Labor",    scheduleCLine: "Line 11 Contract Labor",     deductionShare: 0.12 },
      { label: "Supplies",          scheduleCLine: "Line 22 Supplies",           deductionShare: 0.08 },
      { label: "Travel",            scheduleCLine: "Line 24a Travel",            deductionShare: 0.05 },
      { label: "Meals",             scheduleCLine: "Line 24b Meals",             deductionShare: 0.02 },
      { label: "Office Expense",    scheduleCLine: "Line 18 Office Expense",     deductionShare: 0.07 },
      { label: "Utilities",         scheduleCLine: "Line 25 Utilities",          deductionShare: 0.04 },
      { label: "Home Office",       scheduleCLine: "Line 30 Home Office",        deductionShare: 0.06 },
      { label: "Other",             scheduleCLine: "Line 27a Other Expenses",    deductionShare: 0.15 },
    ],
  },
  {
    naicsPrefix: "71",
    description: "Arts, entertainment & recreation (incl. independent artists)",
    benchmarks: [
      { label: "Car & Truck",       scheduleCLine: "Line 9 Car & Truck",         deductionShare: 0.08 },
      { label: "Contract Labor",    scheduleCLine: "Line 11 Contract Labor",     deductionShare: 0.15 },
      { label: "Supplies",          scheduleCLine: "Line 22 Supplies",           deductionShare: 0.10 },
      { label: "Travel",            scheduleCLine: "Line 24a Travel",            deductionShare: 0.10 },
      { label: "Meals",             scheduleCLine: "Line 24b Meals",             deductionShare: 0.03 },
      { label: "Office Expense",    scheduleCLine: "Line 18 Office Expense",     deductionShare: 0.06 },
      { label: "Advertising",       scheduleCLine: "Line 8 Advertising",         deductionShare: 0.07 },
      { label: "Home Office",       scheduleCLine: "Line 30 Home Office",        deductionShare: 0.05 },
      { label: "Other",             scheduleCLine: "Line 27a Other Expenses",    deductionShare: 0.20 },
    ],
  },
  {
    naicsPrefix: "48",
    description: "Transportation & warehousing",
    benchmarks: [
      { label: "Car & Truck",       scheduleCLine: "Line 9 Car & Truck",         deductionShare: 0.40 },
      { label: "Repairs",           scheduleCLine: "Line 21 Repairs & Maintenance", deductionShare: 0.08 },
      { label: "Supplies",          scheduleCLine: "Line 22 Supplies",           deductionShare: 0.05 },
      { label: "Travel",            scheduleCLine: "Line 24a Travel",            deductionShare: 0.04 },
      { label: "Meals",             scheduleCLine: "Line 24b Meals",             deductionShare: 0.03 },
      { label: "Insurance",         scheduleCLine: "Line 15 Insurance",          deductionShare: 0.07 },
      { label: "Other",             scheduleCLine: "Line 27a Other Expenses",    deductionShare: 0.12 },
    ],
  },
]

const DEFAULT_BENCHMARKS: IrsBenchmark[] = [
  { label: "Car & Truck",       scheduleCLine: "Line 9 Car & Truck",         deductionShare: 0.10 },
  { label: "Contract Labor",    scheduleCLine: "Line 11 Contract Labor",     deductionShare: 0.10 },
  { label: "Supplies",          scheduleCLine: "Line 22 Supplies",           deductionShare: 0.08 },
  { label: "Travel",            scheduleCLine: "Line 24a Travel",            deductionShare: 0.05 },
  { label: "Meals",             scheduleCLine: "Line 24b Meals",             deductionShare: 0.02 },
  { label: "Office Expense",    scheduleCLine: "Line 18 Office Expense",     deductionShare: 0.06 },
  { label: "Utilities",         scheduleCLine: "Line 25 Utilities",          deductionShare: 0.04 },
  { label: "Home Office",       scheduleCLine: "Line 30 Home Office",        deductionShare: 0.05 },
  { label: "Other",             scheduleCLine: "Line 27a Other Expenses",    deductionShare: 0.15 },
]

export function benchmarksForNaics(naicsCode: string | null | undefined): IrsBenchmark[] {
  if (!naicsCode) return DEFAULT_BENCHMARKS
  const prefix = naicsCode.slice(0, 2)
  const set = BENCHMARK_SETS.find((s) => s.naicsPrefix === prefix)
  return set?.benchmarks ?? DEFAULT_BENCHMARKS
}

/** Red-flag thresholds the dashboard renders as inline warnings. */
export const RED_FLAG_THRESHOLDS = {
  mealsRatioOfReceipts: 0.05,   // >5% of gross receipts = red flag (IRS DIF)
  vehicleBizPct: 0.90,          // >90% business use triggers scrutiny
  otherExpensesRatio: 0.10,     // Line 27a >10% of total deductions = flag
  lossYearCount: 3,             // 3 loss years in 5 = §183 hobby-loss risk
} as const
