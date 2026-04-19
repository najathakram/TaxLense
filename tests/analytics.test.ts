/**
 * Analytics builder — integration test against the seed fixture.
 * Verifies buildAnalytics computes a dataset with all 9 chart series populated
 * (or empty-but-defined) without throwing.
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { buildAnalytics } from "../lib/analytics/build"
import { benchmarksForNaics } from "../lib/analytics/irsBenchmarks"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

let taxYearId: string

beforeAll(async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "test@taxlens.local" } })
  const ty = await prisma.taxYear.findFirstOrThrow({ where: { userId: user.id, year: 2025 } })
  taxYearId = ty.id
})

afterAll(() => prisma.$disconnect())

describe("IRS benchmarks", () => {
  it("returns NAICS 71 set for 711510", () => {
    const bench = benchmarksForNaics("711510")
    expect(bench.length).toBeGreaterThan(0)
    expect(bench.find((b) => b.label === "Travel")?.deductionShare).toBe(0.10)
  })

  it("falls back to default for null naics", () => {
    const bench = benchmarksForNaics(null)
    expect(bench.length).toBeGreaterThan(0)
  })
})

describe("buildAnalytics", () => {
  it("returns a fully-shaped dataset for the fixture year", async () => {
    const data = await buildAnalytics(taxYearId)
    expect(data.year).toBe(2025)
    expect(data.charts.deductionMix).toBeDefined()
    expect(data.charts.mealsRatio).toBeDefined()
    expect(data.charts.vehicleGauge).toBeDefined()
    expect(data.charts.depositsWaterfall).toHaveLength(5)
    expect(data.charts.evidenceTierStack).toBeDefined()
    expect(data.charts.monthlyExpense).toBeDefined()
    expect(data.charts.topMerchants).toBeDefined()
    expect(data.charts.accountDonut).toBeDefined()
    expect(data.charts.tripMap).toBeDefined()
    expect(typeof data.grossReceipts).toBe("number")
    expect(typeof data.totalDeductible).toBe("number")
    expect(typeof data.netProfit).toBe("number")
  })

  it("benchmarks for NAICS 711510 include Meals line", async () => {
    const data = await buildAnalytics(taxYearId)
    const meals = data.charts.deductionMix.find((d) => d.label === "Meals")
    expect(meals).toBeDefined()
    expect(meals!.benchmarkShare).toBeGreaterThan(0)
  })
})
