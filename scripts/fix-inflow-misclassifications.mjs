// One-shot: find Classifications where the underlying Transaction is an
// inflow (negative amountNormalized) but the code is a deductible code
// (WRITE_OFF, WRITE_OFF_TRAVEL, WRITE_OFF_COGS, MEALS_50, MEALS_100, GRAY).
// Flip the current Classification to isCurrent=false and append a fresh
// NEEDS_CONTEXT row so the user / next AI pass triages it.
//
// Why this exists: pre-Round-3, neither the autonomous CPA agent nor the
// applyMerchantRules step enforced "inflows can't be deductible". The agent
// pattern-matched on "Wise = supplier rail" and stamped WRITE_OFF on every
// Wise row regardless of sign — including the +$1853.15 owner top-ups. This
// script fixes legacy data; the round-3 invariants (cpaAgent.ts +
// classification/apply.ts) prevent new occurrences.
//
// Append-only respect: never deletes Classification rows. Flips the prior
// row's isCurrent to false and inserts a new NEEDS_CONTEXT row (same
// flip-and-insert pattern as resolveStop / editClassification).
//
// Idempotent. Safe to run repeatedly.
//
// Usage on Railway:
//   1. Set RUN_INFLOW_CLEANUP = true (and optionally
//      CLEANUP_USER_EMAIL = atif.ameer@example.com to scope to one user).
//   2. Deploy. Watch logs for "[inflow-cleanup]".
//   3. Remove the env var so subsequent deploys are no-ops.

import "dotenv/config"
import pg from "pg"

const isForce = process.argv.includes("--force")
if (process.env.RUN_INFLOW_CLEANUP !== "true" && !isForce) {
  console.log("[inflow-cleanup] RUN_INFLOW_CLEANUP != true — skipping")
  process.exit(0)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("[inflow-cleanup] DATABASE_URL not set")
  process.exit(1)
}

const userEmailFilter = process.env.CLEANUP_USER_EMAIL || null

const DEDUCTIBLE_CODES = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

const client = new pg.Client({ connectionString })
await client.connect()

try {
  // Find offenders: current Classifications on inflow Transactions where
  // the code is a deductible code.
  const filterParams = []
  let userJoinSql = ""
  if (userEmailFilter) {
    filterParams.push(userEmailFilter)
    userJoinSql = `
        JOIN "TaxYear" ty ON ty.id = t."taxYearId"
        JOIN "User" u ON u.id = ty."userId"
        AND u.email = $1
    `
  }
  const offendersSql = `
    SELECT c.id AS classification_id, c."transactionId" AS transaction_id, c.code, t."amountNormalized" AS amount
    FROM "Classification" c
    JOIN "Transaction" t ON t.id = c."transactionId"
    ${userJoinSql}
    WHERE c."isCurrent" = true
      AND c.code = ANY($${filterParams.length + 1}::"TransactionCode"[])
      AND t."amountNormalized" < 0
      AND t."isStale" = false
      AND t."isSplit" = false
  `
  const params = [...filterParams, DEDUCTIBLE_CODES]
  const offenders = await client.query(offendersSql, params)

  if (offenders.rowCount === 0) {
    console.log("[inflow-cleanup] no offending classifications found")
    process.exit(0)
  }

  console.log(`[inflow-cleanup] found ${offenders.rowCount} inflow row${offenders.rowCount === 1 ? "" : "s"} with deductible codes — fixing`)

  let fixed = 0
  for (const row of offenders.rows) {
    await client.query("BEGIN")
    try {
      // Flip prior current to false
      await client.query(
        `UPDATE "Classification" SET "isCurrent" = false WHERE id = $1`,
        [row.classification_id],
      )
      // Insert fresh NEEDS_CONTEXT row
      await client.query(
        `INSERT INTO "Classification" (
          id, "transactionId", code, "scheduleCLine", "businessPct", "ircCitations",
          confidence, "evidenceTier", source, reasoning, "isCurrent", "createdAt", "updatedAt"
        ) VALUES (
          gen_random_uuid()::text, $1, 'NEEDS_CONTEXT', NULL, 0, ARRAY[]::text[],
          0.0, 3, 'AI', $2, true, NOW(), NOW()
        )`,
        [
          row.transaction_id,
          `Cleanup: prior code ${row.code} on inflow ${row.amount} demoted to NEEDS_CONTEXT (inflows cannot be deductible). Re-run the autonomous CPA agent to re-classify.`,
        ],
      )
      await client.query("COMMIT")
      fixed++
    } catch (err) {
      await client.query("ROLLBACK")
      console.error(`[inflow-cleanup] failed on classification ${row.classification_id}:`, err)
    }
  }

  console.log(`[inflow-cleanup] done. Fixed ${fixed} of ${offenders.rowCount} offending row(s).`)
} finally {
  await client.end()
}
