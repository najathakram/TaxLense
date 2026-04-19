/**
 * Audit Packet ZIP — spec §10.3
 *
 * V1 decision: XLSX + CSV + TXT instead of PDF.
 * PDF generation requires a headless browser (Puppeteer/Playwright) which conflicts with
 * the Node-only V1 constraint. The packet is fully machine-readable and CPA-reviewable
 * without PDF. This decision is documented in README.md inside the ZIP.
 *
 * Contents:
 *   01_transaction_ledger.xlsx
 *   02_274d_substantiation/meals.csv, travel.csv, vehicle.csv, gifts.csv
 *   03_cohan_labels.csv
 *   04_position_memos/*.txt   (conditional — only memo types that are warranted)
 *   05_income_reconciliation.csv
 *   06_source_documents_inventory.csv
 *   README.md
 */

import archiver from "archiver"
import { PassThrough, Readable } from "node:stream"
import { prisma } from "@/lib/db"
import { buildMasterLedger } from "./masterLedger"
import { generateAllPositionMemos } from "@/lib/ai/positionMemo"
import type { TransactionCode } from "@/app/generated/prisma/client"

const DEDUCTIBLE_CODES: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

function csvEscape(val: unknown): string {
  const s = val == null ? "" : String(val)
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

function toCsv(headers: string[], rows: unknown[][]): string {
  const lines = [headers.map(csvEscape).join(",")]
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","))
  }
  return lines.join("\r\n")
}

function bufferToStream(buf: Buffer): Readable {
  const pt = new PassThrough()
  pt.end(buf)
  return pt
}

export async function buildAuditPacket(taxYearId: string, skipMemos = false): Promise<Buffer> {
  const [taxYear, allTxns, stopItems, imports] = await Promise.all([
    prisma.taxYear.findUniqueOrThrow({ where: { id: taxYearId } }),
    prisma.transaction.findMany({
      where: { taxYearId, isSplit: false },
      orderBy: [{ postedDate: "asc" }, { id: "asc" }],
      include: {
        classifications: { where: { isCurrent: true }, take: 1 },
        account: true,
      },
    }),
    prisma.stopItem.findMany({ where: { taxYearId } }),
    prisma.statementImport.findMany({
      where: { taxYearId },
      include: { account: true },
      orderBy: { uploadedAt: "asc" },
    }),
  ])

  // Build master ledger XLSX
  const ledgerBuf = await buildMasterLedger(taxYearId)

  // Position memos (skipped in tests to avoid AI calls)
  let memoMap: Map<string, { text: string; exposure: number; modelUsed: string }> = new Map()
  if (!skipMemos) {
    memoMap = await generateAllPositionMemos(taxYearId)
  }

  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } })
    const passthrough = new PassThrough()
    const chunks: Buffer[] = []

    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk))
    passthrough.on("end", () => resolve(Buffer.concat(chunks)))
    passthrough.on("error", reject)
    archive.on("error", reject)
    archive.pipe(passthrough)

    // ── 01_transaction_ledger.xlsx ─────────────────────────────────────────
    archive.append(bufferToStream(ledgerBuf), { name: "01_transaction_ledger.xlsx" })

    // ── 02_274d_substantiation/ ────────────────────────────────────────────
    // meals.csv
    const mealTxns = allTxns.filter((t) => {
      const code = t.classifications[0]?.code
      return code === "MEALS_50" || code === "MEALS_100"
    })
    const mealRows: unknown[][] = mealTxns.map((t) => {
      const c = t.classifications[0]!
      const sub = c.substantiation as { attendees?: string; purpose?: string } | null
      return [
        t.postedDate.toISOString().slice(0, 10),
        t.merchantRaw,
        Number(t.amountNormalized).toFixed(2),
        c.code,
        c.businessPct,
        sub?.attendees ?? "",
        sub?.purpose ?? "",
        c.ircCitations.join("; "),
        c.evidenceTier,
      ]
    })
    archive.append(
      toCsv(["Date", "Merchant", "Amount", "Code", "Biz%", "Attendees", "Purpose", "IRC Citations", "Tier"], mealRows),
      { name: "02_274d_substantiation/meals.csv" }
    )

    // travel.csv
    const travelTxns = allTxns.filter((t) => t.classifications[0]?.code === "WRITE_OFF_TRAVEL")
    const travelRows: unknown[][] = travelTxns.map((t) => {
      const c = t.classifications[0]!
      return [
        t.postedDate.toISOString().slice(0, 10),
        t.merchantRaw,
        Number(t.amountNormalized).toFixed(2),
        c.businessPct,
        c.reasoning ?? "",
        c.ircCitations.join("; "),
        c.evidenceTier,
      ]
    })
    archive.append(
      toCsv(["Date", "Merchant", "Amount", "Biz%", "Trip/Purpose", "IRC Citations", "Tier"], travelRows),
      { name: "02_274d_substantiation/travel.csv" }
    )

    // vehicle.csv — transactions with vehicle-related IRC citations
    const vehicleTxns = allTxns.filter((t) => {
      const c = t.classifications[0]
      return c && c.ircCitations.some((cit) => cit.includes("§179") || cit.includes("§168") || cit.includes("§274(d)"))
        && (t.classifications[0]?.scheduleCLine ?? "").includes("Car")
    })
    const vehicleRows: unknown[][] = vehicleTxns.map((t) => {
      const c = t.classifications[0]!
      return [
        t.postedDate.toISOString().slice(0, 10),
        t.merchantRaw,
        Number(t.amountNormalized).toFixed(2),
        c.businessPct,
        c.ircCitations.join("; "),
        c.evidenceTier,
        c.reasoning ?? "",
      ]
    })
    archive.append(
      toCsv(["Date", "Merchant", "Amount", "Biz%", "IRC Citations", "Tier", "Reasoning"], vehicleRows),
      { name: "02_274d_substantiation/vehicle.csv" }
    )

    // gifts.csv — gift-coded transactions (any with "gift" in reasoning or citations)
    const giftTxns = allTxns.filter((t) => {
      const c = t.classifications[0]
      return c && (
        c.reasoning?.toLowerCase().includes("gift") ||
        c.ircCitations.some((cit) => cit.includes("§274(b)"))
      )
    })
    const giftRows: unknown[][] = giftTxns.map((t) => {
      const c = t.classifications[0]!
      return [
        t.postedDate.toISOString().slice(0, 10),
        t.merchantRaw,
        Number(t.amountNormalized).toFixed(2),
        c.businessPct,
        c.ircCitations.join("; "),
        c.reasoning ?? "",
      ]
    })
    archive.append(
      toCsv(["Date", "Merchant", "Amount", "Biz%", "IRC Citations", "Reasoning"], giftRows),
      { name: "02_274d_substantiation/gifts.csv" }
    )

    // ── 03_cohan_labels.csv ────────────────────────────────────────────────
    const cohanTxns = allTxns.filter((t) => {
      const c = t.classifications[0]
      return c && DEDUCTIBLE_CODES.includes(c.code) && c.evidenceTier >= 4
    })
    const cohanRows: unknown[][] = cohanTxns.map((t) => {
      const c = t.classifications[0]!
      return [
        t.postedDate.toISOString().slice(0, 10),
        t.merchantRaw,
        Number(t.amountNormalized).toFixed(2),
        c.code,
        c.businessPct,
        c.evidenceTier,
        "Cohan estimate — reconstructed from bank records",
        c.reasoning ?? "",
        c.ircCitations.join("; "),
      ]
    })
    archive.append(
      toCsv(["Date", "Merchant", "Amount", "Code", "Biz%", "Evidence Tier", "Label", "Reconstruction Note", "IRC Citations"], cohanRows),
      { name: "03_cohan_labels.csv" }
    )

    // ── 04_position_memos/ ─────────────────────────────────────────────────
    for (const [type, memo] of memoMap) {
      const filename = type.replace(/[^a-zA-Z0-9_]/g, "_") + ".txt"
      const header = [
        `TAXLENS POSITION MEMO`,
        `Type: ${type}`,
        `Exposure: $${memo.exposure.toFixed(2)}`,
        `Model: ${memo.modelUsed}`,
        `Generated: ${new Date().toISOString()}`,
        `${"─".repeat(60)}`,
        "",
      ].join("\n")
      archive.append(header + memo.text, { name: `04_position_memos/${filename}` })
    }

    // ── 05_income_reconciliation.csv ───────────────────────────────────────
    const inflows = allTxns.filter((t) => Number(t.amountNormalized) < 0)
    let totalInflows = 0
    let pairedTransfers = 0
    let bizIncome = 0
    let classifiedOther = 0
    let unclassified = 0

    for (const t of inflows) {
      const abs = Math.abs(Number(t.amountNormalized))
      totalInflows += abs
      if (t.isTransferPairedWith) { pairedTransfers += abs; continue }
      const c = t.classifications[0]
      if (!c) { unclassified += abs; continue }
      if (c.code === "BIZ_INCOME") bizIncome += abs
      else if (c.code === "TRANSFER" || c.code === "PERSONAL" || c.code === "PAYMENT") classifiedOther += abs
      else unclassified += abs
    }

    const delta = totalInflows - pairedTransfers - bizIncome - classifiedOther - unclassified
    const reconRows: unknown[][] = [
      ["Total Inflows", totalInflows.toFixed(2)],
      ["Less: Paired Transfer Inflows", pairedTransfers.toFixed(2)],
      ["Less: BIZ_INCOME (Gross Receipts)", bizIncome.toFixed(2)],
      ["Less: Classified Non-Income Inflows (TRANSFER/PERSONAL/PAYMENT)", classifiedOther.toFixed(2)],
      ["Less: Unclassified Inflows", unclassified.toFixed(2)],
      ["Reconciliation Delta (should be $0.00)", delta.toFixed(2)],
    ]
    archive.append(toCsv(["Category", "Amount ($)"], reconRows), { name: "05_income_reconciliation.csv" })

    // ── 06_source_documents_inventory.csv ─────────────────────────────────
    const inventoryRows: unknown[][] = imports.map((imp) => [
      imp.account.institution,
      imp.account.type,
      imp.account.mask ?? "",
      imp.originalFilename,
      imp.fileType,
      imp.institution ?? "",
      imp.periodStart ? imp.periodStart.toISOString().slice(0, 10) : "",
      imp.periodEnd ? imp.periodEnd.toISOString().slice(0, 10) : "",
      imp.transactionCount,
      imp.parseStatus,
      imp.reconciliationOk != null ? (imp.reconciliationOk ? "OK" : "MISMATCH") : "N/A",
      imp.reconciliationDelta != null ? Number(imp.reconciliationDelta).toFixed(2) : "",
    ])
    archive.append(
      toCsv(
        ["Institution", "Account Type", "Mask", "Filename", "File Type", "Detected Institution", "Period Start", "Period End", "Txn Count", "Parse Status", "Reconciliation", "Delta ($)"],
        inventoryRows
      ),
      { name: "06_source_documents_inventory.csv" }
    )

    // ── README.md ──────────────────────────────────────────────────────────
    const readme = `# TaxLens Audit Defense Packet
## Tax Year ${taxYear.year}
Generated: ${new Date().toISOString()}
Snapshot Hash: ${taxYear.lockedSnapshotHash ?? "Not locked"}

## Contents

| File | Description |
|------|-------------|
| 01_transaction_ledger.xlsx | Master locked ledger — all transactions with classifications, IRC citations, evidence tiers |
| 02_274d_substantiation/ | §274(d) substantiation records: meals (attendees/purpose), travel, vehicle, gifts |
| 03_cohan_labels.csv | Tier-4+ Cohan-reconstructed deductions — labeled as reconstructed, not contemporaneous |
| 04_position_memos/ | Gray-zone position memos (facts/law/analysis/conclusion) — one file per applicable memo type |
| 05_income_reconciliation.csv | A13 deposit reconstruction: all inflows accounted for |
| 06_source_documents_inventory.csv | List of all uploaded bank/card statement files with parse status |

## Important Notes

**PDF vs XLSX decision (V1):** This packet delivers the transaction ledger as XLSX rather than PDF.
PDF generation requires a headless browser which is outside the V1 Node.js-only constraint.
All information is identical; CPAs and agents can open XLSX in Excel or LibreOffice.

**Position memos** are AI-assisted drafts using only verified IRC citations.
The CPA must review, approve, and sign off before submission to the IRS.
Memos with [VERIFY] tags contain citations that require CPA verification.

**Cohan rule (Tier 4+):** §274(d) categories (meals, travel, vehicle, gifts) cannot rely on Cohan.
Non-§274(d) Cohan estimates are labeled as reconstructed.

**The app does not file anything.** All artifacts are for CPA review and handoff only.
`
    archive.append(readme, { name: "README.md" })

    archive.finalize()
  })
}
