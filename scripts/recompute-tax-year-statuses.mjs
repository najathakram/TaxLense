// One-shot: recompute every TaxYear's status via the deriveStage rules from
// lib/taxYear/status.ts. Plain pg — no tsx, no Prisma — so it runs in the
// Railway container's start chain without an extra subprocess.
//
// Why this exists: pre-Tier-1 deploys, TaxYear.status was set in only a few
// places (CREATED → INGESTION on first upload, → LOCKED on lock). Years
// stayed on INGESTION even when 100% of rows were classified, which made
// the breadcrumb chip a lie. After Tier 1 ships, recomputeStatus() runs at
// the end of every state-mutating action — but existing data only refreshes
// on the next mutation. This script forces a one-time refresh.
//
// Idempotent. Safe to run repeatedly.
//
// Usage on Railway:
//   1. Set RUN_STATUS_RECOMPUTE = true (and optionally
//      RECOMPUTE_USER_EMAIL = atif.ameer@example.com to scope to a single user).
//   2. Deploy. Watch logs for "[recompute-status]".
//   3. Remove the env var so subsequent deploys are no-ops.

import "dotenv/config"
import pg from "pg"

const isForce = process.argv.includes("--force")
if (process.env.RUN_STATUS_RECOMPUTE !== "true" && !isForce) {
  console.log("[recompute-status] RUN_STATUS_RECOMPUTE != true — skipping")
  process.exit(0)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("[recompute-status] DATABASE_URL not set")
  process.exit(1)
}

/**
 * Mirrors lib/taxYear/status.ts deriveStage. Kept inline so this script has
 * zero dependencies on the TS module graph.
 */
function deriveStage(year, counts) {
  if (year.lockedAt || year.status === "LOCKED") return "LOCKED"
  if (year.status === "ARCHIVED") return "ARCHIVED"
  if (counts.totalTx === 0) {
    return year.status === "CREATED" ? "CREATED" : "INGESTION"
  }
  if (counts.classifiedTx >= counts.totalTx && counts.pendingStops === 0) {
    return "REVIEW"
  }
  if (counts.classifiedTx > 0 || counts.pendingStops > 0) return "CLASSIFICATION"
  return "INGESTION"
}

const client = new pg.Client({ connectionString })
await client.connect()

try {
  const targetEmail = process.env.RECOMPUTE_USER_EMAIL?.trim().toLowerCase()
  const where = targetEmail
    ? `WHERE u.email = $1`
    : ""
  const params = targetEmail ? [targetEmail] : []

  const yearsRes = await client.query(
    `SELECT ty.id, ty.year, ty.status, ty."lockedAt", u.email
       FROM "TaxYear" ty
       JOIN "User" u ON u.id = ty."userId"
       ${where}
       ORDER BY u.email, ty.year`,
    params,
  )

  if (yearsRes.rows.length === 0) {
    console.log(`[recompute-status] no TaxYears matched (filter: ${targetEmail ?? "none"})`)
    process.exit(0)
  }

  console.log(`[recompute-status] processing ${yearsRes.rows.length} TaxYear${yearsRes.rows.length === 1 ? "" : "s"}…`)

  let changed = 0
  let unchanged = 0
  for (const y of yearsRes.rows) {
    if (y.status === "ARCHIVED") {
      unchanged++
      continue
    }

    const [totalTxRes, classifiedRes, stopsRes] = await Promise.all([
      client.query(
        `SELECT COUNT(*)::int AS n FROM "Transaction"
          WHERE "taxYearId" = $1 AND "isDuplicateOf" IS NULL`,
        [y.id],
      ),
      client.query(
        `SELECT COUNT(*)::int AS n FROM "Classification" c
          JOIN "Transaction" t ON t.id = c."transactionId"
          WHERE t."taxYearId" = $1 AND t."isDuplicateOf" IS NULL AND c."isCurrent" = true`,
        [y.id],
      ),
      client.query(
        `SELECT COUNT(*)::int AS n FROM "StopItem"
          WHERE "taxYearId" = $1 AND state = 'PENDING'`,
        [y.id],
      ),
    ])

    const counts = {
      totalTx: totalTxRes.rows[0].n,
      classifiedTx: classifiedRes.rows[0].n,
      pendingStops: stopsRes.rows[0].n,
    }

    const next = deriveStage({ status: y.status, lockedAt: y.lockedAt }, counts)
    const tag = `${y.email} / ${y.year}`

    if (next === y.status) {
      console.log(`  [unchanged] ${tag} · ${y.status} · ${counts.classifiedTx}/${counts.totalTx} cls · ${counts.pendingStops} stops`)
      unchanged++
      continue
    }

    await client.query(`UPDATE "TaxYear" SET status = $1 WHERE id = $2`, [next, y.id])
    console.log(`  [updated]  ${tag} · ${y.status} → ${next} · ${counts.classifiedTx}/${counts.totalTx} cls · ${counts.pendingStops} stops`)
    changed++
  }

  console.log(`[recompute-status] done — ${changed} changed, ${unchanged} unchanged`)
} catch (err) {
  console.error("[recompute-status] failed:", err)
  process.exitCode = 1
} finally {
  await client.end()
}
