// One-shot: mark out-of-year Transactions on each TaxYear as isStale=true so
// they are excluded from the ledger view, reports, and assertion runs (A10
// keeps reading them — its job is to surface the leakage).
//
// Why this exists: pre-`partitionByTaxYear` uploads (statements that span a
// year boundary, e.g. 2024-12 → 2025-01 PDFs) ingested rows for adjacent
// years into the wrong TaxYear. The fix at parse time (lib/parsers/index.ts
// `partitionByTaxYear`) prevents new leakage; this script cleans existing.
//
// Append-only respect: the script never deletes rows. It only flips
// isStale=true (the same flag used by the re-extraction flow). All
// in-year totals already exclude isStale rows via inYearWindow / load-ledger
// queries, so this is a soft hide rather than a destructive change.
//
// Idempotent. Safe to run repeatedly.
//
// Usage on Railway:
//   1. Set RUN_OUT_OF_YEAR_CLEANUP = true (and optionally
//      CLEANUP_USER_EMAIL = atif.ameer@example.com to scope to one user).
//   2. Deploy. Watch logs for "[oy-cleanup]".
//   3. Remove the env var so subsequent deploys are no-ops.

import "dotenv/config"
import pg from "pg"

const isForce = process.argv.includes("--force")
if (process.env.RUN_OUT_OF_YEAR_CLEANUP !== "true" && !isForce) {
  console.log("[oy-cleanup] RUN_OUT_OF_YEAR_CLEANUP != true — skipping")
  process.exit(0)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("[oy-cleanup] DATABASE_URL not set")
  process.exit(1)
}

const userEmailFilter = process.env.CLEANUP_USER_EMAIL || null

const client = new pg.Client({ connectionString })
await client.connect()

try {
  // Pull every TaxYear (optionally scoped to one user) along with its year.
  const yearsRes = userEmailFilter
    ? await client.query(
        `SELECT ty.id, ty.year
         FROM "TaxYear" ty
         JOIN "User" u ON u.id = ty."userId"
         WHERE u.email = $1`,
        [userEmailFilter],
      )
    : await client.query(`SELECT id, year FROM "TaxYear"`)

  if (yearsRes.rowCount === 0) {
    console.log("[oy-cleanup] no TaxYears matched")
    process.exit(0)
  }

  let totalFlagged = 0
  for (const row of yearsRes.rows) {
    const taxYearId = row.id
    const year = row.year
    const startUtc = new Date(Date.UTC(year, 0, 1)).toISOString()
    const endUtc = new Date(Date.UTC(year + 1, 0, 1)).toISOString()

    // Find leaked transactions: dated outside [Jan 1, Jan 1 next year), not
    // already isStale, attached to this TaxYear.
    const update = await client.query(
      `UPDATE "Transaction"
       SET "isStale" = true
       WHERE "taxYearId" = $1
         AND "isStale" = false
         AND ("postedDate" < $2 OR "postedDate" >= $3)
       RETURNING id`,
      [taxYearId, startUtc, endUtc],
    )

    if (update.rowCount > 0) {
      console.log(
        `[oy-cleanup] taxYear=${taxYearId} year=${year} flagged=${update.rowCount}`,
      )
      totalFlagged += update.rowCount
    }
  }

  console.log(`[oy-cleanup] done. Flagged ${totalFlagged} out-of-year row(s) as stale.`)
} finally {
  await client.end()
}
