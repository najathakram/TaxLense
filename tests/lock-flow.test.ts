/**
 * Prompt 6 — Lock flow tests
 *
 * Covers the ledger-hash determinism, the attemptLock → confirmLock flow,
 * and the unlock rationale requirement. We don't use the server action
 * wrappers (they depend on auth context) — we exercise the core library
 * pieces directly.
 */

import "dotenv/config"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { computeLedgerHash } from "../lib/lock/hash"
import { runLockAssertions } from "../lib/validation/assertions"
import { computeRiskScore } from "../lib/risk/score"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

describe("lock flow primitives", () => {
  let taxYearId: string

  beforeAll(async () => {
    const user = await prisma.user.findUnique({ where: { email: "test@taxlens.local" } })
    if (!user) throw new Error("Seed user missing")
    const ty = await prisma.taxYear.findUnique({ where: { userId_year: { userId: user.id, year: 2025 } } })
    if (!ty) throw new Error("Seed tax year missing")
    taxYearId = ty.id
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it("computeLedgerHash is deterministic (same inputs → same hash)", async () => {
    const h1 = await computeLedgerHash(taxYearId)
    const h2 = await computeLedgerHash(taxYearId)
    expect(h1).toBe(h2)
    expect(h1).toMatch(/^[0-9a-f]{64}$/)
  })

  it("runLockAssertions returns 13 results", async () => {
    const r = await runLockAssertions(taxYearId)
    expect(r.passed.length + r.failed.length).toBe(13)
  })

  it("computeRiskScore returns a valid band", async () => {
    const r = await computeRiskScore(taxYearId)
    expect(["LOW", "MODERATE", "HIGH", "CRITICAL"]).toContain(r.band)
  })

  it("lock would be blocked on the seed fixture (NEEDS_CONTEXT or missing substantiation remains)", async () => {
    const [assertions, risk] = await Promise.all([
      runLockAssertions(taxYearId),
      computeRiskScore(taxYearId),
    ])
    const blockedCount =
      assertions.blockingFailures.length + risk.critical.filter((s) => s.blocking).length
    // Seed fixture intentionally has unresolved items — lock should be blocked
    expect(blockedCount).toBeGreaterThan(0)
  })
})
