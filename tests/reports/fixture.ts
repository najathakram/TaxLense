/**
 * Shared fixture for report tests.
 * Creates a minimal locked tax year (2024) with classified transactions.
 * Cleans up fully in teardown.
 */

import { PrismaClient } from "../../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

export const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
export const prisma = new PrismaClient({ adapter })

export interface ReportFixture {
  taxYearId: string
  accountId: string
  txnIds: string[]
  classIds: string[]
}

export async function createReportFixture(): Promise<ReportFixture> {
  const user = await prisma.user.findUnique({ where: { email: "test@taxlens.local" } })
  if (!user) throw new Error("Seed user missing — run pnpm seed first")

  // Clean up any leftover 2024 data from a previous failed run
  const existing = await prisma.taxYear.findUnique({ where: { userId_year: { userId: user.id, year: 2024 } } })
  if (existing) {
    await prisma.classification.deleteMany({ where: { transaction: { taxYearId: existing.id } } })
    await prisma.transaction.deleteMany({ where: { taxYearId: existing.id } })
    await prisma.merchantRule.deleteMany({ where: { taxYearId: existing.id } })
    await prisma.stopItem.deleteMany({ where: { taxYearId: existing.id } })
    await prisma.businessProfile.deleteMany({ where: { taxYearId: existing.id } })
    await prisma.financialAccount.deleteMany({ where: { taxYearId: existing.id } })
    await prisma.taxYear.delete({ where: { id: existing.id } })
  }

  const taxYear = await prisma.taxYear.create({
    data: {
      userId: user.id,
      year: 2024,
      status: "LOCKED",
      lockedAt: new Date("2025-01-15T12:00:00Z"),
      lockedSnapshotHash: "deadbeef" + "0".repeat(56),
    },
  })

  await prisma.businessProfile.create({
    data: {
      userId: user.id,
      taxYearId: taxYear.id,
      naicsCode: "711510",
      entityType: "SOLE_PROP",
      primaryState: "TX",
      businessDescription: "Wedding photography and travel content creator",
      accountingMethod: "CASH",
      grossReceiptsEstimate: 50000,
      revenueStreams: ["Photography", "Sponsorships"],
      homeOfficeConfig: { has: true, method: "SIMPLIFIED", officeSqft: 100, homeSqft: 1200 },
      vehicleConfig: { has: true, bizPct: 60 },
      firstYear: false,
      draftStep: 10,
    },
  })

  const account = await prisma.financialAccount.create({
    data: {
      userId: user.id,
      taxYearId: taxYear.id,
      type: "CHECKING",
      institution: "Chase",
      mask: "9517",
      isPrimaryBusiness: true,
    },
  })

  const txnIds: string[] = []
  const classIds: string[] = []

  // Helper to create a transaction + classification pair
  async function createTx(opts: {
    date: string
    amount: number  // positive = outflow
    merchant: string
    code: "WRITE_OFF" | "WRITE_OFF_TRAVEL" | "MEALS_50" | "MEALS_100" | "BIZ_INCOME" | "PERSONAL"
    schCLine?: string
    bizPct?: number
    irc?: string[]
    tier?: number
    reasoning?: string
    substantiation?: object
  }) {
    const isInflow = opts.code === "BIZ_INCOME"
    const normalized = isInflow ? -Math.abs(opts.amount) : Math.abs(opts.amount)
    const tx = await prisma.transaction.create({
      data: {
        accountId: account.id,
        taxYearId: taxYear.id,
        postedDate: new Date(opts.date),
        amountOriginal: normalized,
        amountNormalized: normalized,
        merchantRaw: opts.merchant,
        merchantNormalized: opts.merchant.toUpperCase(),
        idempotencyKey: `report-fixture-${opts.date}-${opts.merchant}-${opts.amount}`,
      },
    })
    txnIds.push(tx.id)

    const cls = await prisma.classification.create({
      data: {
        transactionId: tx.id,
        code: opts.code,
        scheduleCLine: opts.schCLine ?? null,
        businessPct: opts.bizPct ?? (opts.code === "BIZ_INCOME" || opts.code === "PERSONAL" ? 0 : 100),
        ircCitations: opts.irc ?? ["§162"],
        confidence: 0.9,
        evidenceTier: opts.tier ?? 2,
        source: "AI",
        reasoning: opts.reasoning ?? `${opts.merchant} is ${opts.code}`,
        isCurrent: true,
        substantiation: opts.substantiation ?? undefined,
      },
    })
    classIds.push(cls.id)
    return { tx, cls }
  }

  // Income
  await createTx({ date: "2024-02-15", amount: 12000, merchant: "THEKNOT WEDDING WIRE", code: "BIZ_INCOME" })
  await createTx({ date: "2024-05-20", amount: 8500, merchant: "INSTAGRAM SPONSOR", code: "BIZ_INCOME" })

  // Operating expenses
  await createTx({ date: "2024-01-10", amount: 299, merchant: "ADOBE SYSTEMS", code: "WRITE_OFF", schCLine: "Line 18 Office Expense", irc: ["§162"] })
  await createTx({ date: "2024-02-05", amount: 150, merchant: "VERIZON WIRELESS", code: "WRITE_OFF", schCLine: "Line 25 Utilities", irc: ["§162"] })
  await createTx({ date: "2024-03-12", amount: 2400, merchant: "LENS RENTAL", code: "WRITE_OFF", schCLine: "Line 22 Supplies", irc: ["§162"] })

  // Travel
  await createTx({ date: "2024-04-10", amount: 850, merchant: "DELTA AIRLINES", code: "WRITE_OFF_TRAVEL", schCLine: "Line 24a Travel", irc: ["§162", "§274(d)"], tier: 2, reasoning: "Flight for Alaska client shoot" })
  await createTx({ date: "2024-04-12", amount: 320, merchant: "MARRIOTT HOTELS", code: "WRITE_OFF_TRAVEL", schCLine: "Line 24a Travel", irc: ["§162", "§274(d)"], tier: 2 })

  // Meals (with substantiation for A08)
  await createTx({
    date: "2024-04-11",
    amount: 85,
    merchant: "RUSTIC GOAT ANCHORAGE",
    code: "MEALS_50",
    schCLine: "Line 24b Meals",
    irc: ["§162", "§274(d)", "§274(n)(1)"],
    tier: 2,
    substantiation: { attendees: "Self + client Jordan M.", purpose: "Pre-shoot planning dinner" },
  })

  // Personal
  await createTx({ date: "2024-06-20", amount: 250, merchant: "NETFLIX", code: "PERSONAL", bizPct: 0 })

  return { taxYearId: taxYear.id, accountId: account.id, txnIds, classIds }
}

export async function destroyReportFixture(f: ReportFixture) {
  if (f.classIds.length) await prisma.classification.deleteMany({ where: { id: { in: f.classIds } } })
  if (f.txnIds.length) await prisma.transaction.deleteMany({ where: { id: { in: f.txnIds } } })
  await prisma.businessProfile.deleteMany({ where: { taxYearId: f.taxYearId } })
  await prisma.financialAccount.deleteMany({ where: { taxYearId: f.taxYearId } })
  await prisma.taxYear.delete({ where: { id: f.taxYearId } })
  await prisma.$disconnect()
}
