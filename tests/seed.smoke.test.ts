/**
 * TaxLens — Prompt 1 smoke tests
 *
 * Verifies the spec-correct Maznah Media fixture is seeded properly.
 * Fixture: test@taxlens.local | NAICS 711510 | wedding photography / travel content
 * Runs against the local development database (DATABASE_URL in .env).
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

let userId: string
let taxYearId: string

beforeAll(async () => {
  const user = await prisma.user.findUniqueOrThrow({ where: { email: "test@taxlens.local" } })
  userId = user.id
  const ty = await prisma.taxYear.findFirstOrThrow({ where: { userId, year: 2025 } })
  taxYearId = ty.id
})

afterAll(() => prisma.$disconnect())

describe("Seed smoke tests", () => {
  it("fixture user test@taxlens.local exists with bcrypt password", async () => {
    const user = await prisma.user.findUnique({
      where: { email: "test@taxlens.local" },
    })
    expect(user).not.toBeNull()
    expect(user!.name).toBe("Najath Akram")
    expect(user!.password).toBeTruthy()
    expect(user!.password).toMatch(/^\$2[ab]\$/) // valid bcrypt prefix
  })

  it("TaxYear 2025 exists with CREATED status", async () => {
    const ty = await prisma.taxYear.findFirstOrThrow({ where: { userId, year: 2025 } })
    expect(ty.status).toBe("CREATED")
    expect(ty.ruleVersionId).toBe("rv_2025_001")
  })

  it("BusinessProfile is NAICS 711510 (photography/creator) in TX", async () => {
    const ty = await prisma.taxYear.findFirstOrThrow({
      where: { userId, year: 2025 },
      include: { businessProfile: true },
    })
    expect(ty.businessProfile).not.toBeNull()
    expect(ty.businessProfile!.naicsCode).toBe("711510")
    expect(ty.businessProfile!.entityType).toBe("SOLE_PROP")
    expect(ty.businessProfile!.primaryState).toBe("TX")
  })

  it("exactly 5 FinancialAccounts for TaxYear 2025", async () => {
    const count = await prisma.financialAccount.count({ where: { taxYearId } })
    expect(count).toBe(5)
  })

  it("exactly 20 Transactions for TaxYear 2025", async () => {
    const count = await prisma.transaction.count({ where: { taxYearId } })
    expect(count).toBe(20)
  })

  it("zero Classifications seeded (AI fills these in Prompt 4)", async () => {
    const count = await prisma.classification.count({
      where: { transaction: { taxYearId } },
    })
    expect(count).toBe(0)
  })

  it("transfer pair tx_019 / tx_020 linked bidirectionally", async () => {
    const tx019 = await prisma.transaction.findUnique({ where: { id: "tx_019" } })
    const tx020 = await prisma.transaction.findUnique({ where: { id: "tx_020" } })
    expect(tx019).not.toBeNull()
    expect(tx020).not.toBeNull()
    expect(tx019!.isTransferPairedWith).toBe("tx_020")
    expect(tx020!.isTransferPairedWith).toBe("tx_019")
  })

  it("two RuleVersions exist, rv2024 superseded by rv2025", async () => {
    const count = await prisma.ruleVersion.count()
    expect(count).toBeGreaterThanOrEqual(2)

    const rv2024 = await prisma.ruleVersion.findUnique({ where: { id: "rv_2024_001" } })
    expect(rv2024!.supersededById).toBe("rv_2025_001")
  })
})
