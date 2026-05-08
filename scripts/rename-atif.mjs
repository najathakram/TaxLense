// One-shot: rename Atif Khan → Atif Ameer everywhere in the database.
//
// Production observed state (2026-05-08):
//   - CpaClient.displayName already shows "Atif Ameer" (set via the CPA's
//     overrides), but User.name and User.email still say "Khan".
//   - Goal: make every persisted record use "Atif Ameer" / "atif.ameer@…"
//     so the breadcrumb stops showing two different surnames.
//
// What this updates:
//   - User row(s): name "Atif Khan" → "Atif Ameer", email
//     "atif.khan@example.com" → "atif.ameer@example.com"
//   - CpaClient.displayName: "Atif Khan" → "Atif Ameer" (idempotent if
//     already set to Ameer)
//   - AuditEvent rows whose JSON before/after state mentions the old name
//     are NOT rewritten — append-only by design. The event log preserves
//     the historical fact that the row used to say Khan.
//
// Idempotent. Logs every row it touches.
//
// Usage on Railway:
//   1. Set in Variables: RUN_RENAME_ATIF = true
//   2. Deploy. Watch logs for "[rename-atif]".
//   3. Remove the env var so subsequent deploys are no-ops.
//
// Local usage:
//   pnpm dlx tsx scripts/rename-atif.mjs --force
//   (requires DATABASE_URL in .env.local pointing at the local Docker DB)

import "dotenv/config"
import pg from "pg"

const FROM_EMAIL = "atif.khan@example.com"
const TO_EMAIL = "atif.ameer@example.com"
const TO_NAME = "Atif Ameer"

const isForce = process.argv.includes("--force")
if (process.env.RUN_RENAME_ATIF !== "true" && !isForce) {
  console.log("[rename-atif] RUN_RENAME_ATIF != true — skipping")
  process.exit(0)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  console.error("[rename-atif] DATABASE_URL not set")
  process.exit(1)
}

const client = new pg.Client({ connectionString })
await client.connect()

try {
  // 1. Find any User row keyed off the old OR new email; rename whichever exists
  //    and tolerate either having already been partially renamed.
  const userRows = await client.query(
    'SELECT id, name, email FROM "User" WHERE LOWER(email) IN ($1, $2) OR name ILIKE $3',
    [FROM_EMAIL, TO_EMAIL, "%Khan%"],
  )
  if (userRows.rows.length === 0) {
    console.log(`[rename-atif] no User row matches "${FROM_EMAIL}" or contains "Khan" — nothing to do`)
  }

  for (const u of userRows.rows) {
    const before = { name: u.name, email: u.email }
    const newName = u.name && u.name.includes("Khan") ? u.name.replace("Khan", "Ameer") : (u.name === null ? TO_NAME : u.name)
    const newEmail = u.email?.toLowerCase() === FROM_EMAIL ? TO_EMAIL : u.email
    if (before.name === newName && before.email === newEmail) {
      console.log(`  [unchanged] User ${u.id} · ${before.name} · ${before.email}`)
      continue
    }
    await client.query('UPDATE "User" SET name = $1, email = $2 WHERE id = $3', [newName, newEmail, u.id])
    console.log(`  [updated]  User ${u.id} · "${before.name}" → "${newName}" · ${before.email} → ${newEmail}`)
  }

  // 2. CpaClient.displayName — fix any stale "Khan" overrides.
  const cpaRows = await client.query(
    'SELECT id, "displayName" FROM "CpaClient" WHERE "displayName" ILIKE $1',
    ["%Khan%"],
  )
  for (const c of cpaRows.rows) {
    const before = c.displayName
    const after = before.replace("Khan", "Ameer")
    await client.query('UPDATE "CpaClient" SET "displayName" = $1 WHERE id = $2', [after, c.id])
    console.log(`  [updated]  CpaClient ${c.id} · displayName "${before}" → "${after}"`)
  }
  if (cpaRows.rows.length === 0) {
    console.log("  [unchanged] no CpaClient.displayName contains 'Khan'")
  }

  console.log("[rename-atif] done")
} catch (err) {
  console.error("[rename-atif] failed:", err)
  process.exitCode = 1
} finally {
  await client.end()
}
