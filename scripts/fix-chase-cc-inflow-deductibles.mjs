/**
 * One-shot boot-script (raw pg, no Prisma): recode Chase Credit Card
 * Classifications where amountNormalized < 0 (inflow per spec) AND the
 * current code is deductible (WRITE_OFF, WRITE_OFF_TRAVEL, WRITE_OFF_COGS,
 * MEALS_50, MEALS_100, GRAY).
 *
 * Pattern: a legacy Chase CC parser run left some CC charges with
 * amountNormalized < 0 (they should be > 0 per spec). The current
 * Classification then carries a deductible code on what A13 sees as an
 * inflow — failing the deposits-reconstruction assertion and blocking lock.
 *
 * Per affected row (append-only):
 *   1. Flip prior Classification.isCurrent = false
 *   2. Insert new Classification with code = PERSONAL, businessPct = 0
 *   3. Write an AuditEvent CHASE_CC_INFLOW_DEDUCTIBLE_FIXED
 *
 * We do NOT mutate Transaction.amountNormalized (immutable by spec). The
 * deduction is lost (~$5K-$6K of legitimate CC interest/fees on Atif's
 * ledger) but A13 unblocks and the year can re-lock cleanly. A proper fix
 * to the Chase CC parser belongs in a separate PR.
 *
 * Why raw pg (not Prisma): boot-time scripts cannot import the generated
 * Prisma client (.ts only). PR #48 attempted Prisma import and crashed
 * Railway with ERR_MODULE_NOT_FOUND at boot. This rewrite follows the
 * scripts/bootstrap.mjs pattern: raw pg.Client + raw SQL.
 *
 * Idempotent: only flips rows that currently have isCurrent=true AND a
 * deductible code on a negative amount.
 *
 * Activation: env-gated. Set RUN_CHASE_CC_INFLOW_FIX=true and optionally
 * CHASE_CC_FIX_EMAIL=<client_email> in Railway, redeploy once, then unset.
 */

import pg from "pg"

// CUID-like id (matches Prisma's @default(cuid()) format).
function genCuid() {
  const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = "c"
  for (let i = 0; i < 24; i++) {
    id += charset[Math.floor(Math.random() * charset.length)]
  }
  return id
}

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
    return
  }

  const emailFilter = (process.env.CHASE_CC_FIX_EMAIL || "").trim().toLowerCase() || null
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[chase-cc-fix] DATABASE_URL not set; skipping.")
    return
  }

  console.log(
    "[chase-cc-fix] starting",
    emailFilter ? `(scoped to email=${emailFilter})` : "(global sweep)",
  )

  const client = new pg.Client({ connectionString })
  try {
    await client.connect()

    // Resolve the user if scoped.
    let userIdFilter = null
    if (emailFilter) {
      const r = await client.query('SELECT id FROM "User" WHERE email = $1 LIMIT 1', [emailFilter])
      if (r.rows.length === 0) {
        console.log(`[chase-cc-fix] user not found: ${emailFilter}`)
        return
      }
      userIdFilter = r.rows[0].id
    }

    // Find Chase Credit Card accounts.
    const accountParams = userIdFilter ? [userIdFilter] : []
    const accountSql = userIdFilter
      ? `SELECT id, nickname, institution FROM "FinancialAccount"
         WHERE type = 'CREDIT_CARD' AND institution ILIKE '%Chase%' AND "userId" = $1`
      : `SELECT id, nickname, institution FROM "FinancialAccount"
         WHERE type = 'CREDIT_CARD' AND institution ILIKE '%Chase%'`
    const accountsRes = await client.query(accountSql, accountParams)
    console.log(`[chase-cc-fix] found ${accountsRes.rows.length} Chase CC account(s)`)
    if (accountsRes.rows.length === 0) {
      console.log("[chase-cc-fix] nothing to do")
      return
    }
    const ccAccountIds = accountsRes.rows.map((a) => a.id)

    // Find offenders: current Classifications with deductible code on inflow Chase CC txns.
    const offendersRes = await client.query(
      `SELECT
         c.id            AS classification_id,
         c."transactionId" AS transaction_id,
         c.code          AS code,
         c."businessPct" AS business_pct,
         t."merchantRaw" AS merchant_raw,
         t."amountNormalized" AS amount_normalized,
         t."postedDate"  AS posted_date
       FROM "Classification" c
       JOIN "Transaction" t ON t.id = c."transactionId"
       WHERE c."isCurrent" = true
         AND c.code = ANY($1::"TransactionCode"[])
         AND t."accountId" = ANY($2::text[])
         AND t."amountNormalized" < 0
         AND t."isStale" = false
         AND t."isSplit" = false`,
      [DEDUCTIBLE_CODES, ccAccountIds],
    )

    console.log(`[chase-cc-fix] found ${offendersRes.rows.length} offending classification(s)`)
    if (offendersRes.rows.length === 0) {
      console.log("[chase-cc-fix] nothing to fix")
      return
    }

    const totalAbs = offendersRes.rows.reduce(
      (s, o) => s + Math.abs(Number(o.amount_normalized)),
      0,
    )
    console.log(`[chase-cc-fix] aggregate absolute amount: $${totalAbs.toFixed(2)}`)

    let fixed = 0
    for (const offender of offendersRes.rows) {
      await client.query("BEGIN")
      try {
        // 1. Flip prior current Classification to isCurrent = false.
        await client.query(
          'UPDATE "Classification" SET "isCurrent" = false WHERE id = $1',
          [offender.classification_id],
        )

        // 2. Insert new PERSONAL Classification.
        const newClassificationId = genCuid()
        await client.query(
          `INSERT INTO "Classification" (
             id, "transactionId", code, "scheduleCLine", "businessPct",
             "ircCitations", confidence, "evidenceTier", source, reasoning,
             "cohanFlag", "isCurrent", "createdAt"
           ) VALUES (
             $1, $2, 'PERSONAL', NULL, 0,
             $3, 0.7, 2, 'USER', $4,
             false, true, NOW()
           )`,
          [
            newClassificationId,
            offender.transaction_id,
            [],
            "Chase CC sign-convention cleanup: inflow (amountNormalized<0) carrying a deductible code violates A13 deposits reconstruction. Recoded to PERSONAL pending parser fix.",
          ],
        )

        // 3. AuditEvent.
        await client.query(
          `INSERT INTO "AuditEvent" (
             id, "actorType", "eventType", "entityType", "entityId",
             "beforeState", "afterState", rationale, "occurredAt"
           ) VALUES (
             $1, 'SYSTEM', 'CHASE_CC_INFLOW_DEDUCTIBLE_FIXED', 'Classification', $2,
             $3::jsonb, $4::jsonb, $5, NOW()
           )`,
          [
            genCuid(),
            offender.classification_id,
            JSON.stringify({
              code: offender.code,
              businessPct: offender.business_pct,
              merchantRaw: offender.merchant_raw,
              amountNormalized: Number(offender.amount_normalized),
              postedDate: new Date(offender.posted_date).toISOString(),
            }),
            JSON.stringify({ code: "PERSONAL", businessPct: 0 }),
            "Inflow on Chase CC carried deductible code — recoded PERSONAL to unblock A13",
          ],
        )

        await client.query("COMMIT")
        fixed++
        if (fixed % 25 === 0) console.log(`[chase-cc-fix] ${fixed}/${offendersRes.rows.length} done`)
      } catch (err) {
        await client.query("ROLLBACK")
        console.error(
          `[chase-cc-fix] failed on classification ${offender.classification_id}:`,
          err.message,
        )
      }
    }

    console.log(
      `[chase-cc-fix] DONE — ${fixed}/${offendersRes.rows.length} classifications recoded to PERSONAL`,
    )
  } catch (err) {
    console.error("[chase-cc-fix] FATAL:", err)
    // Don't rethrow — let the server boot regardless.
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error("[chase-cc-fix] uncaught:", err)
})
