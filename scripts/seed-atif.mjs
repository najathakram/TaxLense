// Boot-time seed: move existing tax data off the CPA's own User row and onto
// a separate CLIENT User row, then link the two via a CpaClient row.
//
// Why this exists: in Phase 8 the production database had a single User
// (najathakram1@gmail.com) that owned both the CPA login AND the actual
// Schedule C data (TaxYear 2025, accounts, transactions, business profile).
// That conflates the CPA-firm row with the taxpayer-client row and breaks the
// CPA → Client navigation everywhere in the app. This script splits them.
//
// Plain JavaScript ES module using `pg` directly (in production deps),
// matching scripts/bootstrap.mjs so it runs on the production container
// without tsx and without importing the Prisma client (which is .ts only).
//
// Usage on Railway:
//   1. Set SEED_ATIF_FOR_CPA=<cpa-email> in Variables → Deploy.
//      Optionally also SEED_ATIF_EMAIL and SEED_ATIF_NAME (defaults below).
//   2. After the deploy boots, this script:
//        a. ensures a CLIENT User exists for the client email
//        b. reparents TaxYear/FinancialAccount/BusinessProfile rows from
//           the CPA's userId to the client's userId
//        c. links them via a CpaClient row
//        d. writes an ATIF_SEEDED_VIA_SCRIPT audit event
//   3. Remove the env var so subsequent deploys are no-ops.
//
// Idempotent and safe:
//   - If no rows are owned by the CPA, only the CpaClient link is created.
//   - If the CpaClient link already exists, the link step is a no-op.
//   - If SEED_ATIF_FOR_CPA is unset or the CPA is not found, exits 0 silently.
//   - All reparenting happens in a single transaction.
//   - Catches and logs all errors — never blocks the server boot.

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
  const cpaEmail = process.env.SEED_ATIF_FOR_CPA?.trim().toLowerCase()
  if (!cpaEmail) {
    return
  }

  const clientEmail = (process.env.SEED_ATIF_EMAIL ?? "atif.khan@example.com").trim().toLowerCase()
  const clientName = (process.env.SEED_ATIF_NAME ?? "Atif Khan").trim()

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[seed-atif] DATABASE_URL not set; skipping.")
    return
  }

  const client = new pg.Client({ connectionString })
  try {
    await client.connect()

    const cpaRow = await client.query(
      'SELECT id, role FROM "User" WHERE email = $1 LIMIT 1',
      [cpaEmail],
    )
    if (cpaRow.rows.length === 0) {
      console.log(`[seed-atif] no User row for CPA ${cpaEmail} — skipping.`)
      return
    }
    const cpaUserId = cpaRow.rows[0].id
    const cpaRole = cpaRow.rows[0].role
    if (cpaRole !== "CPA" && cpaRole !== "SUPER_ADMIN") {
      console.log(`[seed-atif] ${cpaEmail} has role ${cpaRole}; expected CPA. Skipping.`)
      return
    }

    let clientUserId
    const existingClient = await client.query(
      'SELECT id, role FROM "User" WHERE email = $1 LIMIT 1',
      [clientEmail],
    )
    if (existingClient.rows.length > 0) {
      clientUserId = existingClient.rows[0].id
      console.log(`[seed-atif] ${clientEmail} already exists (id=${clientUserId}, role=${existingClient.rows[0].role}).`)
    } else {
      clientUserId = genCuid()
      await client.query(
        'INSERT INTO "User" (id, email, name, role, "isActive", "createdAt", "updatedAt") VALUES ($1, $2, $3, $4, true, NOW(), NOW())',
        [clientUserId, clientEmail, clientName, "CLIENT"],
      )
      console.log(`[seed-atif] ✓ created ${clientEmail} as CLIENT (id=${clientUserId}).`)
    }

    await client.query("BEGIN")
    try {
      const taxYears = await client.query(
        'UPDATE "TaxYear" SET "userId" = $1 WHERE "userId" = $2 RETURNING id, year',
        [clientUserId, cpaUserId],
      )
      const accounts = await client.query(
        'UPDATE "FinancialAccount" SET "userId" = $1 WHERE "userId" = $2 RETURNING id',
        [clientUserId, cpaUserId],
      )
      const profiles = await client.query(
        'UPDATE "BusinessProfile" SET "userId" = $1 WHERE "userId" = $2 RETURNING id',
        [clientUserId, cpaUserId],
      )
      // Document.userId points at the taxpayer-owner; Document.uploadedById is the
      // person who clicked upload (often the CPA). We move owner only.
      const documents = await client.query(
        'UPDATE "Document" SET "userId" = $1 WHERE "userId" = $2 RETURNING id',
        [clientUserId, cpaUserId],
      )

      const linkExisting = await client.query(
        'SELECT id FROM "CpaClient" WHERE "cpaUserId" = $1 AND "clientUserId" = $2 LIMIT 1',
        [cpaUserId, clientUserId],
      )
      let cpaClientId
      let linkCreated = false
      if (linkExisting.rows.length > 0) {
        cpaClientId = linkExisting.rows[0].id
      } else {
        cpaClientId = genCuid()
        await client.query(
          'INSERT INTO "CpaClient" (id, "cpaUserId", "clientUserId", "displayName", "createdAt") VALUES ($1, $2, $3, $4, NOW())',
          [cpaClientId, cpaUserId, clientUserId, clientName],
        )
        linkCreated = true
      }

      const movedTaxYears = taxYears.rows.length
      const movedAccounts = accounts.rows.length
      const movedProfiles = profiles.rows.length
      const movedDocuments = documents.rows.length

      if (movedTaxYears + movedAccounts + movedProfiles + movedDocuments + (linkCreated ? 1 : 0) === 0) {
        await client.query("COMMIT")
        console.log(`[seed-atif] nothing to do — all rows already in place for ${cpaEmail} → ${clientEmail}.`)
        return
      }

      await client.query(
        `INSERT INTO "AuditEvent" (id, "userId", "actorType", "actorCpaUserId", "eventType", "entityType", "entityId", "afterState", rationale, "occurredAt")
         VALUES ($1, $2, 'SYSTEM', $3, 'ATIF_SEEDED_VIA_SCRIPT', 'CpaClient', $4, $5::jsonb, $6, NOW())`,
        [
          genCuid(),
          clientUserId,
          cpaUserId,
          cpaClientId,
          JSON.stringify({
            cpaEmail,
            clientEmail,
            clientUserId,
            cpaUserId,
            movedTaxYears,
            movedAccounts,
            movedProfiles,
            movedDocuments,
            linkCreated,
          }),
          `Seeded by scripts/seed-atif.mjs at ${new Date().toISOString()}.`,
        ],
      )

      await client.query("COMMIT")
      console.log(
        `[seed-atif] ✓ ${cpaEmail} → ${clientEmail}: moved ${movedTaxYears} tax year(s), ${movedAccounts} account(s), ${movedProfiles} profile(s), ${movedDocuments} document(s); link ${linkCreated ? "created" : "already existed"}.`,
      )
    } catch (err) {
      await client.query("ROLLBACK")
      throw err
    }
  } catch (err) {
    console.error("[seed-atif] failure:", err)
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error("[seed-atif] uncaught:", err)
})
