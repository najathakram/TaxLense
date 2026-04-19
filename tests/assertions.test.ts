/**
 * Prompt 6 — QA Assertions tests
 *
 * Covers the 13 lock-gate assertions. Green-fixture test runs the full suite
 * against the seeded fixture and checks the overall shape; targeted tests
 * create offending rows to verify individual assertions fail as expected.
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import {
  runLockAssertions,
  A01_ALL_CLASSIFIED,
  A05_PERSONAL_ZERO,
  A08_MEAL_274D,
  A09_274D_TIER,
} from "../lib/validation/assertions"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

describe("runLockAssertions", () => {
  let taxYearId: string
  const createdIds: { txn: string[]; cls: string[] } = { txn: [], cls: [] }
  let accountId: string

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
    if (createdIds.cls.length) await prisma.classification.deleteMany({ where: { id: { in: createdIds.cls } } })
    if (createdIds.txn.length) await prisma.transaction.deleteMany({ where: { id: { in: createdIds.txn } } })
    await prisma.$disconnect()
  })

  it("returns 13 assertions total", async () => {
    const r = await runLockAssertions(taxYearId)
    expect(r.passed.length + r.failed.length).toBe(13)
  })

  it("A01 flags unclassified transactions", async () => {
    // Create a txn without any classification
    const t = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-06-01"),
        amountOriginal: 100,
        amountNormalized: 100,
        merchantRaw: "UNCLASSIFIED TEST",
        merchantNormalized: "UNCLASSIFIED_TEST",
        idempotencyKey: `test-a01-${Date.now()}`,
      },
    })
    createdIds.txn.push(t.id)

    const result = await A01_ALL_CLASSIFIED(taxYearId)
    expect(result.passed).toBe(false)
    expect(result.blocking).toBe(true)
    expect(result.offendingTransactionIds).toContain(t.id)
  })

  it("A05 flags PERSONAL with non-zero pct", async () => {
    const t = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-06-02"),
        amountOriginal: 50,
        amountNormalized: 50,
        merchantRaw: "BAD PERSONAL",
        merchantNormalized: "BAD_PERSONAL",
        idempotencyKey: `test-a05-${Date.now()}`,
      },
    })
    createdIds.txn.push(t.id)
    const c = await prisma.classification.create({
      data: {
        transactionId: t.id,
        code: "PERSONAL",
        businessPct: 50, // should be 0 for PERSONAL
        ircCitations: ["§262"],
        confidence: 1.0,
        evidenceTier: 3,
        source: "USER",
        isCurrent: true,
      },
    })
    createdIds.cls.push(c.id)

    const result = await A05_PERSONAL_ZERO(taxYearId)
    expect(result.passed).toBe(false)
    expect(result.offendingTransactionIds).toContain(t.id)
  })

  it("A08 flags MEALS without attendees/purpose substantiation", async () => {
    const t = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-06-03"),
        amountOriginal: 80,
        amountNormalized: 80,
        merchantRaw: "UNSUBSTANTIATED MEAL",
        merchantNormalized: "UNSUB_MEAL",
        idempotencyKey: `test-a08-${Date.now()}`,
      },
    })
    createdIds.txn.push(t.id)
    const c = await prisma.classification.create({
      data: {
        transactionId: t.id,
        code: "MEALS_50",
        scheduleCLine: "Line 24b Meals",
        businessPct: 100,
        ircCitations: ["§162", "§274(d)"],
        confidence: 0.9,
        evidenceTier: 3,
        source: "AI",
        isCurrent: true,
        // no substantiation
      },
    })
    createdIds.cls.push(c.id)

    const result = await A08_MEAL_274D(taxYearId)
    expect(result.passed).toBe(false)
    expect(result.offendingTransactionIds).toContain(t.id)
  })

  it("A08 passes when substantiation is complete", async () => {
    const t = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-06-04"),
        amountOriginal: 90,
        amountNormalized: 90,
        merchantRaw: "SUBSTANTIATED MEAL",
        merchantNormalized: "SUB_MEAL",
        idempotencyKey: `test-a08-ok-${Date.now()}`,
      },
    })
    createdIds.txn.push(t.id)
    const c = await prisma.classification.create({
      data: {
        transactionId: t.id,
        code: "MEALS_50",
        scheduleCLine: "Line 24b Meals",
        businessPct: 100,
        ircCitations: ["§162", "§274(d)"],
        confidence: 0.9,
        evidenceTier: 2,
        source: "USER",
        isCurrent: true,
        substantiation: { attendees: "Jane Client", purpose: "Project kickoff" },
      },
    })
    createdIds.cls.push(c.id)
    // Cleanup the broken meal from the previous test first
    await prisma.classification.updateMany({
      where: { transactionId: { in: createdIds.txn }, code: "MEALS_50", substantiation: { equals: null } },
      data: { isCurrent: false },
    })

    const result = await A08_MEAL_274D(taxYearId)
    // This txn should not be an offender
    expect(result.offendingTransactionIds ?? []).not.toContain(t.id)
  })

  it("A09 flags §274(d) rows at tier 4+", async () => {
    const t = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-06-05"),
        amountOriginal: 200,
        amountNormalized: 200,
        merchantRaw: "WEAK 274D",
        merchantNormalized: "WEAK_274D",
        idempotencyKey: `test-a09-${Date.now()}`,
      },
    })
    createdIds.txn.push(t.id)
    const c = await prisma.classification.create({
      data: {
        transactionId: t.id,
        code: "WRITE_OFF_TRAVEL",
        scheduleCLine: "Line 24a Travel",
        businessPct: 100,
        ircCitations: ["§162", "§274(d)"],
        confidence: 0.8,
        evidenceTier: 4, // bad — §274(d) at tier 4
        source: "AI",
        isCurrent: true,
      },
    })
    createdIds.cls.push(c.id)

    const result = await A09_274D_TIER(taxYearId)
    expect(result.passed).toBe(false)
    expect(result.offendingTransactionIds).toContain(t.id)
  })
})
