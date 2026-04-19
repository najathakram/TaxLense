/**
 * Trip override + rule application verification — Prompt 4 checklist items 3-5.
 *
 * Creates 3 test MerchantRules (confident / gray / requires_human_input),
 * runs applyMerchantRules, prints the classification results, then removes
 * the test rules so the DB stays clean.
 *
 * Run: pnpm tsx scripts/verify-trip-override.ts
 */
import "dotenv/config"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { applyMerchantRules } from "../lib/classification/apply"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

const TEST_RULE_IDS = [
  "mr_test_adobe",
  "mr_test_rustic_goat",
  "mr_test_bluewave",
]

async function main() {
  const taxYear = await prisma.taxYear.findFirstOrThrow({
    where: { year: 2025, userId: "user_fixture_001" },
  })
  const id = taxYear.id

  // Find normalized merchant keys for the test transactions
  const txSample = await prisma.transaction.findMany({
    where: { taxYearId: id, merchantNormalized: { not: null } },
    select: { id: true, merchantRaw: true, merchantNormalized: true, postedDate: true, amountNormalized: true },
    orderBy: { postedDate: "asc" },
  })

  console.log("\n=== Current Normalized Merchants ===\n")
  txSample.forEach((t) => {
    const date = t.postedDate.toISOString().slice(0, 10)
    const amt = Number(t.amountNormalized.toString()).toFixed(2)
    console.log(`  [${date}] $${amt} | raw="${t.merchantRaw}" → normalized="${t.merchantNormalized}"`)
  })

  // Clean up any leftover test rules from a previous run
  await prisma.merchantRule.deleteMany({ where: { id: { in: TEST_RULE_IDS } } })
  await prisma.classification.deleteMany({
    where: { transaction: { taxYearId: id }, source: "AI" },
  })
  await prisma.classification.updateMany({
    where: { transaction: { taxYearId: id }, isCurrent: false },
    data: { isCurrent: false }, // no-op, just confirming clean state
  })

  // ── 3 test rules ────────────────────────────────────────────────────────────
  // Rule 1: CONFIDENT — Adobe software subscription (100% biz, no trip override)
  await prisma.merchantRule.create({
    data: {
      id: "mr_test_adobe",
      taxYearId: id,
      merchantKey: "ADOBE SYSTEMS",
      code: "WRITE_OFF",
      scheduleCLine: "Line 18 Office Expense",
      businessPctDefault: 100,
      evidenceTierDefault: 2,
      confidence: 0.95,
      ircCitations: ["§162"],
      reasoning: "Adobe Creative Cloud — direct photography/content business software",
      appliesTripOverride: false,
      requiresHumanInput: false,
      humanQuestion: null,
    },
  })

  // Rule 2: GRAY — Restaurant (50% meals, DOES trigger trip override → MEALS_50 100%)
  await prisma.merchantRule.create({
    data: {
      id: "mr_test_rustic_goat",
      taxYearId: id,
      merchantKey: "RUSTIC GOAT ANCHORAGE",
      code: "MEALS_50",
      scheduleCLine: "Line 24b Meals",
      businessPctDefault: 50,
      evidenceTierDefault: 3,
      confidence: 0.70,
      ircCitations: ["§162", "§274(n)"],
      reasoning: "Restaurant — 50% meals deduction default; inside confirmed trip → 100%",
      appliesTripOverride: true,
      requiresHumanInput: false,
      humanQuestion: null,
    },
  })

  // Rule 3: REQUIRES HUMAN INPUT — car wash (vehicle use % unknown)
  await prisma.merchantRule.create({
    data: {
      id: "mr_test_bluewave",
      taxYearId: id,
      merchantKey: "BLUEWAVE CAR WASH",
      code: "GRAY",
      scheduleCLine: "Line 9 Vehicle",
      businessPctDefault: 0,
      evidenceTierDefault: 4,
      confidence: 0.45,
      ircCitations: ["§162", "§274(d)"],
      reasoning: "Car wash — requires vehicle business % to determine deductible portion",
      appliesTripOverride: false,
      requiresHumanInput: true,
      humanQuestion:
        "What percentage of your vehicle use for the {year} tax year was for business? (Your profile says 60% — confirm or override.)",
    },
  })

  console.log("\n=== Created 3 Test MerchantRules ===")
  console.log("  mr_test_adobe       → WRITE_OFF_SOFT, 100%, confidence=0.95 (confident)")
  console.log("  mr_test_rustic_goat → MEALS_50, 50%, tripOverride=true (gray/trip)")
  console.log("  mr_test_bluewave    → GRAY_VEHICLE, 0%, requiresHumanInput=true")

  // ── Run rule application ─────────────────────────────────────────────────────
  console.log("\n=== Running applyMerchantRules… ===\n")
  const result = await applyMerchantRules(id, { force: true })
  console.log(`  classified=${result.classified}  tripOverrides=${result.tripOverrides}  skipped=${result.skipped}`)

  // ── Show classifications for the 3 test merchants ───────────────────────────
  const classifications = await prisma.classification.findMany({
    where: {
      isCurrent: true,
      transaction: { taxYearId: id },
    },
    include: {
      transaction: {
        select: { id: true, merchantRaw: true, merchantNormalized: true, postedDate: true, amountNormalized: true },
      },
    },
    orderBy: { createdAt: "desc" },
  })

  console.log("\n=== Classifications (current) ===\n")
  for (const c of classifications) {
    const date = c.transaction.postedDate.toISOString().slice(0, 10)
    const amt = Number(c.transaction.amountNormalized.toString()).toFixed(2)
    console.log(
      `[${date}] ${c.transaction.merchantNormalized ?? c.transaction.merchantRaw} | $${amt}\n` +
      `  code=${c.code} | pct=${c.businessPct} | confidence=${c.confidence.toFixed(2)} | tier=${c.evidenceTier}\n` +
      `  citations=${c.ircCitations.join(", ")}\n` +
      `  reasoning=${(c.reasoning ?? "").slice(0, 140)}`
    )
    console.log()
  }

  // ── Explicit trip override assertions ────────────────────────────────────────
  console.log("=== Trip Override Verification ===\n")

  // tx_009: UCHIKO AUSTIN, Jan 28 — NOT during any trip — no rule, should be skipped
  // tx_010: RUSTIC GOAT ANCHORAGE, Aug 5 — INSIDE Alaska trip (Aug 2–13) — should be MEALS_50 code but 100% pct
  const rusticGoatClass = classifications.find(
    (c) => (c.transaction.merchantNormalized ?? "").toUpperCase() === "RUSTIC GOAT ANCHORAGE"
  )
  if (rusticGoatClass) {
    const inTrip = rusticGoatClass.transaction.postedDate >= new Date("2025-08-02") &&
      rusticGoatClass.transaction.postedDate <= new Date("2025-08-13")
    const tripOverrideApplied = rusticGoatClass.code === "MEALS_50" && rusticGoatClass.businessPct === 100
    console.log(`RUSTIC GOAT ANCHORAGE (Aug 5):`)
    console.log(`  Date in Alaska trip: ${inTrip ? "✓ YES" : "✗ NO"}`)
    console.log(`  code=${rusticGoatClass.code} pct=${rusticGoatClass.businessPct}`)
    console.log(`  Trip override applied: ${tripOverrideApplied ? "✓ YES (MEALS_50 @ 100%)" : "✗ NO — BUG!"}`)
    console.log(`  reasoning: ${(rusticGoatClass.reasoning ?? "").slice(0, 150)}`)
  } else {
    console.log("RUSTIC GOAT ANCHORAGE: ✗ NOT CLASSIFIED (check merchantNormalized key)")
  }

  console.log()

  // tx_004: ADOBE SYSTEMS — should be WRITE_OFF_SOFT 100%
  const adobeClass = classifications.find(
    (c) => (c.transaction.merchantNormalized ?? "").toUpperCase() === "ADOBE SYSTEMS"
  )
  if (adobeClass) {
    console.log(`ADOBE SYSTEMS (Jan 5):`)
    console.log(`  code=${adobeClass.code} pct=${adobeClass.businessPct} confidence=${adobeClass.confidence.toFixed(2)}`)
    console.log(`  citations=${adobeClass.ircCitations.join(", ")}`)
    console.log(`  OK: ${adobeClass.code === "WRITE_OFF" && adobeClass.businessPct === 100 ? "✓" : "✗ BUG"}`)
  } else {
    console.log("ADOBE SYSTEMS: ✗ NOT CLASSIFIED")
  }

  console.log()

  // tx_015: BLUEWAVE CAR WASH — should be NEEDS_CONTEXT (requiresHumanInput=true)
  const bluewaveClass = classifications.find(
    (c) => (c.transaction.merchantNormalized ?? "").toUpperCase() === "BLUEWAVE CAR WASH"
  )
  if (bluewaveClass) {
    console.log(`BLUEWAVE CAR WASH (Apr 10):`)
    console.log(`  code=${bluewaveClass.code} pct=${bluewaveClass.businessPct}`)
    console.log(`  OK: ${bluewaveClass.code === "NEEDS_CONTEXT" ? "✓ requiresHumanInput promoted to NEEDS_CONTEXT" : "✗ BUG"}`)
  } else {
    console.log("BLUEWAVE CAR WASH: ✗ NOT CLASSIFIED")
  }

  // ── Check STOP items created ─────────────────────────────────────────────────
  console.log("\n=== STOP Items (all pending) ===\n")
  const stops = await prisma.stopItem.findMany({ where: { taxYearId: id, state: "PENDING" } })
  stops.forEach((s) => {
    console.log(`[${s.category}] ${s.question.slice(0, 150)}`)
    console.log(`  context: ${JSON.stringify(s.context).slice(0, 200)}`)
    console.log()
  })

  // ── Clean up test rules + classifications ────────────────────────────────────
  console.log("=== Cleaning up test rules and classifications… ===")
  await prisma.classification.deleteMany({
    where: { transaction: { taxYearId: id }, source: "AI" },
  })
  await prisma.merchantRule.deleteMany({ where: { id: { in: TEST_RULE_IDS } } })
  console.log("  ✓ Removed test MerchantRules and AI-source Classifications")
  console.log("\n=== Verification complete ===")

  await prisma.$disconnect()
}

main().catch(console.error)
