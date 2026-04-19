/**
 * Session 5 — Amazon split tests
 *
 * Covers:
 *  - Split sum must equal parent amount (validated)
 *  - splitOf linkage + isSplit=true on parent
 *  - Reports query must exclude parent (isSplit=true), include children
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { MAX_SPLITS_PER_TRANSACTION, AMAZON_MERCHANT_PATTERN } from "../lib/splits/config"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

describe("split config", () => {
  it("pattern matches Amazon and Amzn variants", () => {
    expect(AMAZON_MERCHANT_PATTERN.test("AMAZON.COM*A1B2C3")).toBe(true)
    expect(AMAZON_MERCHANT_PATTERN.test("AMZN MKTP US")).toBe(true)
    expect(AMAZON_MERCHANT_PATTERN.test("WHOLE FOODS MKT")).toBe(false)
  })

  it("max splits is 5", () => {
    expect(MAX_SPLITS_PER_TRANSACTION).toBe(5)
  })
})

describe("split validation logic", () => {
  it("detects sum mismatch in cents (would reject)", () => {
    const parent = 99.99
    const splits = [33.33, 33.33, 33.32]
    const parentCents = Math.round(parent * 100)
    const sumCents = splits.reduce((s, x) => s + Math.round(x * 100), 0)
    expect(sumCents).toBe(9998)
    expect(parentCents).toBe(9999)
    expect(parentCents).not.toBe(sumCents)
  })

  it("accepts exact sum", () => {
    const parent = 100.0
    const splits = [40.0, 30.0, 30.0]
    const parentCents = Math.round(parent * 100)
    const sumCents = splits.reduce((s, x) => s + Math.round(x * 100), 0)
    expect(parentCents).toBe(sumCents)
  })

  it("floating point: 0.1 + 0.2 via cents rounding still equals 30", () => {
    const parent = 0.3
    const splits = [0.1, 0.1, 0.1]
    const parentCents = Math.round(parent * 100)
    const sumCents = splits.reduce((s, x) => s + Math.round(x * 100), 0)
    expect(parentCents).toBe(sumCents)
  })
})

// ---------------------------------------------------------------------------
// DB integration: create a synthetic parent, split it, verify
// ---------------------------------------------------------------------------

describe("split DB operations", () => {
  let taxYearId: string
  let accountId: string
  let parentId: string
  const childIds: string[] = []

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: "test@taxlens.local" } })
    if (!user) throw new Error("Seed user missing")
    const ty = await prisma.taxYear.findUnique({
      where: { userId_year: { userId: user.id, year: 2025 } },
    })
    if (!ty) throw new Error("Seed tax year missing")
    taxYearId = ty.id

    const acct = await prisma.financialAccount.findFirst({ where: { userId: user.id } })
    if (!acct) throw new Error("No seed account")
    accountId = acct.id

    // Create synthetic Amazon parent txn
    parentId = `test_split_parent_${Date.now()}`
    await prisma.transaction.create({
      data: {
        id: parentId,
        accountId,
        taxYearId,
        postedDate: new Date("2025-06-15"),
        amountOriginal: "100.00",
        amountNormalized: "100.00",
        merchantRaw: "AMAZON.COM TEST",
        merchantNormalized: "AMAZON",
        idempotencyKey: `test_split_idem_${Date.now()}`,
      },
    })
  })

  afterAll(async () => {
    // Cleanup
    await prisma.classification.deleteMany({
      where: { transactionId: { in: [parentId, ...childIds] } },
    })
    await prisma.transaction.deleteMany({
      where: { id: { in: childIds } },
    })
    await prisma.transaction.deleteMany({ where: { id: parentId } })
    await prisma.$disconnect()
  })

  it("splits parent into children with splitOfId; parent flagged isSplit", async () => {
    const splits = [
      { amount: 40, code: "WRITE_OFF" as const, line: "Line 18 Office Expense" },
      { amount: 35, code: "WRITE_OFF" as const, line: "Line 22 Supplies" },
      { amount: 25, code: "PERSONAL" as const, line: null as string | null },
    ]

    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < splits.length; i++) {
        const s = splits[i]!
        const childId = `${parentId}_s${i}`
        await tx.transaction.create({
          data: {
            id: childId,
            accountId,
            taxYearId,
            postedDate: new Date("2025-06-15"),
            amountOriginal: s.amount.toFixed(2),
            amountNormalized: s.amount.toFixed(2),
            merchantRaw: `AMAZON.COM TEST [split ${i + 1}/3]`,
            merchantNormalized: "AMAZON",
            idempotencyKey: `${parentId}|split|${i}|${Math.round(s.amount * 100)}`,
            splitOfId: parentId,
          },
        })
        await tx.classification.create({
          data: {
            transactionId: childId,
            code: s.code,
            scheduleCLine: s.line,
            businessPct: s.code === "PERSONAL" ? 0 : 100,
            ircCitations: s.code === "PERSONAL" ? ["§262"] : ["§162"],
            confidence: 1.0,
            evidenceTier: 3,
            source: "USER",
            reasoning: `Split ${i + 1}`,
            isCurrent: true,
          },
        })
        childIds.push(childId)
      }
      await tx.transaction.update({
        where: { id: parentId },
        data: { isSplit: true },
      })
    })

    // Parent marked
    const parent = await prisma.transaction.findUnique({ where: { id: parentId } })
    expect(parent?.isSplit).toBe(true)

    // 3 children, all linked
    const children = await prisma.transaction.findMany({ where: { splitOfId: parentId } })
    expect(children.length).toBe(3)

    // Sum of children equals parent
    const sum = children.reduce((acc, c) => acc + Number(c.amountNormalized.toString()), 0)
    expect(Math.round(sum * 100)).toBe(10000)

    // Reports query: exclude isSplit parents, include children
    const reportRows = await prisma.transaction.findMany({
      where: {
        taxYearId,
        isSplit: false,
        id: { in: [parentId, ...childIds] },
      },
    })
    const reportIds = reportRows.map((r) => r.id).sort()
    expect(reportIds).toEqual(childIds.slice().sort())
    expect(reportIds).not.toContain(parentId)
  })
})
