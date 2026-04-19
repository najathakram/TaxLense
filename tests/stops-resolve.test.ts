/**
 * Session 5 — STOP resolution tests
 *
 * Covers:
 *  - deriveFromAnswer mapping for each StopAnswer kind (pure unit)
 *  - DB flip-and-insert pattern: flipping prior Classifications and inserting new ones
 *    inside a Prisma $transaction, mimicking what resolveStop does.
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { deriveFromAnswer, type StopAnswer } from "../lib/stops/derive"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

describe("deriveFromAnswer", () => {
  it("merchant ALL_BUSINESS → WRITE_OFF 100%", () => {
    const d = deriveFromAnswer({ kind: "merchant", choice: "ALL_BUSINESS" })
    expect(d.code).toBe("WRITE_OFF")
    expect(d.businessPct).toBe(100)
    expect(d.ircCitations).toContain("§162")
  })

  it("merchant PERSONAL → PERSONAL 0% § 262", () => {
    const d = deriveFromAnswer({ kind: "merchant", choice: "PERSONAL" })
    expect(d.code).toBe("PERSONAL")
    expect(d.businessPct).toBe(0)
    expect(d.ircCitations).toContain("§262")
  })

  it("merchant DURING_TRIPS → WRITE_OFF_TRAVEL 100%, cites §274(d)", () => {
    const d = deriveFromAnswer({ kind: "merchant", choice: "DURING_TRIPS" })
    expect(d.code).toBe("WRITE_OFF_TRAVEL")
    expect(d.businessPct).toBe(100)
    expect(d.ircCitations).toContain("§274(d)")
    expect(d.scheduleCLine).toBe("Line 24a Travel")
  })

  it("merchant MIXED_50 → GRAY 50%", () => {
    const d = deriveFromAnswer({ kind: "merchant", choice: "MIXED_50" })
    expect(d.code).toBe("GRAY")
    expect(d.businessPct).toBe(50)
  })

  it("merchant confirming AI PERSONAL suggestion → source=AI_USER_CONFIRMED", () => {
    const d = deriveFromAnswer(
      { kind: "merchant", choice: "PERSONAL" },
      { ruleCode: "PERSONAL", ruleLine: null }
    )
    expect(d.source).toBe("AI_USER_CONFIRMED")
  })

  it("merchant PERSONAL when AI said WRITE_OFF → source=USER", () => {
    const d = deriveFromAnswer(
      { kind: "merchant", choice: "PERSONAL" },
      { ruleCode: "WRITE_OFF", ruleLine: "Line 18 Office Expense" }
    )
    expect(d.source).toBe("USER")
  })

  it("transfer CONTRACTOR → WRITE_OFF contract labor", () => {
    const d = deriveFromAnswer({
      kind: "transfer",
      choice: "CONTRACTOR",
      payeeName: "Bob",
      purpose: "editing",
    })
    expect(d.code).toBe("WRITE_OFF")
    expect(d.scheduleCLine).toBe("Line 11 Contract Labor")
    expect(d.reasoning).toMatch(/Bob/)
  })

  it("transfer LOAN → TRANSFER non-deductible", () => {
    const d = deriveFromAnswer({ kind: "transfer", choice: "LOAN" })
    expect(d.code).toBe("TRANSFER")
    expect(d.businessPct).toBe(0)
  })

  it("deposit CLIENT → BIZ_INCOME", () => {
    const d = deriveFromAnswer({ kind: "deposit", choice: "CLIENT" })
    expect(d.code).toBe("BIZ_INCOME")
    expect(d.scheduleCLine).toMatch(/Gross Receipts/)
  })

  it("deposit OWNER_CONTRIB → TRANSFER 0%", () => {
    const d = deriveFromAnswer({ kind: "deposit", choice: "OWNER_CONTRIB" })
    expect(d.code).toBe("TRANSFER")
    expect(d.businessPct).toBe(0)
  })

  it("section_274d → MEALS_50 100% with citations", () => {
    const d = deriveFromAnswer({
      kind: "section_274d",
      attendees: "Jane Client",
      relationship: "CLIENT",
      purpose: "Project kickoff",
      outcome: "Signed MSA",
    })
    expect(d.code).toBe("MEALS_50")
    expect(d.businessPct).toBe(100)
    expect(d.ircCitations).toEqual(expect.arrayContaining(["§274(d)", "§274(n)(1)"]))
    expect(d.reasoning).toMatch(/Jane Client/)
    expect(d.reasoning).toMatch(/Signed MSA/)
  })
})

// ---------------------------------------------------------------------------
// DB-level flip-and-insert test mirroring resolveStop's core Prisma pattern
// ---------------------------------------------------------------------------

describe("flip-and-insert classification pattern", () => {
  let taxYearId: string
  let txnIds: string[] = []
  const testIds: string[] = []

  beforeAll(async () => {
    // Find seeded fixture
    const user = await prisma.user.findUnique({ where: { email: "test@taxlens.local" } })
    if (!user) throw new Error("Seed user missing — run `pnpm seed`")
    const ty = await prisma.taxYear.findUnique({
      where: { userId_year: { userId: user.id, year: 2025 } },
    })
    if (!ty) throw new Error("Seed tax year missing")
    taxYearId = ty.id

    // Pick 3 seeded transactions to use in this test
    const txns = await prisma.transaction.findMany({
      where: { taxYearId },
      take: 3,
    })
    txnIds = txns.map((t) => t.id)
  })

  afterAll(async () => {
    // Clean classification rows we inserted
    await prisma.classification.deleteMany({
      where: { id: { in: testIds } },
    })
    await prisma.$disconnect()
  })

  it("flip + insert: exactly one is_current=true row per txn after operation", async () => {
    const answer: StopAnswer = { kind: "merchant", choice: "PERSONAL" }
    const derived = deriveFromAnswer(answer)

    await prisma.$transaction(async (tx) => {
      for (const txId of txnIds) {
        await tx.classification.updateMany({
          where: { transactionId: txId, isCurrent: true },
          data: { isCurrent: false },
        })
        const c = await tx.classification.create({
          data: {
            transactionId: txId,
            code: derived.code,
            scheduleCLine: derived.scheduleCLine,
            businessPct: derived.businessPct,
            ircCitations: derived.ircCitations,
            confidence: 1.0,
            evidenceTier: derived.evidenceTier,
            source: derived.source,
            reasoning: derived.reasoning,
            isCurrent: true,
          },
        })
        testIds.push(c.id)
      }
    })

    for (const txId of txnIds) {
      const currents = await prisma.classification.findMany({
        where: { transactionId: txId, isCurrent: true },
      })
      expect(currents.length).toBe(1)
      expect(currents[0]!.code).toBe("PERSONAL")
      expect(currents[0]!.businessPct).toBe(0)
    }
  })
})
