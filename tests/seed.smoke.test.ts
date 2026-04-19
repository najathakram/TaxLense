/**
 * TaxLens — Session 1 smoke tests
 *
 * Verifies the seed data is present and the schema is wired correctly.
 * Runs against the local development database (DATABASE_URL in .env).
 */

import "dotenv/config"
import { describe, it, expect, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

afterAll(() => prisma.$disconnect())

describe("Seed smoke tests", () => {
  it("user Najath exists", async () => {
    const user = await prisma.user.findUnique({
      where: { email: "najathakram1@gmail.com" },
    })
    expect(user).not.toBeNull()
    expect(user!.name).toBe("Najath Akram")
    expect(user!.password).toBeTruthy() // bcrypt hash present
  })

  it("TaxYear 2025 exists with CLASSIFICATION status", async () => {
    const ty = await prisma.taxYear.findFirst({
      where: { year: 2025 },
    })
    expect(ty).not.toBeNull()
    expect(ty!.status).toBe("CLASSIFICATION")
    expect(ty!.ruleVersionId).toBeTruthy()
  })

  it("BusinessProfile is linked to TaxYear 2025", async () => {
    const ty = await prisma.taxYear.findFirst({
      where: { year: 2025 },
      include: { businessProfile: true },
    })
    expect(ty!.businessProfile).not.toBeNull()
    expect(ty!.businessProfile!.naicsCode).toBe("541511")
    expect(ty!.businessProfile!.entityType).toBe("SOLE_PROP")
  })

  it("exactly 5 FinancialAccounts for TaxYear 2025", async () => {
    const ty = await prisma.taxYear.findFirst({ where: { year: 2025 } })
    const count = await prisma.financialAccount.count({
      where: { taxYearId: ty!.id },
    })
    expect(count).toBe(5)
  })

  it("exactly 20 Transactions for TaxYear 2025", async () => {
    const ty = await prisma.taxYear.findFirst({ where: { year: 2025 } })
    const count = await prisma.transaction.count({
      where: { taxYearId: ty!.id },
    })
    expect(count).toBe(20)
  })

  it("all 20 Transactions have a current Classification", async () => {
    const ty = await prisma.taxYear.findFirst({ where: { year: 2025 } })
    const txCount = await prisma.transaction.count({ where: { taxYearId: ty!.id } })
    const classifiedCount = await prisma.classification.count({
      where: {
        isCurrent: true,
        transaction: { taxYearId: ty!.id },
      },
    })
    expect(classifiedCount).toBe(txCount)
  })

  it("transfer pair is linked bidirectionally", async () => {
    const tx015 = await prisma.transaction.findUnique({ where: { id: "tx_015" } })
    const tx016 = await prisma.transaction.findUnique({ where: { id: "tx_016" } })
    expect(tx015!.isTransferPairedWith).toBe("tx_016")
    expect(tx016!.isTransferPairedWith).toBe("tx_015")
  })

  it("two RuleVersions exist, rv2024 is superseded by rv2025", async () => {
    const count = await prisma.ruleVersion.count()
    expect(count).toBeGreaterThanOrEqual(2)

    const rv2024 = await prisma.ruleVersion.findUnique({ where: { id: "rv_2024_001" } })
    expect(rv2024!.supersededById).toBe("rv_2025_001")
  })
})
