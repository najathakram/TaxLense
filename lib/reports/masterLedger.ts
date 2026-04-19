/**
 * Master Ledger XLSX — spec §10.1
 *
 * Five sheets:
 *   1. Transactions — every non-split txn + current classification, color-coded
 *   2. Merchant Rules — one row per MerchantRule
 *   3. Stop Resolutions — one row per StopItem
 *   4. Profile Snapshot — key/value BusinessProfile dump
 *   5. Metadata — TaxYear lock info + report timestamp
 */

import ExcelJS from "exceljs"
import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"

// ARGB fill colors per spec §10.1 code coloring
const CODE_FILL: Record<TransactionCode, string> = {
  WRITE_OFF: "FFD1FAE5",
  WRITE_OFF_TRAVEL: "FFD1FAE5",
  WRITE_OFF_COGS: "FFD1FAE5",
  MEALS_50: "FFFEF3C7",
  MEALS_100: "FFFEF3C7",
  GRAY: "FFFEF3C7",
  PERSONAL: "FFFEE2E2",
  TRANSFER: "FFDBEAFE",
  PAYMENT: "FFDBEAFE",
  BIZ_INCOME: "FFD1FCE4",
  NEEDS_CONTEXT: "FFFEF9C3",
}

function fillFor(code: TransactionCode | undefined): ExcelJS.Fill | undefined {
  if (!code) return undefined
  const argb = CODE_FILL[code]
  if (!argb) return undefined
  return { type: "pattern", pattern: "solid", fgColor: { argb } }
}

function headerFill(): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } }
}

function applyHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true }
  row.fill = headerFill()
  row.border = {
    bottom: { style: "thin", color: { argb: "FF9CA3AF" } },
  }
}

function colorRow(row: ExcelJS.Row, code: TransactionCode | undefined): void {
  const fill = fillFor(code)
  if (!fill) return
  row.eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = fill
  })
}

export async function buildMasterLedger(taxYearId: string): Promise<Buffer> {
  const [taxYear, transactions, merchantRules, stopItems, profile] = await Promise.all([
    prisma.taxYear.findUniqueOrThrow({
      where: { id: taxYearId },
      include: { financialAccounts: true },
    }),
    prisma.transaction.findMany({
      where: { taxYearId, isSplit: false },
      orderBy: [{ postedDate: "asc" }, { id: "asc" }],
      include: {
        classifications: { where: { isCurrent: true }, take: 1 },
        account: true,
      },
    }),
    prisma.merchantRule.findMany({
      where: { taxYearId },
      orderBy: { merchantKey: "asc" },
    }),
    prisma.stopItem.findMany({
      where: { taxYearId },
      orderBy: { id: "asc" },
    }),
    prisma.businessProfile.findUnique({
      where: { taxYearId },
      include: { trips: true, knownEntities: true },
    }),
  ])

  const wb = new ExcelJS.Workbook()
  wb.creator = "TaxLens v0.7"
  wb.created = new Date()

  // ── Sheet 1: Transactions ──────────────────────────────────────────────────
  const txSheet = wb.addWorksheet("Transactions")
  txSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Account", key: "account", width: 22 },
    { header: "Merchant Raw", key: "merchantRaw", width: 32 },
    { header: "Merchant Normalized", key: "merchantNorm", width: 28 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Code", key: "code", width: 16 },
    { header: "Sch C Line", key: "schCLine", width: 24 },
    { header: "Biz %", key: "bizPct", width: 8 },
    { header: "Deductible Amt", key: "deductible", width: 15 },
    { header: "IRC Citations", key: "irc", width: 36 },
    { header: "Evidence Tier", key: "tier", width: 13 },
    { header: "Confidence", key: "confidence", width: 11 },
    { header: "Source", key: "source", width: 18 },
    { header: "Reasoning", key: "reasoning", width: 50 },
    { header: "Split", key: "split", width: 8 },
  ]
  applyHeaderRow(txSheet.getRow(1))
  txSheet.views = [{ state: "frozen", ySplit: 1 }]
  txSheet.autoFilter = { from: "A1", to: "O1" }

  for (const tx of transactions) {
    const c = tx.classifications[0]
    const amt = Number(tx.amountNormalized)
    const bizPct = c?.businessPct ?? 0
    const deductible = c && bizPct > 0 && amt > 0 ? (amt * bizPct) / 100 : 0
    const accountLabel = `${tx.account.institution} ${tx.account.mask ? `…${tx.account.mask}` : ""}`.trim()

    const row = txSheet.addRow({
      date: tx.postedDate.toISOString().slice(0, 10),
      account: accountLabel,
      merchantRaw: tx.merchantRaw,
      merchantNorm: tx.merchantNormalized ?? "",
      amount: amt,
      code: c?.code ?? "",
      schCLine: c?.scheduleCLine ?? "",
      bizPct: bizPct,
      deductible: deductible > 0 ? deductible : "",
      irc: c?.ircCitations?.join(", ") ?? "",
      tier: c?.evidenceTier ?? "",
      confidence: c?.confidence != null ? Math.round(c.confidence * 100) / 100 : "",
      source: c?.source ?? "",
      reasoning: c?.reasoning ?? "",
      split: tx.splitOfId ? "child" : "",
    })

    // Number formatting
    row.getCell("amount").numFmt = '#,##0.00;[Red]-#,##0.00'
    if (deductible > 0) row.getCell("deductible").numFmt = '#,##0.00'
    if (c?.confidence != null) row.getCell("confidence").numFmt = '0.00'

    colorRow(row, c?.code)
  }

  // ── Sheet 2: Merchant Rules ────────────────────────────────────────────────
  const mrSheet = wb.addWorksheet("Merchant Rules")
  mrSheet.columns = [
    { header: "Merchant Key", key: "key", width: 30 },
    { header: "Code", key: "code", width: 16 },
    { header: "Sch C Line", key: "schCLine", width: 24 },
    { header: "Default Biz %", key: "bizPct", width: 14 },
    { header: "IRC Citations", key: "irc", width: 36 },
    { header: "Tier", key: "tier", width: 8 },
    { header: "Confidence", key: "confidence", width: 11 },
    { header: "Confirmed", key: "confirmed", width: 11 },
    { header: "Total Txns", key: "totalTxns", width: 11 },
    { header: "Total Amt", key: "totalAmt", width: 12 },
    { header: "Requires Human", key: "requiresHuman", width: 15 },
    { header: "Human Question", key: "question", width: 40 },
  ]
  applyHeaderRow(mrSheet.getRow(1))
  mrSheet.views = [{ state: "frozen", ySplit: 1 }]
  mrSheet.autoFilter = { from: "A1", to: "L1" }

  for (const mr of merchantRules) {
    const row = mrSheet.addRow({
      key: mr.merchantKey,
      code: mr.code,
      schCLine: mr.scheduleCLine ?? "",
      bizPct: mr.businessPctDefault,
      irc: mr.ircCitations.join(", "),
      tier: mr.evidenceTierDefault,
      confidence: Math.round(mr.confidence * 100) / 100,
      confirmed: mr.isConfirmed ? "YES" : "no",
      totalTxns: mr.totalTransactions,
      totalAmt: Number(mr.totalAmount),
      requiresHuman: mr.requiresHumanInput ? "YES" : "",
      question: mr.humanQuestion ?? "",
    })
    row.getCell("totalAmt").numFmt = '#,##0.00'
    row.getCell("confidence").numFmt = '0.00'
  }

  // ── Sheet 3: Stop Resolutions ──────────────────────────────────────────────
  const stopSheet = wb.addWorksheet("Stop Resolutions")
  stopSheet.columns = [
    { header: "Category", key: "category", width: 16 },
    { header: "Question", key: "question", width: 50 },
    { header: "State", key: "state", width: 12 },
    { header: "User Answer", key: "answer", width: 40 },
    { header: "Answered At", key: "answeredAt", width: 20 },
    { header: "# Affected Txns", key: "txnCount", width: 16 },
  ]
  applyHeaderRow(stopSheet.getRow(1))
  stopSheet.views = [{ state: "frozen", ySplit: 1 }]
  stopSheet.autoFilter = { from: "A1", to: "F1" }

  for (const s of stopItems) {
    stopSheet.addRow({
      category: s.category,
      question: s.question,
      state: s.state,
      answer: s.userAnswer ? JSON.stringify(s.userAnswer) : "",
      answeredAt: s.answeredAt ? s.answeredAt.toISOString().slice(0, 19).replace("T", " ") : "",
      txnCount: s.transactionIds.length,
    })
  }

  // ── Sheet 4: Profile Snapshot ──────────────────────────────────────────────
  const profSheet = wb.addWorksheet("Profile Snapshot")
  profSheet.columns = [
    { header: "Field", key: "field", width: 30 },
    { header: "Value", key: "value", width: 60 },
  ]
  applyHeaderRow(profSheet.getRow(1))

  const profRows: [string, string][] = []
  if (profile) {
    const ho = profile.homeOfficeConfig as { has?: boolean; method?: string; officeSqft?: number } | null
    const vc = profile.vehicleConfig as { has?: boolean; bizPct?: number } | null
    profRows.push(
      ["Entity Type", profile.entityType],
      ["NAICS Code", profile.naicsCode ?? ""],
      ["Primary State", profile.primaryState],
      ["Business Description", profile.businessDescription ?? ""],
      ["Accounting Method", profile.accountingMethod],
      ["Gross Receipts Estimate", profile.grossReceiptsEstimate ? `$${Number(profile.grossReceiptsEstimate).toFixed(2)}` : ""],
      ["First Year", profile.firstYear ? "Yes" : "No"],
      ["Revenue Streams", profile.revenueStreams.join(", ")],
      ["Home Office", ho?.has ? `Yes — ${ho.method ?? "SIMPLIFIED"}, ${ho.officeSqft ?? 0} sqft` : "No"],
      ["Vehicle", vc?.has ? `Yes — ${vc.bizPct ?? 0}% business` : "No"],
      ["Trips Count", String(profile.trips.length)],
      ["Known Entities Count", String(profile.knownEntities.length)],
    )

    for (const trip of profile.trips) {
      profRows.push([
        `Trip: ${trip.name}`,
        `${trip.destination} | ${trip.startDate.toISOString().slice(0, 10)} – ${trip.endDate.toISOString().slice(0, 10)} | ${trip.purpose}`,
      ])
    }
  } else {
    profRows.push(["Profile", "No profile found"])
  }

  for (const [field, value] of profRows) {
    profSheet.addRow({ field, value })
  }

  // ── Sheet 5: Metadata ──────────────────────────────────────────────────────
  const metaSheet = wb.addWorksheet("Metadata")
  metaSheet.columns = [
    { header: "Key", key: "key", width: 30 },
    { header: "Value", key: "value", width: 60 },
  ]
  applyHeaderRow(metaSheet.getRow(1))

  const metaRows: [string, string][] = [
    ["TaxLens Version", "0.7"],
    ["Report Type", "Master Ledger"],
    ["Tax Year", String(taxYear.year)],
    ["Status", taxYear.status],
    ["Locked At", taxYear.lockedAt ? taxYear.lockedAt.toISOString() : "Not locked"],
    ["Snapshot Hash", taxYear.lockedSnapshotHash ?? "N/A"],
    ["Report Generated At", new Date().toISOString()],
    ["Total Transactions", String(transactions.length)],
    ["Total Accounts", String(taxYear.financialAccounts.length)],
    ["Total Merchant Rules", String(merchantRules.length)],
    ["Total Stop Items", String(stopItems.length)],
  ]

  for (const [key, value] of metaRows) {
    metaSheet.addRow({ key, value })
  }

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
