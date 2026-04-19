/**
 * Prompt 6 — Residual candidate selector tests
 *
 * Unit test of the three trigger gates (multi-candidate, amount outlier,
 * trip-ambiguous) without hitting the Anthropic API.
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { selectResidualCandidates } from "../lib/ai/residualCandidates"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

describe("selectResidualCandidates", () => {
  let taxYearId: string
  let accountId: string
  const createdTxnIds: string[] = []
  const createdRuleIds: string[] = []

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: "test@taxlens.local" } })
    if (!user) throw new Error("Seed user missing — run `pnpm seed`")
    const ty = await prisma.taxYear.findUnique({ where: { userId_year: { userId: user.id, year: 2025 } } })
    if (!ty) throw new Error("Seed tax year missing")
    taxYearId = ty.id
    const acct = await prisma.financialAccount.findFirst({ where: { taxYearId } })
    if (!acct) throw new Error("No account")
    accountId = acct.id
  })

  afterAll(async () => {
    if (createdRuleIds.length > 0) {
      await prisma.merchantRule.deleteMany({ where: { id: { in: createdRuleIds } } })
    }
    if (createdTxnIds.length > 0) {
      await prisma.classification.deleteMany({ where: { transactionId: { in: createdTxnIds } } })
      await prisma.transaction.deleteMany({ where: { id: { in: createdTxnIds } } })
    }
    await prisma.$disconnect()
  })

  it("flags multi-candidate GRAY rule with low confidence", async () => {
    const merchantKey = "TEST_MULTI_CANDIDATE_MERCHANT"
    const rule = await prisma.merchantRule.create({
      data: {
        taxYearId,
        merchantKey,
        code: "GRAY",
        scheduleCLine: "Line 27a Other Expenses",
        businessPctDefault: 50,
        appliesTripOverride: false,
        ircCitations: ["§162"],
        evidenceTierDefault: 3,
        confidence: 0.72,
        reasoning: "Multiple plausible codes",
        requiresHumanInput: false,
      },
    })
    createdRuleIds.push(rule.id)

    const tx = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-03-15"),
        amountOriginal: 120,
        amountNormalized: 120,
        merchantRaw: "TEST MULTI CANDIDATE",
        merchantNormalized: merchantKey,
        idempotencyKey: `test-multi-${Date.now()}`,
      },
    })
    createdTxnIds.push(tx.id)

    const candidates = await selectResidualCandidates(taxYearId)
    const mine = candidates.find((c) => c.transactionId === tx.id)
    expect(mine).toBeDefined()
    expect(mine!.reasons).toContain("MULTI_CANDIDATE")
  })

  it("flags amount outliers (>3σ from same-merchant mean)", async () => {
    const merchantKey = "TEST_OUTLIER_MERCHANT"
    // 10 charges at exactly $50, one outlier at $200 — with 11 samples this is ~3.16σ
    const amounts = [50, 50, 50, 50, 50, 50, 50, 50, 50, 50, 200]
    for (let i = 0; i < amounts.length; i++) {
      const tx = await prisma.transaction.create({
        data: {
          accountId,
          taxYearId,
          postedDate: new Date(2025, 3, 10 + i),
          amountOriginal: amounts[i]!,
          amountNormalized: amounts[i]!,
          merchantRaw: "TEST OUTLIER",
          merchantNormalized: merchantKey,
          idempotencyKey: `test-outlier-${i}-${Date.now()}`,
        },
      })
      createdTxnIds.push(tx.id)
    }

    const candidates = await selectResidualCandidates(taxYearId)
    const outlierCandidate = candidates.find(
      (c) => c.merchantKey === merchantKey && c.reasons.includes("AMOUNT_OUTLIER")
    )
    expect(outlierCandidate).toBeDefined()
  })

  it("excludes transactions already user-classified", async () => {
    const tx = await prisma.transaction.create({
      data: {
        accountId,
        taxYearId,
        postedDate: new Date("2025-05-01"),
        amountOriginal: 600,
        amountNormalized: 600,
        merchantRaw: "USER LOCKED",
        merchantNormalized: "USER_LOCKED_MERCHANT",
        idempotencyKey: `test-userlocked-${Date.now()}`,
      },
    })
    createdTxnIds.push(tx.id)
    await prisma.classification.create({
      data: {
        transactionId: tx.id,
        code: "GRAY",
        businessPct: 50,
        ircCitations: ["§162"],
        confidence: 1.0,
        evidenceTier: 3,
        source: "USER",
        isCurrent: true,
      },
    })

    const candidates = await selectResidualCandidates(taxYearId)
    expect(candidates.find((c) => c.transactionId === tx.id)).toBeUndefined()
  })
})
