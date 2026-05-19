/**
 * Financial Statements CSV bundle — same 5 sheets as buildFinancialStatements()
 * but exported as a ZIP of UTF-8 CSV files plus a manifest and README.
 *
 * Source-of-truth strategy: we generate the XLSX via buildFinancialStatements()
 * and then transcode each worksheet to CSV. This guarantees the CSV numbers
 * never drift from the XLSX (same builder, same totals, same Schedule C line
 * mapping for the entity).
 *
 * Contents (sorted so unzippers preserve order):
 *   00_README.md
 *   01_general_ledger.csv
 *   02_<schedule>.csv             (e.g. 02_schedule_c.csv, 02_form_1120s.csv)
 *   03_profit_and_loss.csv
 *   04_balance_sheet.csv
 *   05_<schedule>_detail.csv
 *   manifest.json                 (entity, year, hash, totals, generated-at)
 */

import archiver from "archiver"
import ExcelJS from "exceljs"
import { PassThrough } from "node:stream"
import { prisma } from "@/lib/db"
import { buildFinancialStatements } from "./financialStatements"

function csvEscape(val: ExcelJS.CellValue): string {
  if (val == null) return ""
  // ExcelJS rich-text / hyperlink cells expose .text or .result
  let s: string
  if (typeof val === "object") {
    if ("result" in val && val.result != null) s = String(val.result)
    else if ("text" in val && val.text != null) s = String(val.text)
    else if (val instanceof Date) s = val.toISOString().slice(0, 10)
    else s = JSON.stringify(val)
  } else {
    s = String(val)
  }
  if (s.includes(",") || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function sheetToCsv(ws: ExcelJS.Worksheet): string {
  const lines: string[] = []
  ws.eachRow({ includeEmpty: false }, (row) => {
    const cells: string[] = []
    const last = row.cellCount
    for (let i = 1; i <= last; i++) {
      cells.push(csvEscape(row.getCell(i).value))
    }
    lines.push(cells.join(","))
  })
  return lines.join("\r\n")
}

function safeFilename(name: string): string {
  return name
    .toLowerCase()
    // Keep separator-friendly conversions BEFORE collapsing non-alnum to _.
    // Otherwise "P&L" → "pandl" instead of the readable "p_and_l".
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40)
}

interface ManifestEntry {
  filename: string
  sheetName: string
  rowCount: number
}

interface CsvManifest {
  taxYear: number
  taxpayerName: string | null
  taxpayerEmail: string | null
  businessDescription: string | null
  entityType: string | null
  naicsCode: string | null
  generatedAt: string
  lockedAt: string | null
  lockedSnapshotHash: string | null
  sheets: ManifestEntry[]
  note: string
}

export async function buildFinancialStatementsCsvZip(taxYearId: string): Promise<Buffer> {
  const [taxYear, profile, user] = await Promise.all([
    prisma.taxYear.findUniqueOrThrow({ where: { id: taxYearId } }),
    prisma.businessProfile.findUnique({ where: { taxYearId } }),
    prisma.taxYear
      .findUniqueOrThrow({ where: { id: taxYearId }, include: { user: true } })
      .then((ty) => ty.user),
  ])

  // Build the XLSX as the source of truth, then transcode.
  const xlsxBuf = await buildFinancialStatements(taxYearId)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(new Uint8Array(xlsxBuf).buffer as ArrayBuffer)

  const manifestSheets: ManifestEntry[] = []
  const csvFiles: { name: string; content: string }[] = []

  // Auto-number sheets in workbook order so we never collide on prefixes when
  // buildFinancialStatements() adds new sheets (Cash Flow, Trial Balance,
  // Vendor List etc.) in future revisions. ExcelJS's eachSheet visits in
  // insertion order, which is the order they're built and displayed in Excel.
  let idx = 0
  wb.eachSheet((ws) => {
    idx++
    const seq = idx.toString().padStart(2, "0")
    const filename = `${seq}_${safeFilename(ws.name)}.csv`
    const csv = sheetToCsv(ws)
    csvFiles.push({ name: filename, content: csv })
    manifestSheets.push({
      filename,
      sheetName: ws.name,
      rowCount: ws.rowCount,
    })
  })

  const manifest: CsvManifest = {
    taxYear: taxYear.year,
    taxpayerName: user?.name ?? null,
    taxpayerEmail: user?.email ?? null,
    businessDescription: profile?.businessDescription ?? null,
    entityType: profile?.entityType ?? null,
    naicsCode: profile?.naicsCode ?? null,
    generatedAt: new Date().toISOString(),
    lockedAt: taxYear.lockedAt?.toISOString() ?? null,
    lockedSnapshotHash: taxYear.lockedSnapshotHash ?? null,
    sheets: manifestSheets,
    note:
      "These CSVs were transcoded from the locked XLSX financial statements. " +
      "All numbers tie out to the locked snapshot; if the locked hash changes, " +
      "re-generate from /api/years/<year>/download/financial-statements-csv.",
  }

  const readme = renderReadme(manifest)

  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } })
    const passthrough = new PassThrough()
    const chunks: Buffer[] = []
    passthrough.on("data", (c: Buffer) => chunks.push(c))
    passthrough.on("end", () => resolve(Buffer.concat(chunks)))
    passthrough.on("error", reject)
    archive.on("error", reject)
    archive.pipe(passthrough)

    archive.append(readme, { name: "00_README.md" })
    for (const f of csvFiles) {
      archive.append(f.content, { name: f.name })
    }
    archive.append(JSON.stringify(manifest, null, 2), { name: "manifest.json" })

    archive.finalize().catch(reject)
  })
}

function renderReadme(m: CsvManifest): string {
  const lines: string[] = []
  lines.push(`# Financial Statements — Tax Year ${m.taxYear} (CSV bundle)`)
  lines.push("")
  if (m.taxpayerName) lines.push(`**Taxpayer:** ${m.taxpayerName}`)
  if (m.taxpayerEmail) lines.push(`**Account:** ${m.taxpayerEmail}`)
  if (m.entityType) lines.push(`**Entity type:** ${m.entityType}`)
  if (m.naicsCode) lines.push(`**NAICS:** ${m.naicsCode}`)
  if (m.businessDescription) lines.push(`**Business:** ${m.businessDescription}`)
  if (m.lockedAt) lines.push(`**Locked at:** ${m.lockedAt}`)
  if (m.lockedSnapshotHash) lines.push(`**Snapshot hash:** \`${m.lockedSnapshotHash}\``)
  lines.push(`**Generated:** ${m.generatedAt}`)
  lines.push("")
  lines.push("## Contents")
  lines.push("")
  lines.push("| File | Source sheet | Rows |")
  lines.push("|---|---|---|")
  for (const s of m.sheets) {
    lines.push(`| \`${s.filename}\` | ${s.sheetName} | ${s.rowCount} |`)
  }
  lines.push("")
  lines.push("## Notes")
  lines.push("")
  lines.push(
    "- Numbers are transcoded directly from the locked XLSX. They tie out to the snapshot hash above.",
  )
  lines.push(
    "- CSV encoding: UTF-8, CRLF line endings, RFC-4180 quoting (fields with `,` or `\"` are double-quoted).",
  )
  lines.push(
    "- For tools that need a single multi-sheet file, use the XLSX variant at `/api/years/<year>/download/financial-statements`.",
  )
  lines.push("- `manifest.json` carries the metadata in machine-readable form.")
  return lines.join("\n")
}
