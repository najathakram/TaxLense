// Boot-time bootstrap: ensure a SUPER_ADMIN exists when explicitly requested
// via the BOOTSTRAP_ADMIN_EMAIL env var.
//
// Why this exists: scripts/promote-role.ts is the canonical CLI path for role
// grants, but Railway doesn't expose a one-shot run-command UI. Rather than
// require the operator to install the Railway CLI, this file invokes the same
// promotion logic at container boot when an env var is set. Remove the var
// after the first deploy lands and this file is a no-op on every subsequent
// boot.
//
// Plain JavaScript ES module using `pg` directly (which is in production
// dependencies). Doesn't import the Prisma client (which is .ts only) so
// it runs on the production container without tsx.
//
// Usage on Railway:
//   1. Set BOOTSTRAP_ADMIN_EMAIL=<email> in Variables → Deploy.
//   2. After the deploy boots, this script promotes that email to SUPER_ADMIN
//      (creating the User row if it doesn't exist yet).
//   3. Remove the env var so subsequent deploys are no-ops.
//
// Idempotent and safe:
//   - If the user already has SUPER_ADMIN role, no DB writes happen.
//   - Writes a USER_PROMOTED_VIA_BOOTSTRAP audit event on every change.
//   - If DATABASE_URL is missing or the env var is unset, exits 0 silently.
//   - Catches and logs all errors — never blocks the server boot.

import pg from "pg"

// CUID-like id (matches Prisma's @default(cuid()) format: c + 24 lowercase alphanums).
function genCuid() {
  const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = "c"
  for (let i = 0; i < 24; i++) {
    id += charset[Math.floor(Math.random() * charset.length)]
  }
  return id
}

async function main() {
  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase()
  if (!email) {
    return
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[bootstrap] DATABASE_URL not set; skipping admin bootstrap.")
    return
  }

  const client = new pg.Client({ connectionString })
  try {
    await client.connect()

    const found = await client.query(
      'SELECT id, role FROM "User" WHERE email = $1 LIMIT 1',
      [email],
    )

    if (found.rows.length === 0) {
      // Pre-create. NextAuth's PrismaAdapter will link the Google OAuth
      // account to this row by email on first sign-in.
      const userId = genCuid()
      await client.query("BEGIN")
      try {
        await client.query(
          'INSERT INTO "User" (id, email, role, "isActive", "createdAt", "updatedAt") VALUES ($1, $2, $3, true, NOW(), NOW())',
          [userId, email, "SUPER_ADMIN"],
        )
        await client.query(
          `INSERT INTO "AuditEvent" (id, "userId", "actorType", "eventType", "entityType", "entityId", "afterState", rationale, "occurredAt")
           VALUES ($1, $2, 'SYSTEM', 'USER_PROMOTED_VIA_BOOTSTRAP', 'User', $3, $4::jsonb, $5, NOW())`,
          [
            genCuid(),
            userId,
            userId,
            JSON.stringify({ email, role: "SUPER_ADMIN", prefilled: true }),
            `Bootstrap-created via scripts/bootstrap.mjs at ${new Date().toISOString()}. Will be linked when user signs in via Google OAuth.`,
          ],
        )
        await client.query("COMMIT")
        console.log(`[bootstrap] ✓ ${email} pre-created as SUPER_ADMIN (id=${userId}).`)
      } catch (err) {
        await client.query("ROLLBACK")
        throw err
      }
      return
    }

    const { id: userId, role: previousRole } = found.rows[0]
    if (previousRole === "SUPER_ADMIN") {
      console.log(`[bootstrap] ${email} already SUPER_ADMIN — no-op.`)
      return
    }

    await client.query("BEGIN")
    try {
      await client.query(
        'UPDATE "User" SET role = $1, "updatedAt" = NOW() WHERE id = $2',
        ["SUPER_ADMIN", userId],
      )
      await client.query(
        `INSERT INTO "AuditEvent" (id, "userId", "actorType", "eventType", "entityType", "entityId", "beforeState", "afterState", rationale, "occurredAt")
         VALUES ($1, $2, 'SYSTEM', 'USER_PROMOTED_VIA_BOOTSTRAP', 'User', $3, $4::jsonb, $5::jsonb, $6, NOW())`,
        [
          genCuid(),
          userId,
          userId,
          JSON.stringify({ role: previousRole }),
          JSON.stringify({ role: "SUPER_ADMIN" }),
          `Promoted via scripts/bootstrap.mjs at ${new Date().toISOString()}.`,
        ],
      )
      await client.query("COMMIT")
      console.log(`[bootstrap] ✓ ${email} promoted to SUPER_ADMIN (was ${previousRole}).`)
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    }
  } catch (err) {
    console.error("[bootstrap] failure:", err)
    // Don't rethrow — let the server boot regardless. Operator can re-run
    // by toggling the env var.
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error("[bootstrap] uncaught:", err)
})
