/**
 * B-23: confirmRiskOverride suppresses non-blocking signals on the risk
 * dashboard.
 *
 * Setup: inject an income source with an expected total, leave actual
 * BIZ_INCOME below it, expect INCOME_SHORT to surface; set the override on
 * the year, recompute, expect it gone.
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { computeRiskScore } from "../lib/risk/score"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

describe("acceptedRiskOverrides suppresses INCOME_SHORT (B-23)", () => {
  let taxYearId: string
  let priorOverrides: unknown
  let priorIncomeSources: unknown

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: "test@taxlens.local" } })
    if (!user) throw new Error("Seed user missing — run `pnpm seed`")
    const ty = await prisma.taxYear.findUnique({
      where: { userId_year: { userId: user.id, year: 2025 } },
    })
    if (!ty) throw new Error("Seed tax year missing")
    taxYearId = ty.id
    priorOverrides = ty.acceptedRiskOverrides

    // Inject an income source with a high expected total so INCOME_SHORT
    // fires regardless of seed BIZ_INCOME state.
    const profile = await prisma.businessProfile.findUnique({ where: { taxYearId } })
    priorIncomeSources = profile?.incomeSources
    await prisma.businessProfile.update({
      where: { taxYearId },
      data: {
        incomeSources: [
          { platform: "Pocketsflow", expectedTotal: 100000 },
        ] as never,
      },
    })

    // Make sure no override is set at the start.
    await prisma.taxYear.update({
      where: { id: taxYearId },
      data: { acceptedRiskOverrides: {} as never },
    })
  })

  afterAll(async () => {
    // Restore prior state.
    await prisma.businessProfile.update({
      where: { taxYearId },
      data: { incomeSources: (priorIncomeSources ?? null) as never },
    })
    await prisma.taxYear.update({
      where: { id: taxYearId },
      data: { acceptedRiskOverrides: (priorOverrides ?? null) as never },
    })
    await prisma.$disconnect()
  })

  it("INCOME_SHORT surfaces when expectedIncome > actual and no override is set", async () => {
    const r = await computeRiskScore(taxYearId)
    const all = [...r.critical, ...r.high, ...r.medium, ...r.low]
    expect(all.some((s) => s.id === "INCOME_SHORT")).toBe(true)
  })

  it("INCOME_SHORT disappears once acceptedRiskOverrides[INCOME_SHORT] = true", async () => {
    await prisma.taxYear.update({
      where: { id: taxYearId },
      data: {
        acceptedRiskOverrides: {
          INCOME_SHORT: true,
          INCOME_SHORT_rationale: "Q4 1099-K timing — variance is timing only.",
        } as never,
      },
    })
    const r = await computeRiskScore(taxYearId)
    const all = [...r.critical, ...r.high, ...r.medium, ...r.low]
    expect(all.some((s) => s.id === "INCOME_SHORT")).toBe(false)
  })
})
