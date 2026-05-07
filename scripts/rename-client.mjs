// Boot-time client-rename script. One-shot, idempotent.
//
// Why: the client previously seeded as "Atif Khan" (default in seed-atif.mjs)
// is actually "Atif Ameer". Until the Edit Profile UI ships (Phase 0.2),
// this is the only path to correct the name without manual DB access.
//
// Plain JavaScript ES module using `pg` directly — same pattern as
// scripts/bootstrap.mjs, scripts/seed-atif.mjs.
//
// Usage on Railway:
//   1. Set in Variables:
//        RENAME_CLIENT_FROM = "Atif Khan"
//        RENAME_CLIENT_TO   = "Atif Ameer"
//      (Optionally also RENAME_CLIENT_EMAIL=<email> to disambiguate when
//      multiple users share the same name.)
//   2. Deploy. Watch logs for "[rename-client] ✓ ...".
//   3. Remove the env vars so subsequent deploys are no-ops.
//
// Idempotent: re-running with the same FROM/TO when the name already matches
// TO is a no-op. If FROM doesn't match, exits without writes.

import pg from "pg"

function genCuid() {
  const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = "c"
  for (let i = 0; i < 24; i++) {
    id += charset[Math.floor(Math.random() * charset.length)]
  }
  return id
}

async function main() {
  const fromName = process.env.RENAME_CLIENT_FROM?.trim()
  const toName = process.env.RENAME_CLIENT_TO?.trim()
  const targetEmail = process.env.RENAME_CLIENT_EMAIL?.trim().toLowerCase()
  if (!fromName || !toName) {
    return
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[rename-client] DATABASE_URL not set; skipping.")
    return
  }

  const client = new pg.Client({ connectionString })
  try {
    await client.connect()

    const params = targetEmail ? [fromName, targetEmail] : [fromName]
    const where = targetEmail ? "name = $1 AND email = $2" : "name = $1"
    const candidates = await client.query(
      `SELECT id, email, name, role FROM "User" WHERE ${where}`,
      params,
    )
    if (candidates.rows.length === 0) {
      console.log(`[rename-client] no User row matched name="${fromName}"${targetEmail ? ` email="${targetEmail}"` : ""}; skipping.`)
      return
    }
    if (candidates.rows.length > 1 && !targetEmail) {
      console.error(
        `[rename-client] ambiguous: ${candidates.rows.length} rows match name="${fromName}". Set RENAME_CLIENT_EMAIL to disambiguate.`,
      )
      return
    }

    const target = candidates.rows[0]
    if (target.name === toName) {
      console.log(`[rename-client] ${target.email} already named "${toName}" — no-op.`)
      return
    }

    await client.query("BEGIN")
    try {
      await client.query(
        'UPDATE "User" SET name = $1, "updatedAt" = NOW() WHERE id = $2',
        [toName, target.id],
      )
      await client.query(
        `INSERT INTO "AuditEvent"
           (id, "userId", "actorType", "eventType", "entityType", "entityId", "beforeState", "afterState", rationale, "occurredAt")
         VALUES
           ($1, $2, 'SYSTEM', 'CLIENT_RENAMED', 'User', $3, $4::jsonb, $5::jsonb, $6, NOW())`,
        [
          genCuid(),
          target.id,
          target.id,
          JSON.stringify({ name: target.name }),
          JSON.stringify({ name: toName }),
          `Renamed by scripts/rename-client.mjs at ${new Date().toISOString()}.`,
        ],
      )
      await client.query("COMMIT")
      console.log(`[rename-client] ✓ ${target.email}: "${target.name}" → "${toName}".`)
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    }
  } catch (err) {
    console.error("[rename-client] failure:", err)
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error("[rename-client] uncaught:", err)
})
