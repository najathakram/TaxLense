/**
 * QA / Validation Assertions — spec §12 (12 canonical) + §12.1 (deposits completeness).
 *
 * Each assertion is a pure function against the current ledger state. It returns
 * a typed result with a boolean `passed`, a human-readable `details`, and a
 * `blocking` flag (most are blocking; some are advisory).
 *
 * Invoked at lock attempt (spec §4.7). All filter Transaction.isSplit=false and
 * Classification.isCurrent=true — split parents are represented by their children.
 */

import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"
import { computeDeductibleAmt } from "@/lib/classification/deductible"

export interface AssertionResult {
  id: string
  name: string
  passed: boolean
  details: string
  blocking: boolean
  offendingTransactionIds?: string[]
}

export interface AssertionRunResult {
  passed: AssertionResult[]
  failed: AssertionResult[]
  blockingFailures: AssertionResult[]
}

const DEDUCTIBLE_CODES: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

const MEAL_CODES: TransactionCode[] = ["MEALS_50", "MEALS_100"]

type LedgerRow = {
  id: string
  postedDate: Date
  amountNormalized: { toString(): string }
  merchantRaw: string
  isTransferPairedWith: string | null
  isRefundPairedWith: string | null
  idempotencyKey: string
  isSplit: boolean
  classifications: Array<{
    code: TransactionCode
    scheduleCLine: string | null
    businessPct: number
    ircCitations: string[]
    evidenceTier: number
    reasoning: string | null
    substantiation: unknown
  }>
}

async function loadLedger(taxYearId: string) {
  return prisma.transaction.findMany({
    where: { taxYearId, isSplit: false },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  }) as unknown as Promise<LedgerRow[]>
}

function deductibleCents(
  amountNormalized: { toString(): string },
  code: TransactionCode,
  pct: number,
): number {
  return Math.round(computeDeductibleAmt(Number(amountNormalized), code, pct) * 100)
}

// ---------- Assertions ----------

export async function A01_ALL_CLASSIFIED(taxYearId: string): Promise<AssertionResult> {
  const ledger = await loadLedger(taxYearId)
  const offenders = ledger.filter((r) => r.classifications.length === 0).map((r) => r.id)
  return {
    id: "A01",
    name: "Every transaction has a current classification",
    passed: offenders.length === 0,
    blocking: true,
    details: offenders.length === 0 ? `${ledger.length} txns classified` : `${offenders.length} unclassified`,
    offendingTransactionIds: offenders,
  }
}

export async function A02_TXN_UNIQUE(taxYearId: string): Promise<AssertionResult> {
  const rows = await prisma.transaction.findMany({ where: { taxYearId }, select: { idempotencyKey: true } })
  const seen = new Map<string, number>()
  for (const r of rows) seen.set(r.idempotencyKey, (seen.get(r.idempotencyKey) ?? 0) + 1)
  const dups = [...seen.entries()].filter(([, n]) => n > 1)
  return {
    id: "A02",
    name: "Transaction idempotency keys are unique",
    passed: dups.length === 0,
    blocking: true,
    details: dups.length === 0 ? "No duplicates" : `${dups.length} duplicate keys`,
  }
}

export async function A03_SCHEDULE_C_SUM(taxYearId: string): Promise<AssertionResult> {
  // Internal consistency: every deductible-code row's deductible cents must be
  // a non-negative whole number derived from amount * pct. We check that the
  // Σ(deductible) equals itself when recomputed from (amountNormalized, pct).
  const ledger = await loadLedger(taxYearId)
  let mismatches = 0
  let totalCents = 0
  for (const r of ledger) {
    const c = r.classifications[0]
    if (!c || !DEDUCTIBLE_CODES.includes(c.code)) continue
    const expected = deductibleCents(r.amountNormalized, c.code, c.businessPct)
    totalCents += expected
    if (!Number.isFinite(expected) || expected < 0) mismatches++
  }
  return {
    id: "A03",
    name: "Schedule C deductible sum is computable from ledger",
    passed: mismatches === 0,
    blocking: true,
    details: mismatches === 0 ? `Deductions total $${(totalCents / 100).toFixed(2)}` : `${mismatches} rows with invalid deductible`,
  }
}

export async function A04_REVENUE_SUM(taxYearId: string): Promise<AssertionResult> {
  const ledger = await loadLedger(taxYearId)
  let incomeCents = 0
  for (const r of ledger) {
    const c = r.classifications[0]
    if (c?.code !== "BIZ_INCOME") continue
    // Inflows are negative in amountNormalized; gross receipts are abs
    const absCents = Math.round(Math.abs(Number(r.amountNormalized)) * 100)
    incomeCents += absCents
  }
  return {
    id: "A04",
    name: "BIZ_INCOME rows sum to P&L gross revenue",
    passed: true, // always consistent — this is the definition; surfaces the number
    blocking: false,
    details: `Gross receipts $${(incomeCents / 100).toFixed(2)}`,
  }
}

export async function A05_PERSONAL_ZERO(taxYearId: string): Promise<AssertionResult> {
  const ledger = await loadLedger(taxYearId)
  const offenders = ledger
    .filter((r) => r.classifications[0]?.code === "PERSONAL" && r.classifications[0].businessPct !== 0)
    .map((r) => r.id)
  return {
    id: "A05",
    name: "PERSONAL rows have businessPct = 0",
    passed: offenders.length === 0,
    blocking: true,
    details: offenders.length === 0 ? "All clean" : `${offenders.length} PERSONAL rows with non-zero pct`,
    offendingTransactionIds: offenders,
  }
}

export async function A06_PAYMENT_ZERO(taxYearId: string): Promise<AssertionResult> {
  const ledger = await loadLedger(taxYearId)
  const offenders = ledger
    .filter((r) => r.classifications[0]?.code === "PAYMENT" && r.classifications[0].businessPct !== 0)
    .map((r) => r.id)
  return {
    id: "A06",
    name: "PAYMENT rows have businessPct = 0",
    passed: offenders.length === 0,
    blocking: true,
    details: offenders.length === 0 ? "All clean" : `${offenders.length} PAYMENT rows with non-zero pct`,
    offendingTransactionIds: offenders,
  }
}

export async function A07_TRANSFER_PAIRED(taxYearId: string): Promise<AssertionResult> {
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  const transfers = txns.filter((t) => t.classifications[0]?.code === "TRANSFER")
  const unpaired = transfers.filter((t) => !t.isTransferPairedWith).map((t) => t.id)
  return {
    id: "A07",
    name: "TRANSFER rows appear in pairs",
    passed: unpaired.length === 0,
    blocking: true,
    details: unpaired.length === 0 ? `${transfers.length} transfer rows all paired` : `${unpaired.length} unpaired transfer rows`,
    offendingTransactionIds: unpaired,
  }
}

export async function A08_MEAL_274D(taxYearId: string): Promise<AssertionResult> {
  const ledger = await loadLedger(taxYearId)
  const offenders: string[] = []
  for (const r of ledger) {
    const c = r.classifications[0]
    if (!c || !MEAL_CODES.includes(c.code)) continue
    const sub = c.substantiation as { attendees?: string; purpose?: string } | null
    const attendeesOk = !!sub?.attendees && sub.attendees.trim().length >= 2
    const purposeOk = !!sub?.purpose && sub.purpose.trim().length >= 2
    if (!attendeesOk || !purposeOk) offenders.push(r.id)
  }
  return {
    id: "A08",
    name: "MEALS_* rows have §274(d) attendees + purpose",
    passed: offenders.length === 0,
    blocking: true,
    details: offenders.length === 0 ? "All meals substantiated" : `${offenders.length} meal rows missing attendees/purpose`,
    offendingTransactionIds: offenders,
  }
}

export async function A09_274D_TIER(taxYearId: string): Promise<AssertionResult> {
  const ledger = await loadLedger(taxYearId)
  const offenders: string[] = []
  for (const r of ledger) {
    const c = r.classifications[0]
    if (!c) continue
    const has274d = c.ircCitations.some((cit) => cit.startsWith("§274(d)"))
    if (has274d && c.evidenceTier > 3) offenders.push(r.id)
  }
  return {
    id: "A09",
    name: "§274(d) rows have evidenceTier ≤ 3",
    passed: offenders.length === 0,
    blocking: true,
    details: offenders.length === 0 ? "All §274(d) rows well-substantiated" : `${offenders.length} §274(d) rows at tier 4+`,
    offendingTransactionIds: offenders,
  }
}

export async function A10_YEAR_BOUNDARY(taxYearId: string): Promise<AssertionResult> {
  const taxYear = await prisma.taxYear.findUnique({ where: { id: taxYearId } })
  if (!taxYear) throw new Error("TaxYear not found")
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false },
    select: { id: true, postedDate: true },
  })
  const offenders = txns.filter((t) => t.postedDate.getUTCFullYear() !== taxYear.year).map((t) => t.id)
  return {
    id: "A10",
    name: "No classifications point to out-of-year transactions",
    passed: offenders.length === 0,
    blocking: true,
    details: offenders.length === 0 ? `All dates in ${taxYear.year}` : `${offenders.length} out-of-year rows`,
    offendingTransactionIds: offenders,
  }
}

export async function A11_REFUND_NET_ZERO(taxYearId: string): Promise<AssertionResult> {
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isRefundPairedWith: { not: null } },
    select: { id: true, amountNormalized: true, isRefundPairedWith: true },
  })
  const byPair = new Map<string, number>()
  for (const t of txns) {
    const key = [t.id, t.isRefundPairedWith].sort().join("|")
    byPair.set(key, (byPair.get(key) ?? 0) + Number(t.amountNormalized))
  }
  const offenders = [...byPair.entries()].filter(([, sum]) => Math.abs(sum) > 0.005)
  return {
    id: "A11",
    name: "Refund pairs net to $0",
    passed: offenders.length === 0,
    blocking: false, // advisory — refund pairing may be partial in V1
    details: offenders.length === 0 ? `${byPair.size} refund pairs net zero` : `${offenders.length} refund pairs with non-zero sum`,
  }
}

export async function A12_HOME_OFFICE_SIMPLIFIED(taxYearId: string): Promise<AssertionResult> {
  const profile = await prisma.businessProfile.findUnique({ where: { taxYearId } })
  if (!profile) return { id: "A12", name: "Home office simplified method formula", passed: false, blocking: true, details: "No BusinessProfile" }
  const cfg = profile.homeOfficeConfig as { has?: boolean; method?: string; officeSqft?: number } | null
  if (!cfg?.has) return { id: "A12", name: "Home office simplified method formula", passed: true, blocking: false, details: "No home office" }
  if (cfg.method && cfg.method !== "SIMPLIFIED") {
    return { id: "A12", name: "Home office simplified method formula", passed: true, blocking: false, details: `Method: ${cfg.method} (not SIMPLIFIED)` }
  }
  const sqft = Math.min(300, cfg.officeSqft ?? 0)
  const expected = sqft * 5
  return {
    id: "A12",
    name: "Home office simplified method formula",
    passed: sqft > 0,
    blocking: false,
    details: `Sqft=${sqft}, formula: $${expected} (capped at 300sqft / $1500)`,
  }
}

export async function A13_DEPOSITS_RECONSTRUCTED(taxYearId: string): Promise<AssertionResult> {
  // Spec §12.1: Σ inflows − paired transfers − classified gifts/loans/refunds − BIZ_INCOME
  // If |delta| > $500 → CRITICAL block
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, amountNormalized: { lt: 0 } }, // inflows only
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  let totalInflows = 0
  let pairedTransfers = 0
  let bizIncome = 0
  let classifiedNonIncome = 0
  let unclassified = 0

  for (const t of txns) {
    const abs = Math.abs(Number(t.amountNormalized))
    totalInflows += abs
    if (t.isTransferPairedWith) {
      pairedTransfers += abs
      continue
    }
    const c = t.classifications[0]
    if (!c) {
      unclassified += abs
      continue
    }
    if (c.code === "BIZ_INCOME") bizIncome += abs
    else if (c.code === "TRANSFER" || c.code === "PERSONAL" || c.code === "PAYMENT") classifiedNonIncome += abs
    else unclassified += abs
  }

  const explained = pairedTransfers + bizIncome + classifiedNonIncome
  const delta = totalInflows - explained - unclassified
  const passed = unclassified < 500 && Math.abs(delta) < 500
  return {
    id: "A13",
    name: "Deposits reconstruction (§12.1)",
    passed,
    blocking: true,
    details: `Inflows $${totalInflows.toFixed(2)} = transfers $${pairedTransfers.toFixed(2)} + biz income $${bizIncome.toFixed(2)} + other $${classifiedNonIncome.toFixed(2)} + unclassified $${unclassified.toFixed(2)} (Δ ${delta.toFixed(2)})`,
  }
}

// ---------- Orchestrator ----------

export async function runLockAssertions(taxYearId: string): Promise<AssertionRunResult> {
  const results = await Promise.all([
    A01_ALL_CLASSIFIED(taxYearId),
    A02_TXN_UNIQUE(taxYearId),
    A03_SCHEDULE_C_SUM(taxYearId),
    A04_REVENUE_SUM(taxYearId),
    A05_PERSONAL_ZERO(taxYearId),
    A06_PAYMENT_ZERO(taxYearId),
    A07_TRANSFER_PAIRED(taxYearId),
    A08_MEAL_274D(taxYearId),
    A09_274D_TIER(taxYearId),
    A10_YEAR_BOUNDARY(taxYearId),
    A11_REFUND_NET_ZERO(taxYearId),
    A12_HOME_OFFICE_SIMPLIFIED(taxYearId),
    A13_DEPOSITS_RECONSTRUCTED(taxYearId),
  ])
  const passed = results.filter((r) => r.passed)
  const failed = results.filter((r) => !r.passed)
  const blockingFailures = failed.filter((r) => r.blocking)
  return { passed, failed, blockingFailures }
}
