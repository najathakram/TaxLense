/**
 * One-shot backfill: correct the sign on Wise rows that pre-B-06 ingestion
 * stored as inflows.
 *
 * Pattern: account.institution = 'Wise', merchantRaw starts with
 * "Sent money to" or "Card transaction" or "Bank transfer to", and
 * amountNormalized < 0 (system convention: inflow). These should be
 * outflows (positive amountNormalized).
 *
 * What we do per affected row:
 *   1. Flip amountNormalized sign  (-X → +X)
 *   2. Re-extract merchantRaw from the description (so analytics doesn't
 *      keep crediting "WISE INC" with the deductible spend — B-17)
 *   3. Mark current Classifications isCurrent = false (the agent will need
 *      to re-classify; a positive-amount "Sent money to Pakistani supplier"
 *      should be WRITE_OFF_COGS, not the prior BIZ_INCOME / NEEDS_CONTEXT)
 *
 * Append-only: we don't delete prior classifications, just flip them.
 *
 * Activation: env-gated. Set RUN_WISE_SIGN_FIX=true in Railway, redeploy
 * once, then unset. Safe to re-run (idempotent: only flips rows whose
 * normalization is currently inverted).
 *
 * Usage (local):  node scripts/fix-wise-sign-bug.mjs
 * Usage (Railway): set RUN_WISE_SIGN_FIX=true, redeploy
 *
 * Audit: each flip writes an AuditEvent so the change history shows who/why.
 */

import { PrismaClient } from "../app/generated/prisma/client.js"
import { PrismaPg } from "@prisma/adapter-pg"
import "dotenv/config"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

// Description prefixes that indicate an OUTFLOW. Mirror the Wise parser
// (lib/parsers/institutions/wise.ts) so the backfill and the live parser
// agree on which descriptions force a positive amountNormalized.
const SENT_RX = /^(Sent money to|Sent|Card transaction|Direct Debit|Bank transfer to|Wise charge|Wise fee)\b/i

function wiseMerchantFromDescription(desc) {
  const t = desc.trim()
  let m
  if ((m = t.match(/^(?:Sent money to|Bank transfer to|Direct Debit to)\s+(.+?)$/i))) {
    return m[1].toUpperCase()
  }
  if ((m = t.match(/^(?:Received money from|Bank transfer from|Refund from)\s+(.+?)$/i))) {
    return m[1].toUpperCase()
  }
  if ((m = t.match(/^Card transaction\s+(?:at\s+)?(.+?)$/i))) {
    return m[1].toUpperCase()
  }
  if (/^Topped up/i.test(t) || /^Top-up/i.test(t)) return "WISE TOP-UP"
  if (/^(Converted|Conversion|Exchange)\b/i.test(t)) return "WISE CONVERSION"
  if (/^Wise (charge|fee)/i.test(t)) return "WISE FEE"
  return t.toUpperCase()
}

async function main() {
  if (process.env.RUN_WISE_SIGN_FIX !== "true") {
    console.log("[wise-sign-fix] RUN_WISE_SIGN_FIX != 'true' — skipping (no-op).")
    return
  }
  console.log("[wise-sign-fix] starting")

  // Find Wise accounts. Many production deploys use account.institution = "Wise"
  // (case-sensitive); also accept the lowercased form set by the new parser.
  const wiseAccounts = await prisma.financialAccount.findMany({
    where: {
      OR: [
        { institution: "Wise" },
        { institution: "wise" },
      ],
    },
    select: { id: true, institution: true, nickname: true, userId: true, taxYearId: true },
  })
  console.log(`[wise-sign-fix] found ${wiseAccounts.length} Wise account(s)`)

  if (wiseAccounts.length === 0) {
    console.log("[wise-sign-fix] no Wise accounts — done")
    return
  }

  const accountIds = wiseAccounts.map((a) => a.id)

  // Candidates: "Sent money to..." style description with amountNormalized < 0
  // (i.e. currently stored as an inflow — wrong direction for an outflow).
  const candidates = await prisma.transaction.findMany({
    where: {
      accountId: { in: accountIds },
      amountNormalized: { lt: 0 },
    },
    select: {
      id: true,
      taxYearId: true,
      merchantRaw: true,
      descriptionRaw: true,
      amountNormalized: true,
      amountOriginal: true,
    },
  })

  let flipped = 0
  let unchanged = 0
  let classificationsArchived = 0

  for (const tx of candidates) {
    const desc = tx.descriptionRaw ?? tx.merchantRaw ?? ""
    if (!SENT_RX.test(desc)) {
      unchanged++
      continue
    }

    const oldNormalized = Number(tx.amountNormalized.toString())
    const newNormalized = Math.abs(oldNormalized)
    const newMerchant = wiseMerchantFromDescription(desc)

    await prisma.$transaction(async (txp) => {
      await txp.transaction.update({
        where: { id: tx.id },
        data: {
          amountNormalized: newNormalized,
          merchantRaw: newMerchant,
          // Re-normalization will happen on next pipeline run; clearing
          // merchantNormalized forces normalizeMerchantsForYear to recompute.
          merchantNormalized: null,
        },
      })
      const archived = await txp.classification.updateMany({
        where: { transactionId: tx.id, isCurrent: true },
        data: { isCurrent: false },
      })
      classificationsArchived += archived.count
      await txp.auditEvent.create({
        data: {
          userId: wiseAccounts.find((a) => a.id === tx.id)?.userId ?? null,
          actorType: "SYSTEM",
          eventType: "WISE_SIGN_FIX",
          entityType: "Transaction",
          entityId: tx.id,
          beforeState: {
            amountNormalized: oldNormalized,
            merchantRaw: tx.merchantRaw,
          },
          afterState: {
            amountNormalized: newNormalized,
            merchantRaw: newMerchant,
            classificationsArchived: archived.count,
          },
          rationale:
            "B-06 backfill: 'Sent money to X' on Wise was stored as an inflow. " +
            "Flipped to outflow + re-attributed to actual recipient + archived " +
            "stale classifications so the next agent run re-classifies.",
        },
      })
    })

    flipped++
  }

  console.log(
    `[wise-sign-fix] done — flipped=${flipped}, unchanged=${unchanged}, classifications_archived=${classificationsArchived}`,
  )
}

main()
  .catch((err) => {
    console.error("[wise-sign-fix] failed:", err)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
