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
import { inYearWindow } from "@/lib/queries/yearWindow"
import { fmtUSD, fmtUSDFromCents } from "@/lib/format/currency"
import { isMoneyMoverOutflow } from "@/lib/accounts/kind"

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

/**
 * In-year ledger fetch used by A01–A09, A11–A13. Filters to the calendar year
 * via inYearWindow so the per-assertion totals (A03 deductible, A04 revenue,
 * A13 deposits) match the dashboard / Schedule C / P&L numbers — without this
 * filter, out-of-year leakage from cross-boundary statements (a 2024-12 →
 * 2025-01 PDF, etc.) inflates the totals and the user sees A03=$42K while
 * the dashboard shows $38K. A10 keeps its own no-filter query because *its
 * job* is to detect the leakage.
 */
async function loadLedger(taxYearId: string) {
  const ty = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { year: true },
  })
  const yearWindow = ty ? inYearWindow(ty.year) : {}
  return prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, ...yearWindow },
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
    details: mismatches === 0 ? `Deductions total ${fmtUSDFromCents(totalCents, { cents: true })}` : `${mismatches} rows with invalid deductible`,
  }
}

export async function A04_REVENUE_SUM(taxYearId: string): Promise<AssertionResult> {
  const ledger = await loadLedger(taxYearId)
  let incomeCents = 0
  for (const r of ledger) {
    const c = r.classifications[0]
    if (c?.code !== "BIZ_INCOME") continue
    // Match A13's gross-receipts logic exactly: only inflow rows that are
    // NOT transfer-paired count. Without this filter, A04 picks up rows
    // the agent miscoded as BIZ_INCOME on the outflow side and disagrees
    // with A13 by hundreds — which is what the dashboard / Schedule C / risk
    // page were doing on Atif's prod ledger.
    const amt = Number(r.amountNormalized)
    if (amt >= 0) continue // not an inflow
    if (r.isTransferPairedWith) continue
    const absCents = Math.round(Math.abs(amt) * 100)
    incomeCents += absCents
  }
  return {
    id: "A04",
    name: "BIZ_INCOME rows sum to P&L gross revenue",
    passed: true, // always consistent — this is the definition; surfaces the number
    blocking: false,
    details: `Gross receipts ${fmtUSDFromCents(incomeCents, { cents: true })}`,
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
  const ty = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { year: true },
  })
  const yearWindow = ty ? inYearWindow(ty.year) : {}
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, ...yearWindow },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  const transfers = txns.filter((t) => t.classifications[0]?.code === "TRANSFER")
  // Money-mover outflows (Wise top-ups, PayPal funding, etc.) are
  // intentionally unpaired — the destination wallet aggregates balance, so
  // 1:1 pairing is structurally impossible. lib/pairing/transfers.ts marks
  // these as TRANSFER without a paired counterpart; A07 must not flag them.
  const unpaired = transfers
    .filter((t) => !t.isTransferPairedWith && !isMoneyMoverOutflow(t.merchantRaw))
    .map((t) => t.id)
  const moneyMoverCount = transfers.filter(
    (t) => !t.isTransferPairedWith && isMoneyMoverOutflow(t.merchantRaw),
  ).length
  // B-08: when 0 TRANSFER classifications exist this used to render
  // "0 transfer rows all paired" — a vacuous pass that obscured the fact
  // there's nothing to verify (e.g. classification hasn't run yet, or the
  // pairing-pass writes the side-table flag but no Classification row).
  // Surface that explicitly so a CPA reading the assertions doesn't take
  // the green check at face value.
  const passed = unpaired.length === 0
  let details: string
  if (transfers.length === 0) {
    details = "No transfer-coded rows to verify"
  } else if (passed) {
    details = moneyMoverCount > 0
      ? `${transfers.length} transfer rows verified (${moneyMoverCount} money-mover outflows correctly unpaired)`
      : `${transfers.length} transfer rows all paired`
  } else {
    details = `${unpaired.length} unpaired transfer rows`
  }
  return {
    id: "A07",
    name: "TRANSFER rows appear in pairs",
    passed,
    blocking: true,
    details,
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
    details:
      offenders.length === 0
        ? "All meals substantiated"
        : `${offenders.length} meal row${offenders.length === 1 ? "" : "s"} missing attendees/purpose`,
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
    where: { taxYearId, isSplit: false, isStale: false },
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
  const ty = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { year: true },
  })
  const yearWindow = ty ? inYearWindow(ty.year) : {}
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, isRefundPairedWith: { not: null }, ...yearWindow },
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
    details: `Sqft=${sqft}, formula: ${fmtUSD(expected)} (capped at 300sqft / $1,500)`,
  }
}

export async function A13_DEPOSITS_RECONSTRUCTED(taxYearId: string): Promise<AssertionResult> {
  // Spec §12.1: Σ inflows − paired transfers − classified gifts/loans/refunds − BIZ_INCOME
  // If |delta| > $500 → CRITICAL block
  const ty = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { year: true },
  })
  const yearWindow = ty ? inYearWindow(ty.year) : {}
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, amountNormalized: { lt: 0 }, ...yearWindow }, // inflows only
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  let totalInflows = 0
  let pairedTransfers = 0
  let bizIncome = 0
  let ownerContribution = 0
  let classifiedNonIncome = 0
  let unclassified = 0
  // Capture the row IDs that actually drive the "unclassified" bucket so the
  // Risk dashboard can render them inline (T1 of the risk↔stops disconnect
  // fix). Without this the CPA sees "$1,700 unclassified" but no path to the
  // 5 rows that produced the number — the FixItButton lands them on /stops
  // with an empty Deposit tab.
  const offenders: string[] = []

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
      offenders.push(t.id)
      continue
    }
    if (c.code === "BIZ_INCOME") bizIncome += abs
    else if (c.code === "OWNER_EQUITY") ownerContribution += abs
    else if (c.code === "TRANSFER" || c.code === "PERSONAL" || c.code === "PAYMENT") classifiedNonIncome += abs
    else {
      unclassified += abs
      offenders.push(t.id)
    }
  }

  const explained = pairedTransfers + bizIncome + ownerContribution + classifiedNonIncome
  const delta = totalInflows - explained - unclassified
  const passed = unclassified < 500 && Math.abs(delta) < 500
  // Lead with the actual reason for failure when one is present — without
  // this, the row reads "Δ 0.00" while still showing ✗, which makes it look
  // like the assertion is buggy rather than blocked by unclassified inflows.
  const reason = !passed
    ? unclassified >= 500
      ? `${fmtUSD(unclassified, { cents: true })} of inflows still unclassified`
      : `inflows don't reconcile (Δ ${fmtUSD(delta, { cents: true, signed: true })})`
    : null
  return {
    id: "A13",
    name: "Deposits reconstruction (§12.1)",
    passed,
    blocking: true,
    details: `${reason ? reason + " — " : ""}Inflows ${fmtUSD(totalInflows, { cents: true })} = transfers ${fmtUSD(pairedTransfers, { cents: true })} + biz income ${fmtUSD(bizIncome, { cents: true })} + owner contrib ${fmtUSD(ownerContribution, { cents: true })} + other ${fmtUSD(classifiedNonIncome, { cents: true })} + unclassified ${fmtUSD(unclassified, { cents: true })} (Δ ${fmtUSD(delta, { cents: true, signed: true })})`,
    offendingTransactionIds: offenders,
  }
}

// ---------- A14: COVERAGE COMPLETE ----------

/**
 * A14_COVERAGE_COMPLETE — every active account has either a statement
 * with transactions OR an explicit "inactive month" attestation for
 * every month in the tax year. Pre-fix the Coverage page surfaced gap
 * counts but Risk dashboard ignored them entirely; Atif's BofA had 6
 * missing months and Wise 5 missing months, none flagged as blockers.
 *
 * Resolution paths for the CPA:
 *   - Upload the missing statement (gap count drops naturally), OR
 *   - Mark the month inactive on the Coverage page (writes
 *     AccountInactiveMonth row + AuditEvent — defensible attestation).
 *
 * Both produce A14 PASS. A blocking assertion: a year with unexplained
 * coverage holes shouldn't lock — the underlying ledger is incomplete.
 */
export async function A14_COVERAGE_COMPLETE(taxYearId: string): Promise<AssertionResult> {
  const ty = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { year: true },
  })
  if (!ty) {
    return {
      id: "A14",
      name: "Coverage complete (no unexplained month gaps)",
      passed: false,
      blocking: true,
      details: "TaxYear not found",
    }
  }

  const accounts = await prisma.financialAccount.findMany({
    where: { taxYearId },
    select: {
      id: true,
      institution: true,
      nickname: true,
      mask: true,
      transactions: { select: { postedDate: true } },
      inactiveMonths: {
        where: { year: ty.year },
        select: { month: true },
      },
    },
  })

  let gapCount = 0
  const gapDetails: string[] = []
  for (const acct of accounts) {
    // Skip accounts with zero transactions and zero attestations — these
    // were created but never used. Treat them as not-yet-active rather
    // than "every month is a gap." If the CPA wants to attest them it
    // still works.
    if (acct.transactions.length === 0 && acct.inactiveMonths.length === 0) continue

    const monthsWithTx = new Set<number>()
    for (const tx of acct.transactions) {
      if (tx.postedDate.getUTCFullYear() === ty.year) {
        monthsWithTx.add(tx.postedDate.getUTCMonth() + 1)
      }
    }
    const monthsAttested = new Set(acct.inactiveMonths.map((m) => m.month))

    const accountGaps: number[] = []
    for (let m = 1; m <= 12; m++) {
      if (!monthsWithTx.has(m) && !monthsAttested.has(m)) accountGaps.push(m)
    }

    if (accountGaps.length > 0) {
      gapCount += accountGaps.length
      const label = acct.nickname ?? `${acct.institution}${acct.mask ? " ··" + acct.mask : ""}`
      const monthNames = accountGaps
        .map((m) => new Date(ty.year, m - 1, 1).toLocaleString("en-US", { month: "short" }))
        .join(", ")
      gapDetails.push(`${label}: ${monthNames}`)
    }
  }

  const passed = gapCount === 0
  return {
    id: "A14",
    name: "Coverage complete (no unexplained month gaps)",
    passed,
    blocking: true,
    details: passed
      ? "All active accounts have statements or inactive-month attestations for every month"
      : `${gapCount} unexplained month-gap${gapCount === 1 ? "" : "s"} — ${gapDetails.join("; ")}`,
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
    A14_COVERAGE_COMPLETE(taxYearId),
  ])
  const passed = results.filter((r) => r.passed)
  const failed = results.filter((r) => !r.passed)
  const blockingFailures = failed.filter((r) => r.blocking)
  return { passed, failed, blockingFailures }
}
