/**
 * Prompt 6 — Risk score tests
 *
 * Verifies deterministic scoring for key signals using synthetic fixtures.
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { computeRiskScore } from "../lib/risk/score"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

describe("computeRiskScore", () => {
  let taxYearId: string
  let accountId: string
  const txIds: string[] = []
  const clsIds: string[] = []

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: "test@taxlens.local" } })
    if (!user) throw new Error("Seed user missing")
    const ty = await prisma.taxYear.findUnique({ where: { userId_year: { userId: user.id, year: 2025 } } })
    if (!ty) throw new Error("Seed tax year missing")
    taxYearId = ty.id
    const acct = await prisma.financialAccount.findFirst({ where: { taxYearId } })
    accountId = acct!.id
  })

  afterAll(async () => {
    if (clsIds.length) await prisma.classification.deleteMany({ where: { id: { in: clsIds } } })
    if (txIds.length) await prisma.transaction.deleteMany({ where: { id: { in: txIds } } })
    await prisma.$disconnect()
  })

  it("returns a report with estimatedDeductions and tax impact at 25%", async () => {
    const r = await computeRiskScore(taxYearId)
    expect(r.score).toBeGreaterThanOrEqual(0)
    expect(r.band).toMatch(/LOW|MODERATE|HIGH|CRITICAL/)
    expect(r.estimatedTaxImpact).toBeCloseTo(r.estimatedDeductions * 0.25, 2)
    expect(r.estimatedTaxImpactNote).toMatch(/Informational/)
  })

  it("flags meal ratio > 5% of gross with +15 HIGH signal", async () => {
    // Create $10,000 income + $700 in MEALS_50 (7% ratio > 5% threshold)
    const incomeTx = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-07-01"),
        amountOriginal: -10000,
        amountNormalized: -10000,
        merchantRaw: "TEST INCOME MEAL-RATIO",
        merchantNormalized: "TEST_INCOME_MR",
        idempotencyKey: `test-mr-inc-${Date.now()}`,
      },
    })
    txIds.push(incomeTx.id)
    const incomeCls = await prisma.classification.create({
      data: {
        transactionId: incomeTx.id,
        code: "BIZ_INCOME",
        scheduleCLine: "Line 1 Gross Receipts",
        businessPct: 100,
        ircCitations: ["§61"],
        confidence: 1.0,
        evidenceTier: 2,
        source: "USER",
        isCurrent: true,
      },
    })
    clsIds.push(incomeCls.id)

    const mealTx = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-07-02"),
        amountOriginal: 1400,
        amountNormalized: 1400, // pct 100, MEALS_50 → deductible 50% = 700 counted toward meal ratio
        merchantRaw: "TEST BIG MEAL",
        merchantNormalized: "TEST_BIG_MEAL",
        idempotencyKey: `test-mr-meal-${Date.now()}`,
      },
    })
    txIds.push(mealTx.id)
    const mealCls = await prisma.classification.create({
      data: {
        transactionId: mealTx.id,
        code: "MEALS_50",
        scheduleCLine: "Line 24b Meals",
        businessPct: 100,
        ircCitations: ["§162", "§274(d)"],
        confidence: 0.9,
        evidenceTier: 2,
        source: "USER",
        substantiation: { attendees: "Client group", purpose: "Q3 review" },
        isCurrent: true,
      },
    })
    clsIds.push(mealCls.id)

    const r = await computeRiskScore(taxYearId)
    const mealSignal = [...r.high, ...r.medium, ...r.critical].find((s) => s.id === "MEAL_RATIO")
    expect(mealSignal).toBeDefined()
    expect(mealSignal!.points).toBe(15)
    expect(mealSignal!.severity).toBe("HIGH")
  })

  it("categorizes NEEDS_CONTEXT as CRITICAL blocking signal", async () => {
    const t = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-07-03"),
        amountOriginal: 25,
        amountNormalized: 25,
        merchantRaw: "NEEDS CTX TEST",
        merchantNormalized: "NEEDS_CTX_TEST",
        idempotencyKey: `test-nc-${Date.now()}`,
      },
    })
    txIds.push(t.id)
    const c = await prisma.classification.create({
      data: {
        transactionId: t.id,
        code: "NEEDS_CONTEXT",
        businessPct: 0,
        ircCitations: [],
        confidence: 0.3,
        evidenceTier: 3,
        source: "AI",
        isCurrent: true,
      },
    })
    clsIds.push(c.id)

    const r = await computeRiskScore(taxYearId)
    const sig = r.critical.find((s) => s.id === "NEEDS_CONTEXT")
    expect(sig).toBeDefined()
    expect(sig!.blocking).toBe(true)
  })
})
