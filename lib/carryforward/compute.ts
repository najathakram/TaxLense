/**
 * Carryforward computation — given a LOCKED prior-year snapshot, derive
 * the values that flow INTO the next year:
 *   - §172 NOL carryforward (no carryback post-TCJA, indefinite, 80%
 *     taxable-income limitation)
 *   - §179 carryover (where deduction exceeded business income limit)
 *   - §469 suspended passive losses
 *   - Capital loss carryforward (S/L)
 *   - §170(d) charitable carryforward (per-source-year, 5-year sunset)
 *   - §53 AMT credit carryforward
 *   - §199A QBI loss carryforward (negative QBI carries as 199A loss)
 *   - §163(j) interest expense carryforward
 *   - Per-asset depreciation schedule (basis / method / life remaining)
 *   - S-Corp shareholder stock + debt basis (per Owner)
 *   - Partnership outside basis + §704(b) capital (per Owner)
 *   - Suspended losses by owner
 *
 * Pure: takes a TaxYear's locked snapshot + Owners + ledger; returns the
 * shape that PriorYearContext stores. Persistence happens elsewhere
 * (lib/lock/actions.ts hooks this on confirmLock).
 */

import { prisma } from "@/lib/db"
import { inYearWindow } from "@/lib/queries/yearWindow"
import { computeDeductibleAmt } from "@/lib/classification/deductible"

export interface ComputedCarryforward {
  netOperatingLoss: number
  section179Carryover: number
  passiveLossCarryforward: number
  capitalLossShortTerm: number
  capitalLossLongTerm: number
  charitableCarryforward: Record<string, number> // year → amount
  amtCreditCarryforward: number
  qbiLossCarryforward: number
  section163jCarryforward: number
  depreciationSchedule: DepreciationAsset[]
  shareholderBasis: ShareholderBasisEntry[]
  partnerCapital: PartnerCapitalEntry[]
  suspendedLosses: SuspendedLossEntry[]
}

export interface DepreciationAsset {
  assetId: string
  description: string
  placedInService: string  // ISO date
  costBasis: number
  methodCode: string       // "MACRS-5yr", "MACRS-7yr", "Section179", etc.
  recoveryPeriodYears: number
  accumulatedDepreciation: number
  remainingBasis: number
}

export interface ShareholderBasisEntry {
  ownerId: string
  ownerName: string
  stockBasisStart: number
  stockBasisEnd: number
  debtBasisStart: number
  debtBasisEnd: number
  // Suspended losses to carry forward (basis-limited losses)
  suspendedOrdinaryLoss: number
}

export interface PartnerCapitalEntry {
  ownerId: string
  ownerName: string
  capitalStart: number
  contributions: number
  allocatedIncome: number
  distributions: number
  capitalEnd: number
  // §704(c) book/tax delta
  bookTaxDelta: number
}

export interface SuspendedLossEntry {
  ownerId: string
  ownerName: string
  category: "PASSIVE" | "AT_RISK" | "STOCK_BASIS" | "DEBT_BASIS"
  amount: number
}

/**
 * Compute the carryforward shape from a (now-LOCKED) tax year. Should
 * be called with the source year's `taxYearId`; the consuming year picks
 * it up via PriorYearContext.sourcePriorYearId.
 */
export async function computeCarryforwardFromYear(
  sourceTaxYearId: string,
): Promise<ComputedCarryforward> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: sourceTaxYearId },
    select: { id: true, year: true, status: true },
  })
  if (ty.status !== "LOCKED") {
    throw new Error("Carryforward can only be computed from a LOCKED year")
  }

  const yearWindow = inYearWindow(ty.year)
  const [txns, profile, prior] = await Promise.all([
    prisma.transaction.findMany({
      where: { taxYearId: sourceTaxYearId, isSplit: false, isStale: false, ...yearWindow },
      include: { classifications: { where: { isCurrent: true }, take: 1 } },
    }),
    prisma.businessProfile.findUnique({
      where: { taxYearId: sourceTaxYearId },
      include: { owners: true },
    }),
    // Carryforwards roll forward — start from prior year's existing PYC if any
    prisma.priorYearContext.findUnique({ where: { taxYearId: sourceTaxYearId } }),
  ])

  // ── Net Operating Loss (§172) ────────────────────────────────────────────
  // Net = gross income - deductions. Per TCJA: no carryback. Cumulative
  // NOL = prior NOL + this year's loss (if loss). Limited to 80% of taxable
  // income when consumed (we just track the carryforward; consumption is at
  // the 1040 level).
  let grossReceipts = 0
  let totalDeductions = 0
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const amt = Math.abs(Number(t.amountNormalized.toString()))
    if (c.code === "BIZ_INCOME") grossReceipts += amt
    else if (
      ["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100"].includes(c.code)
    ) {
      totalDeductions += computeDeductibleAmt(amt, c.code, c.businessPct)
    }
  }
  const netIncome = grossReceipts - totalDeductions
  const priorNol = Number(prior?.netOperatingLoss?.toString() ?? "0")
  const thisYearLoss = netIncome < 0 ? -netIncome : 0
  // If we had a profit, NOL gets absorbed (capped at 80% of profit per §172)
  const consumed = netIncome > 0 ? Math.min(priorNol, netIncome * 0.8) : 0
  const netOperatingLoss = priorNol - consumed + thisYearLoss

  // ── §179 carryover ───────────────────────────────────────────────────────
  // Carries forward when §179 deduction exceeded the business-income limit.
  // We don't track §179 elections separately yet; carry the prior amount
  // unchanged. Will be wired when Form 4562 §179 elections are captured.
  const section179Carryover = Number(prior?.section179Carryover?.toString() ?? "0")

  // ── §469 passive loss ────────────────────────────────────────────────────
  // Only relevant for passive-activity entities (rental real estate, certain
  // limited-partner interests). Default 0 for the dropshipping use case.
  const passiveLossCarryforward = Number(prior?.passiveLossCarryforward?.toString() ?? "0")

  // ── Capital loss carryforward (Schedule D) ───────────────────────────────
  // Tracked separately when capital-gain transactions exist. Schema in place;
  // computation defaults to 0 until capital-gain classifications land.
  const capitalLossShortTerm = Number(prior?.capitalLossShortTerm?.toString() ?? "0")
  const capitalLossLongTerm = Number(prior?.capitalLossLongTerm?.toString() ?? "0")

  // ── Charitable carryforward (5-year sunset) ──────────────────────────────
  const charitableCarryforward = (prior?.charitableCarryforward as Record<string, number>) ?? {}

  // ── §53 AMT credit ───────────────────────────────────────────────────────
  const amtCreditCarryforward = Number(prior?.amtCreditCarryforward?.toString() ?? "0")

  // ── §199A QBI loss ───────────────────────────────────────────────────────
  // Negative QBI = current year QBI loss + carry-forward. QBI loss carries
  // forward indefinitely, reducing future QBI components.
  const priorQbiLoss = Number(prior?.qbiLossCarryforward?.toString() ?? "0")
  const thisYearQbiLoss = netIncome < 0 ? -netIncome : 0
  const consumedQbiLoss = netIncome > 0 ? Math.min(priorQbiLoss, netIncome) : 0
  const qbiLossCarryforward = priorQbiLoss - consumedQbiLoss + thisYearQbiLoss

  // ── §163(j) interest expense carryforward ────────────────────────────────
  const section163jCarryforward = Number(prior?.section163jCarryforward?.toString() ?? "0")

  // ── Depreciation schedule (per asset) ────────────────────────────────────
  // Stub: pull the existing schedule, age each asset by 1 year (decrement
  // recovery period, recompute remaining basis using straight-line — MACRS
  // tables can layer on later).
  const priorAssets = (prior?.depreciationSchedule as unknown as DepreciationAsset[]) ?? []
  const depreciationSchedule: DepreciationAsset[] = priorAssets.map((a) => {
    const yearsRemaining = Math.max(0, a.recoveryPeriodYears)
    const annualDep = yearsRemaining > 0 ? a.remainingBasis / yearsRemaining : 0
    return {
      ...a,
      accumulatedDepreciation: a.accumulatedDepreciation + annualDep,
      remainingBasis: Math.max(0, a.remainingBasis - annualDep),
      recoveryPeriodYears: Math.max(0, a.recoveryPeriodYears - 1),
    }
  })

  // ── Shareholder basis (S-Corp) ───────────────────────────────────────────
  const shareholderBasis: ShareholderBasisEntry[] = []
  if (profile?.entityType === "S_CORP") {
    for (const o of profile.owners.filter((o) => o.kind === "OFFICER" || o.kind === "SHAREHOLDER")) {
      const stockStart = Number(o.stockBasis?.toString() ?? "0")
      const debtStart = Number(o.debtBasis?.toString() ?? "0")
      const allocated = netIncome * (Number(o.ownershipPct.toString()) / 100)
      const distrib = Number(o.distributions?.toString() ?? "0")
      const contribution = Number(o.capitalContribution?.toString() ?? "0")
      // Stock basis: + contributions, + allocated income, − distributions,
      // − allocated loss (limited to basis). Never goes below 0.
      const stockEnd = Math.max(0, stockStart + contribution + Math.max(0, allocated) - distrib)
      // Suspended loss: portion of allocated loss > stock + debt basis
      const allocatedLoss = allocated < 0 ? -allocated : 0
      const totalBasisAvailable = stockStart + debtStart + contribution
      const suspendedOrdinaryLoss = Math.max(0, allocatedLoss - totalBasisAvailable)
      shareholderBasis.push({
        ownerId: o.id,
        ownerName: o.name,
        stockBasisStart: stockStart,
        stockBasisEnd: stockEnd,
        debtBasisStart: debtStart,
        debtBasisEnd: debtStart, // No debt repayment tracked yet
        suspendedOrdinaryLoss,
      })
    }
  }

  // ── Partner capital (Partnership / LLC-multi) ────────────────────────────
  const partnerCapital: PartnerCapitalEntry[] = []
  if (profile?.entityType === "LLC_MULTI" || profile?.entityType === "PARTNERSHIP") {
    for (const o of profile.owners.filter(
      (o) => o.kind === "GENERAL_PARTNER" || o.kind === "LIMITED_PARTNER" || o.kind === "MEMBER",
    )) {
      const start = Number(o.partnerCapitalStart?.toString() ?? "0")
      const contribution = Number(o.capitalContribution?.toString() ?? "0")
      const allocated = netIncome * (Number(o.ownershipPct.toString()) / 100)
      const distrib = Number(o.distributions?.toString() ?? "0")
      const end = start + contribution + allocated - distrib
      partnerCapital.push({
        ownerId: o.id,
        ownerName: o.name,
        capitalStart: start,
        contributions: contribution,
        allocatedIncome: allocated,
        distributions: distrib,
        capitalEnd: end,
        bookTaxDelta: Number(o.bookTaxDelta?.toString() ?? "0"),
      })
    }
  }

  // ── Suspended losses summary ─────────────────────────────────────────────
  const suspendedLosses: SuspendedLossEntry[] = []
  for (const sb of shareholderBasis) {
    if (sb.suspendedOrdinaryLoss > 0) {
      suspendedLosses.push({
        ownerId: sb.ownerId,
        ownerName: sb.ownerName,
        category: "STOCK_BASIS",
        amount: sb.suspendedOrdinaryLoss,
      })
    }
  }

  return {
    netOperatingLoss,
    section179Carryover,
    passiveLossCarryforward,
    capitalLossShortTerm,
    capitalLossLongTerm,
    charitableCarryforward,
    amtCreditCarryforward,
    qbiLossCarryforward,
    section163jCarryforward,
    depreciationSchedule,
    shareholderBasis,
    partnerCapital,
    suspendedLosses,
  }
}

/**
 * Persist a computed carryforward as a PriorYearContext row attached to
 * the CONSUMING year. Idempotent — re-running overwrites the row but
 * preserves the auditEvent chain.
 */
export async function persistCarryforwardTo(
  consumingTaxYearId: string,
  sourceTaxYearId: string,
  computed: ComputedCarryforward,
): Promise<void> {
  const sourceYear = await prisma.taxYear.findUniqueOrThrow({
    where: { id: sourceTaxYearId },
    select: { lockedSnapshotHash: true },
  })

  await prisma.priorYearContext.upsert({
    where: { taxYearId: consumingTaxYearId },
    create: {
      taxYearId: consumingTaxYearId,
      sourcePriorYearId: sourceTaxYearId,
      sourceLockedHash: sourceYear.lockedSnapshotHash,
      netOperatingLoss: computed.netOperatingLoss,
      section179Carryover: computed.section179Carryover,
      passiveLossCarryforward: computed.passiveLossCarryforward,
      capitalLossShortTerm: computed.capitalLossShortTerm,
      capitalLossLongTerm: computed.capitalLossLongTerm,
      charitableCarryforward: computed.charitableCarryforward as never,
      amtCreditCarryforward: computed.amtCreditCarryforward,
      qbiLossCarryforward: computed.qbiLossCarryforward,
      section163jCarryforward: computed.section163jCarryforward,
      depreciationSchedule: computed.depreciationSchedule as never,
      shareholderBasis: computed.shareholderBasis as never,
      partnerCapital: computed.partnerCapital as never,
      suspendedLosses: computed.suspendedLosses as never,
    },
    update: {
      sourcePriorYearId: sourceTaxYearId,
      sourceLockedHash: sourceYear.lockedSnapshotHash,
      netOperatingLoss: computed.netOperatingLoss,
      section179Carryover: computed.section179Carryover,
      passiveLossCarryforward: computed.passiveLossCarryforward,
      capitalLossShortTerm: computed.capitalLossShortTerm,
      capitalLossLongTerm: computed.capitalLossLongTerm,
      charitableCarryforward: computed.charitableCarryforward as never,
      amtCreditCarryforward: computed.amtCreditCarryforward,
      qbiLossCarryforward: computed.qbiLossCarryforward,
      section163jCarryforward: computed.section163jCarryforward,
      depreciationSchedule: computed.depreciationSchedule as never,
      shareholderBasis: computed.shareholderBasis as never,
      partnerCapital: computed.partnerCapital as never,
      suspendedLosses: computed.suspendedLosses as never,
      computedAt: new Date(),
    },
  })
}

/**
 * Auto-populate the carryforward for any year+1 that exists for the
 * same taxpayer when the source year is locked. Called from confirmLock
 * server action. If no consuming year exists yet, this is a no-op —
 * createTaxYear will pick up the carryforward when the next year is
 * created.
 */
export async function maybePopulateCarryforwardOnLock(sourceTaxYearId: string): Promise<void> {
  const source = await prisma.taxYear.findUnique({
    where: { id: sourceTaxYearId },
    select: { id: true, userId: true, year: true, status: true },
  })
  if (!source || source.status !== "LOCKED") return

  const consuming = await prisma.taxYear.findUnique({
    where: { userId_year: { userId: source.userId, year: source.year + 1 } },
  })
  if (!consuming) return

  try {
    const computed = await computeCarryforwardFromYear(sourceTaxYearId)
    await persistCarryforwardTo(consuming.id, sourceTaxYearId, computed)
  } catch (e) {
    console.error("[carryforward] population failed:", e)
  }
}
