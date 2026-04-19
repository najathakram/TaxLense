/**
 * Analytics dataset builder (Session 9 §B).
 *
 * buildAnalytics(taxYearId) returns all chart datasets needed by the per-client
 * analytics page. All aggregates filter `isSplit=false` (split parents are
 * placeholders; children carry the real amounts) and `Classification.isCurrent=true`.
 *
 * No AI calls. Pure Prisma + in-memory aggregation.
 */

import { prisma } from "@/lib/db"
import { benchmarksForNaics, type IrsBenchmark } from "./irsBenchmarks"

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeductionMixPoint {
  label: string
  scheduleCLine: string
  clientShare: number
  benchmarkShare: number
  clientAmount: number
}

export interface MealsRatioPoint {
  month: string // YYYY-MM
  mealsDeductible: number
  grossReceipts: number
  ratio: number
}

export interface VehicleGauge {
  bizPct: number
  hasConfig: boolean
}

export interface DepositsWaterfallPoint {
  label: string
  amount: number
  cumulative: number
}

export interface EvidenceTierStack {
  scheduleCLine: string
  tier1: number
  tier2: number
  tier3: number
  tier4: number
  tier5: number
}

export interface MonthlyExpensePoint {
  month: string
  total: number
  byLine: Record<string, number>
}

export interface TopMerchant {
  merchantKey: string
  count: number
  total: number
  code: string | null
}

export interface AccountDonutSlice {
  accountLabel: string
  total: number
  accountType: string
}

export interface TripMapPoint {
  tripName: string
  destination: string
  startDate: string
  endDate: string
  txCount: number
  totalSpent: number
}

export interface AnalyticsDataset {
  taxYearId: string
  year: number
  computedAt: string
  grossReceipts: number
  totalDeductible: number
  netProfit: number
  charts: {
    deductionMix: DeductionMixPoint[]
    mealsRatio: MealsRatioPoint[]
    vehicleGauge: VehicleGauge
    depositsWaterfall: DepositsWaterfallPoint[]
    evidenceTierStack: EvidenceTierStack[]
    monthlyExpense: MonthlyExpensePoint[]
    topMerchants: TopMerchant[]
    accountDonut: AccountDonutSlice[]
    tripMap: TripMapPoint[]
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function deductibleMultiplier(code: string): number {
  if (code === "MEALS_50") return 0.5
  if (code === "MEALS_100") return 1
  return 1
}

const DEDUCTIBLE_CODES = new Set([
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
])

// ---------------------------------------------------------------------------
// Core builder
// ---------------------------------------------------------------------------

export async function buildAnalytics(taxYearId: string): Promise<AnalyticsDataset> {
  const taxYear = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { id: true, year: true, userId: true },
  })

  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { naicsCode: true, vehicleConfig: true },
  })

  // All non-split transactions with their current classification (if any)
  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isDuplicateOf: null,
    },
    select: {
      id: true,
      postedDate: true,
      amountNormalized: true,
      merchantNormalized: true,
      merchantRaw: true,
      accountId: true,
      account: { select: { institution: true, nickname: true, mask: true, type: true } },
      classifications: {
        where: { isCurrent: true },
        select: {
          code: true,
          scheduleCLine: true,
          businessPct: true,
          evidenceTier: true,
        },
      },
    },
  })

  const trips = await prisma.trip.findMany({
    where: { profile: { taxYearId } },
    select: {
      name: true,
      destination: true,
      startDate: true,
      endDate: true,
    },
  })

  // Precompute per-txn deductible amount
  const annotated = txns.map((t) => {
    const amt = Number(t.amountNormalized.toString()) // outflow +, inflow -
    const cls = t.classifications[0] ?? null
    const isInflow = amt < 0
    const isDeductible = cls ? DEDUCTIBLE_CODES.has(cls.code) : false
    const deductible = isDeductible
      ? Math.abs(amt) * (cls!.businessPct / 100) * deductibleMultiplier(cls!.code)
      : 0
    const isIncome = cls?.code === "BIZ_INCOME" || (isInflow && cls?.code !== "TRANSFER" && cls?.code !== "PAYMENT" && cls?.code !== "PERSONAL")
    const income = cls?.code === "BIZ_INCOME" ? Math.abs(amt) : 0
    return { ...t, amt, cls, deductible, income, isInflow, isIncome }
  })

  const grossReceipts = annotated.reduce((s, t) => s + t.income, 0)
  const totalDeductible = annotated.reduce((s, t) => s + t.deductible, 0)
  const netProfit = grossReceipts - totalDeductible

  // ── Chart 1: deduction mix vs benchmarks ───────────────────────────────────
  const benchmarks: IrsBenchmark[] = benchmarksForNaics(profile?.naicsCode)
  const deductibleByLine = new Map<string, number>()
  for (const t of annotated) {
    if (t.deductible > 0 && t.cls?.scheduleCLine) {
      deductibleByLine.set(
        t.cls.scheduleCLine,
        (deductibleByLine.get(t.cls.scheduleCLine) ?? 0) + t.deductible,
      )
    }
  }
  const totalForMix = Array.from(deductibleByLine.values()).reduce((s, v) => s + v, 0) || 1
  const deductionMix: DeductionMixPoint[] = benchmarks.map((b) => {
    const amt = deductibleByLine.get(b.scheduleCLine) ?? 0
    return {
      label: b.label,
      scheduleCLine: b.scheduleCLine,
      clientShare: amt / totalForMix,
      benchmarkShare: b.deductionShare,
      clientAmount: amt,
    }
  })

  // ── Chart 2: meals ratio by month ──────────────────────────────────────────
  const monthlyMeals = new Map<string, number>()
  const monthlyReceipts = new Map<string, number>()
  for (const t of annotated) {
    const mk = monthKey(t.postedDate)
    if (t.cls?.code === "MEALS_50" || t.cls?.code === "MEALS_100") {
      monthlyMeals.set(mk, (monthlyMeals.get(mk) ?? 0) + t.deductible)
    }
    if (t.income > 0) {
      monthlyReceipts.set(mk, (monthlyReceipts.get(mk) ?? 0) + t.income)
    }
  }
  const allMonths = new Set<string>([...monthlyMeals.keys(), ...monthlyReceipts.keys()])
  const mealsRatio: MealsRatioPoint[] = Array.from(allMonths)
    .sort()
    .map((m) => {
      const meals = monthlyMeals.get(m) ?? 0
      const rec = monthlyReceipts.get(m) ?? 0
      return {
        month: m,
        mealsDeductible: meals,
        grossReceipts: rec,
        ratio: rec > 0 ? meals / rec : 0,
      }
    })

  // ── Chart 3: vehicle gauge ─────────────────────────────────────────────────
  const vcfg = profile?.vehicleConfig as { has?: boolean; bizPct?: number } | null
  const vehicleGauge: VehicleGauge = {
    bizPct: vcfg?.has ? (vcfg.bizPct ?? 0) : 0,
    hasConfig: !!vcfg?.has,
  }

  // ── Chart 4: deposits waterfall ────────────────────────────────────────────
  let cumulative = 0
  const depositCats = new Map<string, number>([
    ["BIZ_INCOME", 0],
    ["TRANSFER", 0],
    ["PAYMENT", 0],
    ["PERSONAL", 0],
    ["UNCLASSIFIED", 0],
  ])
  for (const t of annotated) {
    if (!t.isInflow) continue
    const bucket = t.cls?.code && depositCats.has(t.cls.code)
      ? t.cls.code
      : t.cls ? "PERSONAL" : "UNCLASSIFIED"
    depositCats.set(bucket, depositCats.get(bucket)! + Math.abs(t.amt))
  }
  const depositsWaterfall: DepositsWaterfallPoint[] = Array.from(depositCats.entries()).map(
    ([label, amount]) => {
      cumulative += amount
      return { label, amount, cumulative }
    },
  )

  // ── Chart 5: evidence tier stacked bar ─────────────────────────────────────
  const tierByLine = new Map<string, { t1: number; t2: number; t3: number; t4: number; t5: number }>()
  for (const t of annotated) {
    if (!t.cls?.scheduleCLine || t.deductible <= 0) continue
    const line = t.cls.scheduleCLine
    if (!tierByLine.has(line)) tierByLine.set(line, { t1: 0, t2: 0, t3: 0, t4: 0, t5: 0 })
    const bucket = tierByLine.get(line)!
    const tier = t.cls.evidenceTier ?? 4
    if (tier === 1) bucket.t1 += t.deductible
    else if (tier === 2) bucket.t2 += t.deductible
    else if (tier === 3) bucket.t3 += t.deductible
    else if (tier === 4) bucket.t4 += t.deductible
    else bucket.t5 += t.deductible
  }
  const evidenceTierStack: EvidenceTierStack[] = Array.from(tierByLine.entries()).map(
    ([scheduleCLine, v]) => ({
      scheduleCLine,
      tier1: v.t1,
      tier2: v.t2,
      tier3: v.t3,
      tier4: v.t4,
      tier5: v.t5,
    }),
  )

  // ── Chart 6: monthly expense by line ───────────────────────────────────────
  const monthly = new Map<string, { total: number; byLine: Record<string, number> }>()
  for (const t of annotated) {
    if (t.deductible <= 0) continue
    const mk = monthKey(t.postedDate)
    if (!monthly.has(mk)) monthly.set(mk, { total: 0, byLine: {} })
    const m = monthly.get(mk)!
    m.total += t.deductible
    const line = t.cls?.scheduleCLine ?? "Unclassified"
    m.byLine[line] = (m.byLine[line] ?? 0) + t.deductible
  }
  const monthlyExpense: MonthlyExpensePoint[] = Array.from(monthly.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({ month, total: v.total, byLine: v.byLine }))

  // ── Chart 7: top 10 merchants by deductible spend ──────────────────────────
  const byMerchant = new Map<string, { count: number; total: number; code: string | null }>()
  for (const t of annotated) {
    if (t.deductible <= 0) continue
    const key = t.merchantNormalized ?? t.merchantRaw
    if (!byMerchant.has(key)) byMerchant.set(key, { count: 0, total: 0, code: t.cls?.code ?? null })
    const e = byMerchant.get(key)!
    e.count += 1
    e.total += t.deductible
  }
  const topMerchants: TopMerchant[] = Array.from(byMerchant.entries())
    .map(([merchantKey, v]) => ({ merchantKey, ...v }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 10)

  // ── Chart 8: account donut (% of outflows by account) ──────────────────────
  const byAccount = new Map<string, { total: number; accountType: string; label: string }>()
  for (const t of annotated) {
    if (!t.isInflow && Math.abs(t.amt) > 0) {
      const label = t.account.nickname
        ?? `${t.account.institution}${t.account.mask ? ` ···${t.account.mask}` : ""}`
      if (!byAccount.has(label)) {
        byAccount.set(label, { total: 0, accountType: t.account.type, label })
      }
      byAccount.get(label)!.total += Math.abs(t.amt)
    }
  }
  const accountDonut: AccountDonutSlice[] = Array.from(byAccount.values())
    .map((v) => ({ accountLabel: v.label, total: v.total, accountType: v.accountType }))
    .sort((a, b) => b.total - a.total)

  // ── Chart 9: trip map (simplified — no lat/long in V1) ─────────────────────
  const tripMap: TripMapPoint[] = trips.map((trip) => {
    const spent = annotated
      .filter(
        (t) =>
          t.cls?.code === "WRITE_OFF_TRAVEL" &&
          t.postedDate >= trip.startDate &&
          t.postedDate <= trip.endDate,
      )
      .reduce((s, t) => s + t.deductible, 0)
    const count = annotated.filter(
      (t) =>
        t.cls?.code === "WRITE_OFF_TRAVEL" &&
        t.postedDate >= trip.startDate &&
        t.postedDate <= trip.endDate,
    ).length
    return {
      tripName: trip.name,
      destination: trip.destination,
      startDate: trip.startDate.toISOString().slice(0, 10),
      endDate: trip.endDate.toISOString().slice(0, 10),
      txCount: count,
      totalSpent: spent,
    }
  })

  return {
    taxYearId: taxYear.id,
    year: taxYear.year,
    computedAt: new Date().toISOString(),
    grossReceipts,
    totalDeductible,
    netProfit,
    charts: {
      deductionMix,
      mealsRatio,
      vehicleGauge,
      depositsWaterfall,
      evidenceTierStack,
      monthlyExpense,
      topMerchants,
      accountDonut,
      tripMap,
    },
  }
}

// ---------------------------------------------------------------------------
// Firm-level overview (aggregated across CPA's clients)
// ---------------------------------------------------------------------------

export interface FirmClientSummary {
  clientUserId: string
  clientName: string
  clientEmail: string
  taxYearId: string | null
  year: number | null
  status: string | null
  grossReceipts: number
  totalDeductible: number
  netProfit: number
  pendingStops: number
  lockedAt: string | null
}

export async function buildFirmOverview(cpaUserId: string): Promise<FirmClientSummary[]> {
  const rels = await prisma.cpaClient.findMany({
    where: { cpaUserId },
    include: {
      client: {
        select: {
          id: true,
          name: true,
          email: true,
          taxYears: {
            orderBy: { year: "desc" },
            take: 1,
            select: {
              id: true,
              year: true,
              status: true,
              lockedAt: true,
            },
          },
        },
      },
    },
  })

  const out: FirmClientSummary[] = []
  for (const rel of rels) {
    const ty = rel.client.taxYears[0]
    if (!ty) {
      out.push({
        clientUserId: rel.client.id,
        clientName: rel.client.name ?? rel.client.email,
        clientEmail: rel.client.email,
        taxYearId: null,
        year: null,
        status: null,
        grossReceipts: 0,
        totalDeductible: 0,
        netProfit: 0,
        pendingStops: 0,
        lockedAt: null,
      })
      continue
    }
    const a = await buildAnalytics(ty.id)
    const pendingStops = await prisma.stopItem.count({
      where: { taxYearId: ty.id, state: "PENDING" },
    })
    out.push({
      clientUserId: rel.client.id,
      clientName: rel.client.name ?? rel.client.email,
      clientEmail: rel.client.email,
      taxYearId: ty.id,
      year: ty.year,
      status: ty.status,
      grossReceipts: a.grossReceipts,
      totalDeductible: a.totalDeductible,
      netProfit: a.netProfit,
      pendingStops,
      lockedAt: ty.lockedAt?.toISOString() ?? null,
    })
  }
  return out
}
