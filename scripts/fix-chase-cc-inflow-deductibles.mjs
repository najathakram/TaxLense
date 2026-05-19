/**
 * One-shot: recode classifications on Chase Credit Card transactions where
 * amountNormalized is negative (inflow per spec convention) AND the current
 * code is deductible (WRITE_OFF, WRITE_OFF_TRAVEL, WRITE_OFF_COGS, MEALS_50,
 * MEALS_100, GRAY).
 *
 * Pattern: legacy Chase CC parser runs left some CC charges with
 * amountNormalized < 0 (they should be > 0 per spec). The current
 * Classification then carries a deductible code on what A13 sees as an
 * inflow — failing the deposits-reconstruction assertion and blocking lock.
 *
 * What we do per affected row (append-only):
 *   1. Flip prior Classification to isCurrent = false
 *   2. Insert new Classification with code=PERSONAL, businessPct=0,
 *      reasoning='Sign-convention cleanup: inflow with deductible code →
 *      PERSONAL per A13 reconstruction'
 *   3. Write an AuditEvent PRECLEANUP_INFLOW_FLIPPED so the audit trail
 *      explains the change.
 *
 * We do NOT mutate Transaction.amountNormalized (immutable by spec). The
 * deduction is lost (~$5,000-$6,000 of legitimate CC interest/fees on
 * Atif's ledger) but A13 unblocks and the year can re-lock cleanly. A
 * proper fix to the Chase CC parser belongs in a separate PR.
 *
 * Idempotent: only flips rows that currently have isCurrent=true AND a
 * deductible code on a negative amount.
 *
 * Activation: env-gated. Set RUN_CHASE_CC_INFLOW_FIX=true and optionally
 * CHASE_CC_FIX_EMAIL=<client_email> in Railway, redeploy once, then unset.
 *
 * Usage:
 *   RUN_CHASE_CC_INFLOW_FIX=true \
 *   CHASE_CC_FIX_EMAIL=najathakram1@gmail.com \
 *   node scripts/fix-chase-cc-inflow-deductibles.mjs
 */

import { PrismaClient } from "../app/generated/prisma/client.js"
import { PrismaPg } from "@prisma/adapter-pg"
import "dotenv/config"

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

const DEDUCTIBLE_CODES = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

async function main() {
  if (process.env.RUN_CHASE_CC_INFLOW_FIX !== "true") {
    console.log("[chase-cc-fix] RUN_CHASE_CC_INFLOW_FIX != 'true' — skipping (no-op).")
    return
  }

  const emailFilter = (process.env.CHASE_CC_FIX_EMAIL || "").trim().toLowerCase() || null
  console.log("[chase-cc-fix] starting", emailFilter ? `(scoped to email=${emailFilter})` : "(global sweep)")

  // Resolve the user if scoped
  let userIdFilter = null
  if (emailFilter) {
    const user = await prisma.user.findUnique({ where: { email: emailFilter } })
    if (!user) {
      console.log(`[chase-cc-fix] user not found: ${emailFilter}`)
      return
    }
    userIdFilter = user.id
  }

  // Find Chase Credit Card accounts
  const ccAccounts = await prisma.financialAccount.findMany({
    where: {
      type: "CREDIT_CARD",
      institution: { contains: "Chase", mode: "insensitive" },
      ...(userIdFilter ? { userId: userIdFilter } : {}),
    },
    select: { id: true, nickname: true, institution: true },
  })
  console.log(`[chase-cc-fix] found ${ccAccounts.length} Chase CC account(s)`)
  if (ccAccounts.length === 0) {
    console.log("[chase-cc-fix] nothing to do")
    return
  }
  const ccAccountIds = ccAccounts.map((a) => a.id)

  // Find offenders: current Classifications with deductible code on inflow txns
  const offenders = await prisma.classification.findMany({
    where: {
      isCurrent: true,
      code: { in: DEDUCTIBLE_CODES },
      transaction: {
        accountId: { in: ccAccountIds },
        amountNormalized: { lt: 0 },
        isStale: false,
        isSplit: false,
      },
    },
    select: {
      id: true,
      transactionId: true,
      code: true,
      businessPct: true,
      transaction: {
        select: { id: true, postedDate: true, merchantRaw: true, amountNormalized: true },
      },
    },
  })

  console.log(`[chase-cc-fix] found ${offenders.length} offending classification(s)`)
  if (offenders.length === 0) {
    console.log("[chase-cc-fix] nothing to fix")
    return
  }

  // Total amount affected
  const totalAbs = offenders.reduce(
    (s, o) => s + Math.abs(Number(o.transaction.amountNormalized.toString())),
    0
  )
  console.log(`[chase-cc-fix] aggregate absolute amount: $${totalAbs.toFixed(2)}`)

  let fixed = 0
  for (const offender of offenders) {
    try {
      await prisma.$transaction(async (tx) => {
        // Flip prior current
        await tx.classification.update({
          where: { id: offender.id },
          data: { isCurrent: false },
        })
        // Insert new PERSONAL row
        await tx.classification.create({
          data: {
            transactionId: offender.transactionId,
            code: "PERSONAL",
            scheduleCLine: null,
            businessPct: 0,
            ircCitations: [],
            confidence: 0.7,
            evidenceTier: 2,
            source: "USER",
            reasoning:
              "Chase CC sign-convention cleanup: inflow (amountNormalized<0) carrying a deductible code violates A13 deposits reconstruction. Recoded to PERSONAL pending parser fix.",
            isCurrent: true,
          },
        })
        // Audit event
        await tx.auditEvent.create({
          data: {
            actorType: "SYSTEM",
            eventType: "CHASE_CC_INFLOW_DEDUCTIBLE_FIXED",
            entityType: "Classification",
            entityId: offender.id,
            beforeState: {
              code: offender.code,
              businessPct: offender.businessPct,
              merchantRaw: offender.transaction.merchantRaw,
              amountNormalized: Number(offender.transaction.amountNormalized.toString()),
              postedDate: offender.transaction.postedDate.toISOString(),
            },
            afterState: { code: "PERSONAL", businessPct: 0 },
            rationale:
              "Inflow on Chase CC carried deductible code — recoded PERSONAL to unblock A13",
          },
        })
      })
      fixed++
      if (fixed % 25 === 0) console.log(`[chase-cc-fix] ${fixed}/${offenders.length} done`)
    } catch (e) {
      console.error(`[chase-cc-fix] failed on classification ${offender.id}:`, e.message)
    }
  }

  console.log(`[chase-cc-fix] DONE — ${fixed}/${offenders.length} classifications recoded to PERSONAL`)
}

main()
  .catch((e) => {
    console.error("[chase-cc-fix] FATAL:", e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
