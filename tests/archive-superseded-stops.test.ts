/**
 * Auto-archive superseded STOPs (B-09).
 *
 * Verifies archiveSupersededStopsForYear closes PENDING StopItems whose
 * underlying transactions now have a current Classification — without this,
 * Atif's TY2025 keeps 47 stale STOPs for years even after the agent's
 * classifications make them moot.
 */
import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { archiveSupersededStopsForYear } from "../lib/stops/archiveSuperseded"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

describe("archiveSupersededStopsForYear (B-09)", () => {
  let taxYearId: string
  let txnIdClassified: string
  let txnIdUnclassified: string
  const createdStopIds: string[] = []
  const createdClsIds: string[] = []

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: "test@taxlens.local" } })
    if (!user) throw new Error("Seed user missing — run `pnpm seed`")
    const ty = await prisma.taxYear.findUnique({
      where: { userId_year: { userId: user.id, year: 2025 } },
    })
    if (!ty) throw new Error("Seed tax year missing")
    taxYearId = ty.id

    const txns = await prisma.transaction.findMany({
      where: { taxYearId },
      take: 2,
    })
    if (txns.length < 2) throw new Error("Need at least 2 fixture transactions")
    txnIdClassified = txns[0]!.id
    txnIdUnclassified = txns[1]!.id

    // Stop A: covers a transaction we *will* classify — should auto-archive.
    const stopA = await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "MERCHANT",
        question: "test stop A",
        context: { test: true },
        transactionIds: [txnIdClassified],
        state: "PENDING",
      },
    })
    createdStopIds.push(stopA.id)

    // Stop B: covers a transaction with no classification — should be skipped.
    const stopB = await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "MERCHANT",
        question: "test stop B",
        context: { test: true },
        transactionIds: [txnIdUnclassified],
        state: "PENDING",
      },
    })
    createdStopIds.push(stopB.id)

    // Stop C: empty transactionIds — empty STOPs auto-archive too.
    const stopC = await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "MERCHANT",
        question: "test stop C (empty)",
        context: { test: true },
        transactionIds: [],
        state: "PENDING",
      },
    })
    createdStopIds.push(stopC.id)

    // Mark all prior current classifications on the test transactions as
    // historical so we don't conflict with seed data.
    await prisma.classification.updateMany({
      where: { transactionId: { in: [txnIdClassified, txnIdUnclassified] }, isCurrent: true },
      data: { isCurrent: false },
    })

    // Insert exactly one current Classification on the "should-archive" txn.
    const cls = await prisma.classification.create({
      data: {
        transactionId: txnIdClassified,
        code: "WRITE_OFF",
        scheduleCLine: "Line 27a Other Expenses",
        businessPct: 100,
        ircCitations: ["§162"],
        confidence: 0.95,
        evidenceTier: 2,
        source: "AI",
        reasoning: "test classification for B-09",
        isCurrent: true,
      },
    })
    createdClsIds.push(cls.id)
  })

  afterAll(async () => {
    if (createdStopIds.length) {
      await prisma.stopItem.deleteMany({ where: { id: { in: createdStopIds } } })
    }
    if (createdClsIds.length) {
      await prisma.classification.updateMany({
        where: { id: { in: createdClsIds } },
        data: { isCurrent: false },
      })
      await prisma.classification.deleteMany({ where: { id: { in: createdClsIds } } })
    }
    await prisma.$disconnect()
  })

  it("archives a stop whose transaction now has a current classification", async () => {
    const result = await archiveSupersededStopsForYear(taxYearId)
    expect(result.archived).toBeGreaterThanOrEqual(2) // stop A + empty stop C

    const after = await prisma.stopItem.findMany({
      where: { id: { in: createdStopIds } },
      select: { id: true, state: true, userAnswer: true },
    })
    const byId = new Map(after.map((s) => [s.id, s]))
    expect(byId.get(createdStopIds[0]!)?.state).toBe("ANSWERED")
    expect(byId.get(createdStopIds[1]!)?.state).toBe("PENDING") // unclassified — preserved
    expect(byId.get(createdStopIds[2]!)?.state).toBe("ANSWERED") // empty — auto-closed

    // Audit signature on the archived rows
    const ans = byId.get(createdStopIds[0]!)?.userAnswer as Record<string, unknown> | null
    expect(ans?.autoArchivedAsSuperseded).toBe(true)
  })

  it("re-running is a no-op (idempotent)", async () => {
    const result = await archiveSupersededStopsForYear(taxYearId)
    expect(result.archived).toBe(0)
    expect(result.skipped).toBeGreaterThanOrEqual(0)
  })
})
