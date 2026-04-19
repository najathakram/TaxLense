/**
 * Pipeline runner for manual verification — Prompt 4 human checklist.
 * Run: pnpm tsx scripts/run-pipeline.ts
 */
import "dotenv/config"
import { PrismaClient } from "../app/generated/prisma/client"
import { PrismaPg } from "@prisma/adapter-pg"
import { normalizeMerchantsForYear, applyMerchantRules } from "../lib/classification/apply"
import { matchTransfers } from "../lib/pairing/transfers"
import { matchCardPayments } from "../lib/pairing/payments"
import { matchRefunds } from "../lib/pairing/refunds"
import { runMerchantIntelligence } from "../lib/ai/merchantIntelligence"

const adapter = new PrismaPg({ connectionString: process.env["DATABASE_URL"]! })
const prisma = new PrismaClient({ adapter })

async function main() {
  // Find the fixture tax year (userId = user_fixture_001 from pnpm seed)
  const taxYear = await prisma.taxYear.findFirstOrThrow({
    where: { year: 2025, userId: "user_fixture_001" },
  })
  const id = taxYear.id
  console.log(`\n=== TaxLens Pipeline — TaxYear ${taxYear.year} (${id}) ===\n`)

  // Step 1: Normalize merchants
  console.log("Step 1: Normalizing merchants…")
  const normalized = await normalizeMerchantsForYear(id)
  console.log(`  ✓ Updated merchantNormalized on ${normalized} transactions\n`)

  // Peek at normalized merchants
  const merchants = await prisma.transaction.findMany({
    where: { taxYearId: id, merchantNormalized: { not: null } },
    select: { merchantRaw: true, merchantNormalized: true },
    distinct: ["merchantNormalized"],
    take: 10,
  })
  console.log("  Sample normalized merchants:")
  merchants.forEach((t) => console.log(`    "${t.merchantRaw}" → "${t.merchantNormalized}"`))
  console.log()

  // Step 2: Match transfers
  console.log("Step 2: Matching transfers…")
  const transferResult = await matchTransfers(id)
  console.log(`  ✓ ${transferResult.paired} transfer pairs | ${transferResult.stopItemsCreated} STOP items\n`)

  // Step 3: Match card payments
  console.log("Step 3: Matching card payments…")
  const payResult = await matchCardPayments(id)
  console.log(`  ✓ ${payResult.paired} payment pairs\n`)

  // Step 4: Match refunds
  console.log("Step 4: Matching refunds…")
  const refundResult = await matchRefunds(id)
  console.log(`  ✓ ${refundResult.paired} refund pairs\n`)

  // Step 5: Merchant Intelligence AI
  console.log("Step 5: Running Merchant Intelligence Agent…")
  if (!process.env["ANTHROPIC_API_KEY"]) {
    console.log("  ⚠  ANTHROPIC_API_KEY not set — skipping live AI call\n")
  } else {
    const aiResult = await runMerchantIntelligence(id)
    console.log(`  ✓ ${aiResult.merchantsProcessed} merchants processed | ${aiResult.rulesCreated} rules created | ${aiResult.stopsGenerated} STOPs\n`)
  }

  // Step 6: Apply rules
  console.log("Step 6: Applying rules…")
  const applyResult = await applyMerchantRules(id)
  console.log(`  ✓ ${applyResult.classified} classified | ${applyResult.tripOverrides} trip overrides | ${applyResult.skipped} skipped\n`)

  // === VERIFICATION REPORT ===
  console.log("=== VERIFICATION REPORT ===\n")

  // Total transactions
  const total = await prisma.transaction.count({ where: { taxYearId: id, isDuplicateOf: null } })
  const withClass = await prisma.classification.count({ where: { transaction: { taxYearId: id }, isCurrent: true } })
  const transferCount = await prisma.transaction.count({ where: { taxYearId: id, isTransferPairedWith: { not: null } } })
  const paymentCount = await prisma.transaction.count({ where: { taxYearId: id, isPaymentPairedWith: { not: null } } })
  const refundCount = await prisma.transaction.count({ where: { taxYearId: id, isRefundPairedWith: { not: null } } })
  const stopCount = await prisma.stopItem.count({ where: { taxYearId: id, state: "PENDING" } })
  const merchantRuleCount = await prisma.merchantRule.count({ where: { taxYearId: id } })

  console.log(`Transactions: ${total}`)
  console.log(`Classifications (current): ${withClass}`)
  console.log(`Transfer pairs: ${transferCount / 2} pairs (${transferCount} rows marked)`)
  console.log(`Payment pairs: ${paymentCount / 2} pairs (${paymentCount} rows marked)`)
  console.log(`Refund pairs: ${refundCount}`)
  console.log(`Merchant rules: ${merchantRuleCount}`)
  console.log(`STOPs pending: ${stopCount}`)

  // Sample 20 classifications
  const sample = await prisma.classification.findMany({
    where: { isCurrent: true },
    include: { transaction: { select: { merchantRaw: true, merchantNormalized: true, postedDate: true, amountNormalized: true } } },
    take: 20,
    orderBy: { createdAt: "desc" },
  })

  console.log("\n=== SAMPLE CLASSIFICATIONS (latest 20) ===\n")
  sample.forEach((c) => {
    const date = c.transaction.postedDate.toISOString().slice(0, 10)
    const amt = Number(c.transaction.amountNormalized.toString()).toFixed(2)
    console.log(
      `[${date}] ${c.transaction.merchantNormalized ?? c.transaction.merchantRaw} | $${amt}` +
      `\n    code=${c.code} | pct=${c.businessPct} | confidence=${c.confidence.toFixed(2)} | tier=${c.evidenceTier}` +
      `\n    citations=${c.ircCitations.join(", ")}` +
      `\n    reasoning=${(c.reasoning ?? "").slice(0, 120)}`
    )
    console.log()
  })

  // Show STOPs
  const stops = await prisma.stopItem.findMany({ where: { taxYearId: id, state: "PENDING" } })
  if (stops.length > 0) {
    console.log("=== STOP ITEMS ===\n")
    stops.forEach((s) => {
      console.log(`[${s.category}] ${s.question.slice(0, 150)}`)
      console.log(`  Context: ${JSON.stringify(s.context).slice(0, 200)}`)
      console.log()
    })
  }

  // Transfer pairs report
  const transferPairs = await prisma.transaction.findMany({
    where: { taxYearId: id, isTransferPairedWith: { not: null } },
    select: { id: true, merchantRaw: true, amountNormalized: true, postedDate: true, isTransferPairedWith: true, account: { select: { nickname: true, institution: true } } },
  })
  if (transferPairs.length > 0) {
    console.log("=== TRANSFER PAIRS ===\n")
    const seen = new Set<string>()
    for (const t of transferPairs) {
      if (seen.has(t.id)) continue
      seen.add(t.id)
      if (t.isTransferPairedWith) seen.add(t.isTransferPairedWith)
      const date = t.postedDate.toISOString().slice(0, 10)
      const amt = Number(t.amountNormalized.toString()).toFixed(2)
      console.log(`[${date}] ${t.account.nickname ?? t.account.institution} $${amt}: "${t.merchantRaw}" ↔ pair=${t.isTransferPairedWith?.slice(0, 8)}…`)
    }
    console.log()
  }

  // Trip override verification
  const tripOverrides = await prisma.classification.findMany({
    where: {
      isCurrent: true,
      code: "WRITE_OFF_TRAVEL",
    },
    include: { transaction: { select: { merchantNormalized: true, postedDate: true, amountNormalized: true } } },
    take: 5,
  })
  if (tripOverrides.length > 0) {
    console.log("=== TRIP OVERRIDES (WRITE_OFF_TRAVEL) ===\n")
    tripOverrides.forEach((c) => {
      const date = c.transaction.postedDate.toISOString().slice(0, 10)
      console.log(`[${date}] ${c.transaction.merchantNormalized} | $${Number(c.transaction.amountNormalized.toString()).toFixed(2)}`)
      console.log(`  reasoning: ${(c.reasoning ?? "").slice(0, 150)}`)
      console.log()
    })
  }

  await prisma.$disconnect()
  console.log("=== Pipeline run complete ===")
}

main().catch(console.error)
