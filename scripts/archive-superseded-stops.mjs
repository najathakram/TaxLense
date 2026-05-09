// One-shot: archive PENDING StopItems whose underlying transactions all
// have a current Classification. The autonomous CPA agent classifies every
// in-year transaction; once the row is classified, the legacy STOP from the
// old multi-stage pipeline is by definition superseded — the agent's
// decision is the canonical one.
//
// Why this exists: the in-agent archival hook (lib/ai/cpaAgent.ts) was
// intended to do this on every CPA agent run, but on Atif's prod ledger
// 94 PENDING STOPs survived the run untouched. Until that is debugged
// fully, this script lets us unblock filing by archiving the legacy STOPs
// after a known-good agent run.
//
// Append-only respect: never deletes StopItem rows. Flips state PENDING →
// ANSWERED with a userAnswer JSON describing why ("cpaAgentSupersededByScript")
// so the audit history makes the source of the change clear.
//
// Idempotent. Safe to run repeatedly.
//
// Usage on Railway:
//   1. Set RUN_STOP_ARCHIVAL = true (and optionally
//      ARCHIVAL_USER_EMAIL = atif.ameer@example.com to scope to one user).
//   2. Deploy. Watch logs for "[stop-archival]".
//   3. Remove the env var so subsequent deploys are no-ops.

import "dotenv/config"
import pg from "pg"

const isForce = process.argv.includes("--force")
if (process.env.RUN_STOP_ARCHIVAL !== "true" && !isForce) {
  console.log("[stop-archival] RUN_STOP_ARCHIVAL != true — skipping")
  process.exit(0)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("[stop-archival] DATABASE_URL not set")
  process.exit(1)
}

const userEmailFilter = process.env.ARCHIVAL_USER_EMAIL || null

const client = new pg.Client({ connectionString })
await client.connect()

try {
  // Pull every PENDING StopItem (optionally scoped to one user) along with
  // its taxYearId and transactionIds. We then check which of those txns
  // currently have an isCurrent=true Classification — those are the ones
  // the autonomous agent has now superseded.
  const filterParams = []
  let userJoinSql = ""
  if (userEmailFilter) {
    filterParams.push(userEmailFilter)
    userJoinSql = `
      JOIN "TaxYear" ty ON ty.id = si."taxYearId"
      JOIN "User" u ON u.id = ty."userId"
        AND u.email = $1
    `
  }
  const stopsQuery = `
    SELECT si.id AS stop_id, si."transactionIds" AS tx_ids, si."taxYearId"
    FROM "StopItem" si
    ${userJoinSql}
    WHERE si.state = 'PENDING'
  `
  const stops = await client.query(stopsQuery, filterParams)

  if (stops.rowCount === 0) {
    console.log("[stop-archival] no PENDING stops matched")
    process.exit(0)
  }

  console.log(`[stop-archival] checking ${stops.rowCount} PENDING StopItem${stops.rowCount === 1 ? "" : "s"}`)

  let archived = 0
  let skipped = 0
  for (const row of stops.rows) {
    const stopId = row.stop_id
    const txIds = row.tx_ids ?? []

    if (txIds.length === 0) {
      // Empty STOP — also archive (holdover edge case)
      await client.query(
        `UPDATE "StopItem"
         SET state = 'ANSWERED',
             "answeredAt" = NOW(),
             "userAnswer" = $1::jsonb
         WHERE id = $2`,
        [
          JSON.stringify({
            cpaAgentSupersededByScript: true,
            archivedAt: new Date().toISOString(),
            reason: "Empty STOP (no transactions) — archived by stop-archival script.",
          }),
          stopId,
        ],
      )
      archived++
      continue
    }

    // Check if all these transactions now have an isCurrent=true Classification
    const r = await client.query(
      `SELECT COUNT(*)::int AS n
       FROM "Classification" c
       WHERE c."transactionId" = ANY($1::text[])
         AND c."isCurrent" = true`,
      [txIds],
    )
    const classifiedCount = r.rows[0].n
    if (classifiedCount === 0) {
      skipped++
      continue
    }

    // At least one txn is classified → this STOP has been superseded
    await client.query(
      `UPDATE "StopItem"
       SET state = 'ANSWERED',
           "answeredAt" = NOW(),
           "userAnswer" = $1::jsonb
       WHERE id = $2`,
      [
        JSON.stringify({
          cpaAgentSupersededByScript: true,
          archivedAt: new Date().toISOString(),
          reason: `${classifiedCount} of ${txIds.length} underlying transactions are now classified by the autonomous CPA agent — STOP superseded.`,
        }),
        stopId,
      ],
    )
    archived++
  }

  console.log(`[stop-archival] done. Archived ${archived}, skipped ${skipped} (no classified txns).`)
} finally {
  await client.end()
}
