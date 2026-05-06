// Boot-time backfill: materialize Document rows from existing StatementImport
// rows so the /clients/<id>/documents page shows what was uploaded.
//
// Why: bank/card statements come in via the upload flow which writes
// StatementImport rows, NOT Document rows. The Document model was added later
// for the redesigned documents page. So a client like Atif who has 4 accounts
// and N statements gets "0 documents" on his profile even though every PDF/CSV
// is on disk and has a StatementImport row.
//
// Plain JavaScript ES module using `pg` directly, matching scripts/bootstrap.mjs
// and scripts/seed-atif.mjs — runs in the production container without tsx
// and without importing the Prisma client (which is .ts only).
//
// Usage on Railway:
//   1. Set BACKFILL_DOCUMENTS_FOR_CPA=<cpa-email> in Variables → Deploy.
//      (or BACKFILL_DOCUMENTS_FOR_CLIENT=<client-email> to scope to one client)
//   2. After the deploy boots, this script:
//        a. for each client of that CPA (or just the one client),
//        b. finds StatementImport rows that don't yet have a Document row
//           with the same filePath,
//        c. inserts a Document row per StatementImport (category=STATEMENT,
//           tags=[institution, accountType], friendly title, taxYearId set,
//           uploadedByUserId = CPA who originally uploaded).
//   3. Remove the env var so subsequent deploys are no-ops.
//
// Idempotent: skips StatementImports whose filePath already has a Document
// row for the same user. Safe to re-run.

import pg from "pg"
import { existsSync, statSync } from "node:fs"

function genCuid() {
  const charset = "abcdefghijklmnopqrstuvwxyz0123456789"
  let id = "c"
  for (let i = 0; i < 24; i++) {
    id += charset[Math.floor(Math.random() * charset.length)]
  }
  return id
}

function inferMime(originalFilename, fileType) {
  const ext = (originalFilename.split(".").pop() ?? "").toLowerCase()
  if (ext === "pdf") return "application/pdf"
  if (ext === "csv") return "text/csv"
  if (ext === "ofx" || ext === "qfx") return "application/x-ofx"
  if (ext === "xlsx") return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  if (ext === "xls") return "application/vnd.ms-excel"
  if (fileType?.toLowerCase().includes("pdf")) return "application/pdf"
  if (fileType?.toLowerCase().includes("csv")) return "text/csv"
  return null
}

function fmtMonth(date) {
  if (!date) return null
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

function buildTitle({ institution, accountNickname, accountMask, accountType, periodStart, periodEnd, originalFilename }) {
  const inst = institution ?? "Statement"
  const acctTag = accountNickname || (accountMask ? `····${accountMask}` : null) || accountType || ""
  const startTag = fmtMonth(periodStart)
  const endTag = fmtMonth(periodEnd)
  const periodTag = startTag && endTag && startTag !== endTag
    ? `${startTag} → ${endTag}`
    : startTag ?? endTag ?? ""
  const parts = [inst, acctTag, periodTag].filter((s) => s && s.length > 0)
  if (parts.length === 0) return originalFilename
  return parts.join(" · ")
}

function buildTags({ institution, accountType, periodStart }) {
  const tags = []
  if (institution) tags.push(institution.toLowerCase().replace(/\s+/g, "-"))
  if (accountType) tags.push(accountType.toLowerCase().replace(/_/g, "-"))
  const month = fmtMonth(periodStart)
  if (month) tags.push(month)
  return tags
}

async function findClientUserIds(client, cpaEmail, clientEmail) {
  if (clientEmail) {
    const res = await client.query(
      'SELECT id FROM "User" WHERE email = $1 LIMIT 1',
      [clientEmail],
    )
    if (res.rows.length === 0) return { ids: [], cpaUserId: null }
    return { ids: [res.rows[0].id], cpaUserId: null }
  }
  if (cpaEmail) {
    const cpa = await client.query(
      'SELECT id FROM "User" WHERE email = $1 LIMIT 1',
      [cpaEmail],
    )
    if (cpa.rows.length === 0) return { ids: [], cpaUserId: null }
    const cpaUserId = cpa.rows[0].id
    const rels = await client.query(
      'SELECT "clientUserId" FROM "CpaClient" WHERE "cpaUserId" = $1',
      [cpaUserId],
    )
    return { ids: rels.rows.map((r) => r.clientUserId), cpaUserId }
  }
  return { ids: [], cpaUserId: null }
}

async function main() {
  const cpaEmail = process.env.BACKFILL_DOCUMENTS_FOR_CPA?.trim().toLowerCase()
  const clientEmail = process.env.BACKFILL_DOCUMENTS_FOR_CLIENT?.trim().toLowerCase()
  if (!cpaEmail && !clientEmail) {
    return
  }

  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error("[backfill-docs] DATABASE_URL not set; skipping.")
    return
  }

  const client = new pg.Client({ connectionString })
  try {
    await client.connect()

    const { ids: clientIds, cpaUserId } = await findClientUserIds(client, cpaEmail, clientEmail)
    if (clientIds.length === 0) {
      console.log(`[backfill-docs] no clients found for ${cpaEmail ?? clientEmail}; skipping.`)
      return
    }

    let totalCreated = 0
    let totalSkipped = 0

    for (const clientUserId of clientIds) {
      const imports = await client.query(
        `SELECT
           si.id              AS import_id,
           si."filePath"      AS file_path,
           si."originalFilename" AS original_filename,
           si."fileType"      AS file_type,
           si."institution"   AS institution,
           si."periodStart"   AS period_start,
           si."periodEnd"     AS period_end,
           si."uploadedAt"    AS uploaded_at,
           si."taxYearId"     AS tax_year_id,
           si."accountId"     AS account_id,
           si."transactionCount" AS txn_count,
           fa."type"          AS account_type,
           fa."nickname"      AS account_nickname,
           fa."mask"          AS account_mask
         FROM "StatementImport" si
         JOIN "TaxYear" ty ON ty.id = si."taxYearId"
         JOIN "FinancialAccount" fa ON fa.id = si."accountId"
         WHERE ty."userId" = $1
         ORDER BY si."uploadedAt" ASC`,
        [clientUserId],
      )

      for (const row of imports.rows) {
        const existing = await client.query(
          'SELECT id FROM "Document" WHERE "userId" = $1 AND "filePath" = $2 LIMIT 1',
          [clientUserId, row.file_path],
        )
        if (existing.rows.length > 0) {
          totalSkipped++
          continue
        }

        const title = buildTitle({
          institution: row.institution,
          accountNickname: row.account_nickname,
          accountMask: row.account_mask,
          accountType: row.account_type,
          periodStart: row.period_start,
          periodEnd: row.period_end,
          originalFilename: row.original_filename,
        })
        const tags = buildTags({
          institution: row.institution,
          accountType: row.account_type,
          periodStart: row.period_start,
        })
        const mime = inferMime(row.original_filename, row.file_type)
        let sizeBytes = null
        try {
          if (row.file_path && existsSync(row.file_path)) {
            sizeBytes = statSync(row.file_path).size
          }
        } catch {
          sizeBytes = null
        }
        const description = row.txn_count
          ? `${row.txn_count} transaction${row.txn_count === 1 ? "" : "s"} parsed from this statement.`
          : null

        await client.query(
          `INSERT INTO "Document"
             (id, "userId", "taxYearId", category, title, description,
              "filePath", "originalFilename", "mimeType", "sizeBytes",
              tags, "uploadedByUserId", "uploadedAt", "linkedTransactionIds")
           VALUES
             ($1, $2, $3, 'STATEMENT', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
          [
            genCuid(),
            clientUserId,
            row.tax_year_id,
            title,
            description,
            row.file_path,
            row.original_filename,
            mime,
            sizeBytes,
            tags,
            cpaUserId,
            new Date(row.uploaded_at),
            [],
          ],
        )
        totalCreated++
      }

      if (totalCreated > 0 || totalSkipped > 0) {
        await client.query(
          `INSERT INTO "AuditEvent"
             (id, "userId", "actorType", "actorCpaUserId", "eventType", "entityType", "entityId", "afterState", rationale, "occurredAt")
           VALUES
             ($1, $2, 'SYSTEM', $3, 'DOCUMENTS_BACKFILLED', 'Document', $4, $5::jsonb, $6, NOW())`,
          [
            genCuid(),
            clientUserId,
            cpaUserId,
            clientUserId,
            JSON.stringify({ created: totalCreated, skipped: totalSkipped }),
            `Backfilled by scripts/backfill-documents.mjs at ${new Date().toISOString()}.`,
          ],
        )
      }
    }

    console.log(
      `[backfill-docs] ✓ created ${totalCreated} Document row(s), skipped ${totalSkipped} pre-existing across ${clientIds.length} client(s).`,
    )
  } catch (err) {
    console.error("[backfill-docs] failure:", err)
  } finally {
    await client.end().catch(() => {})
  }
}

main().catch((err) => {
  console.error("[backfill-docs] uncaught:", err)
})
