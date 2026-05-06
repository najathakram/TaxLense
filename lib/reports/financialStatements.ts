/**
 * Financial Statements XLSX — spec §10.2
 *
 * Five sheets:
 *   1. General Ledger  — deductible txns sorted by Sch C line then date
 *   2. Schedule C      — one row per line, totals, IRC citations
 *   3. P&L             — Gross Receipts → COGS → Gross Profit → Expenses → Net Income
 *   4. Balance Sheet   — cash-method sole prop: cash assets + equity
 *   5. Schedule C Detail — every deductible txn grouped by line with section headers
 */

import ExcelJS from "exceljs"
import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"
import { SCHEDULE_C_LINES } from "@/lib/classification/constants"
import {
  DEDUCTIBLE_CODES as SHARED_DEDUCTIBLE_CODES,
  computeDeductibleAmt,
} from "@/lib/classification/deductible"

const DEDUCTIBLE_CODES = SHARED_DEDUCTIBLE_CODES as readonly TransactionCode[]

function deductibleAmt(amountNormalized: number, code: TransactionCode, bizPct: number): number {
  return computeDeductibleAmt(amountNormalized, code, bizPct)
}

function headerFill(): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: "FFE5E7EB" } }
}
function sectionFill(): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: "FFF3F4F6" } }
}
function subtotalFill(): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: "FFDBEAFE" } }
}
function totalFill(): ExcelJS.Fill {
  return { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } }
}

function applyHeaderRow(row: ExcelJS.Row): void {
  row.font = { bold: true }
  row.fill = headerFill()
  row.border = { bottom: { style: "thin", color: { argb: "FF9CA3AF" } } }
}

type ClassifiedTx = {
  id: string
  postedDate: Date
  amountNormalized: number
  merchantRaw: string
  merchantNormalized: string | null
  account: { institution: string; mask: string | null }
  classification: {
    code: TransactionCode
    scheduleCLine: string | null
    businessPct: number
    ircCitations: string[]
    evidenceTier: number
    confidence: number
    source: string
    reasoning: string | null
  }
}

async function loadClassifiedTxns(taxYearId: string): Promise<ClassifiedTx[]> {
  const rows = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false },
    orderBy: [{ postedDate: "asc" }, { id: "asc" }],
    include: {
      classifications: { where: { isCurrent: true }, take: 1 },
      account: true,
    },
  })

  return rows
    .filter((r) => r.classifications[0] != null)
    .map((r) => ({
      id: r.id,
      postedDate: r.postedDate,
      amountNormalized: Number(r.amountNormalized),
      merchantRaw: r.merchantRaw,
      merchantNormalized: r.merchantNormalized,
      account: r.account,
      classification: {
        code: r.classifications[0]!.code,
        scheduleCLine: r.classifications[0]!.scheduleCLine,
        businessPct: r.classifications[0]!.businessPct,
        ircCitations: r.classifications[0]!.ircCitations,
        evidenceTier: r.classifications[0]!.evidenceTier,
        confidence: r.classifications[0]!.confidence,
        source: r.classifications[0]!.source,
        reasoning: r.classifications[0]!.reasoning,
      },
    }))
}

export async function buildFinancialStatements(taxYearId: string): Promise<Buffer> {
  const [taxYear, allTxns, profile] = await Promise.all([
    prisma.taxYear.findUniqueOrThrow({ where: { id: taxYearId } }),
    loadClassifiedTxns(taxYearId),
    prisma.businessProfile.findUnique({ where: { taxYearId } }),
  ])

  const wb = new ExcelJS.Workbook()
  wb.creator = "TaxLens v0.7"
  wb.created = new Date()

  const deductibleTxns = allTxns.filter((t) => DEDUCTIBLE_CODES.includes(t.classification.code))
  const incomeTxns = allTxns.filter((t) => t.classification.code === "BIZ_INCOME")
  const cogsTxns = deductibleTxns.filter((t) => t.classification.code === "WRITE_OFF_COGS")

  // Precompute totals by Sch C line
  type LineTotal = { line: string; total: number; count: number; ircs: Set<string> }
  const lineTotals = new Map<string, LineTotal>()

  for (const tx of deductibleTxns) {
    const line = tx.classification.scheduleCLine ?? "N/A"
    if (!lineTotals.has(line)) {
      lineTotals.set(line, { line, total: 0, count: 0, ircs: new Set() })
    }
    const entry = lineTotals.get(line)!
    entry.total += deductibleAmt(tx.amountNormalized, tx.classification.code, tx.classification.businessPct)
    entry.count++
    for (const cit of tx.classification.ircCitations) entry.ircs.add(cit)
  }

  const grossRevenue = incomeTxns.reduce((s, t) => s + Math.abs(t.amountNormalized), 0)
  const cogsTotal = cogsTxns.reduce((s, t) => s + deductibleAmt(t.amountNormalized, t.classification.code, t.classification.businessPct), 0)
  const totalDeductible = [...lineTotals.values()].reduce((s, lt) => s + lt.total, 0)
  const netIncome = grossRevenue - totalDeductible

  // ── Sheet 1: General Ledger ──────────────────────────────────────────────
  const glSheet = wb.addWorksheet("General Ledger")
  glSheet.columns = [
    { header: "Date", key: "date", width: 12 },
    { header: "Account", key: "account", width: 20 },
    { header: "Merchant", key: "merchant", width: 30 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Biz %", key: "bizPct", width: 8 },
    { header: "Deductible", key: "deductible", width: 13 },
    { header: "Sch C Line", key: "schCLine", width: 24 },
    { header: "IRC Citations", key: "irc", width: 36 },
    { header: "Tier", key: "tier", width: 6 },
  ]
  applyHeaderRow(glSheet.getRow(1))
  glSheet.views = [{ state: "frozen", ySplit: 1 }]
  glSheet.autoFilter = { from: "A1", to: "I1" }

  // Sort by Sch C line order then date
  const lineOrder = new Map(SCHEDULE_C_LINES.map((l, i) => [l, i]))
  const sortedDed = [...deductibleTxns].sort((a, b) => {
    const la = lineOrder.get(a.classification.scheduleCLine ?? "N/A") ?? 999
    const lb = lineOrder.get(b.classification.scheduleCLine ?? "N/A") ?? 999
    if (la !== lb) return la - lb
    return a.postedDate.getTime() - b.postedDate.getTime()
  })

  let currentLine: string | null = null
  for (const tx of sortedDed) {
    const line = tx.classification.scheduleCLine ?? "N/A"
    if (line !== currentLine) {
      currentLine = line
      const subRow = glSheet.addRow({ date: line, account: "", merchant: "", amount: "", bizPct: "", deductible: "", schCLine: "", irc: "", tier: "" })
      subRow.font = { bold: true, italic: true }
      subRow.fill = sectionFill()
    }
    const ded = deductibleAmt(tx.amountNormalized, tx.classification.code, tx.classification.businessPct)
    const r = glSheet.addRow({
      date: tx.postedDate.toISOString().slice(0, 10),
      account: `${tx.account.institution}${tx.account.mask ? ` …${tx.account.mask}` : ""}`,
      merchant: tx.merchantNormalized ?? tx.merchantRaw,
      amount: tx.amountNormalized,
      bizPct: tx.classification.businessPct,
      deductible: ded,
      schCLine: line,
      irc: tx.classification.ircCitations.join(", "),
      tier: tx.classification.evidenceTier,
    })
    r.getCell("amount").numFmt = '#,##0.00'
    r.getCell("deductible").numFmt = '#,##0.00'
  }

  // Subtotal rows per line
  for (const lt of [...lineTotals.values()].sort((a, b) => (lineOrder.get(a.line) ?? 999) - (lineOrder.get(b.line) ?? 999))) {
    const subRow = glSheet.addRow({ date: `Subtotal — ${lt.line}`, deductible: lt.total })
    subRow.font = { bold: true }
    subRow.fill = subtotalFill()
    subRow.getCell("deductible").numFmt = '#,##0.00'
  }

  const glTotalRow = glSheet.addRow({ date: "TOTAL DEDUCTIONS", deductible: totalDeductible })
  glTotalRow.font = { bold: true, size: 12 }
  glTotalRow.fill = totalFill()
  glTotalRow.getCell("deductible").numFmt = '#,##0.00'

  // ── Sheet 2: Schedule C ──────────────────────────────────────────────────
  const schSheet = wb.addWorksheet("Schedule C")
  schSheet.columns = [
    { header: "Schedule C Line", key: "line", width: 28 },
    { header: "Total Deductible ($)", key: "total", width: 20 },
    { header: "# Transactions", key: "count", width: 15 },
    { header: "IRC Citations", key: "irc", width: 50 },
  ]
  applyHeaderRow(schSheet.getRow(1))
  schSheet.views = [{ state: "frozen", ySplit: 1 }]

  for (const line of SCHEDULE_C_LINES) {
    const lt = lineTotals.get(line)
    if (!lt || lt.total === 0) continue
    const r = schSheet.addRow({
      line,
      total: lt.total,
      count: lt.count,
      irc: [...lt.ircs].join(", "),
    })
    r.getCell("total").numFmt = '#,##0.00'
  }

  const schTotalRow = schSheet.addRow({ line: "TOTAL DEDUCTIONS", total: totalDeductible, count: deductibleTxns.length })
  schTotalRow.font = { bold: true }
  schTotalRow.fill = totalFill()
  schTotalRow.getCell("total").numFmt = '#,##0.00'

  // ── Sheet 3: P&L ─────────────────────────────────────────────────────────
  const plSheet = wb.addWorksheet("P&L")
  plSheet.columns = [
    { header: "Category", key: "cat", width: 35 },
    { header: "Amount ($)", key: "amt", width: 18 },
    { header: "Notes", key: "notes", width: 40 },
  ]
  applyHeaderRow(plSheet.getRow(1))

  const addPLRow = (cat: string, amt: number | "", notes = "", bold = false, fill?: ExcelJS.Fill) => {
    const r = plSheet.addRow({ cat, amt, notes })
    if (bold) r.font = { bold: true }
    if (fill) r.fill = fill
    if (typeof amt === "number") r.getCell("amt").numFmt = '#,##0.00'
    return r
  }

  addPLRow(`REVENUE — Tax Year ${taxYear.year}`, "", "", true, sectionFill())
  addPLRow("Gross Receipts (BIZ_INCOME)", grossRevenue, "Sum of all BIZ_INCOME txns")
  addPLRow("Less: Cost of Goods Sold", -cogsTotal, "WRITE_OFF_COGS (Part III)")
  addPLRow("Gross Profit", grossRevenue - cogsTotal, "", true, subtotalFill())
  addPLRow("", "", "")
  addPLRow("OPERATING EXPENSES", "", "", true, sectionFill())

  const nonCogsLines = [...lineTotals.entries()]
    .filter(([line]) => !line.includes("COGS"))
    .sort((a, b) => (lineOrder.get(a[0]) ?? 999) - (lineOrder.get(b[0]) ?? 999))

  for (const [line, lt] of nonCogsLines) {
    addPLRow(line, lt.total)
  }

  const opExpenses = nonCogsLines.reduce((s, [, lt]) => s + lt.total, 0)
  addPLRow("Total Operating Expenses", opExpenses, "", true, subtotalFill())
  addPLRow("", "", "")
  addPLRow("Net Income / (Loss)", netIncome, "Before SE tax and QBI deductions", true, totalFill())
  addPLRow("", "", "")
  addPLRow("NOTE", "", "This is a cash-method Schedule C summary. Consult your CPA for SE tax, QBI, and state return adjustments.")

  // ── Sheet 4: Balance Sheet ────────────────────────────────────────────────
  const bsSheet = wb.addWorksheet("Balance Sheet")
  bsSheet.columns = [
    { header: "Item", key: "item", width: 35 },
    { header: "Amount ($)", key: "amt", width: 18 },
    { header: "Notes", key: "notes", width: 40 },
  ]
  applyHeaderRow(bsSheet.getRow(1))

  const accounts = await prisma.financialAccount.findMany({
    where: { taxYearId },
    include: {
      transactions: {
        where: { taxYearId, isSplit: false },
        select: { amountNormalized: true },
      },
    },
  })

  const addBSRow = (item: string, amt: number | "", notes = "", bold = false, fill?: ExcelJS.Fill) => {
    const r = bsSheet.addRow({ item, amt, notes })
    if (bold) r.font = { bold: true }
    if (fill) r.fill = fill
    if (typeof amt === "number") r.getCell("amt").numFmt = '#,##0.00'
    return r
  }

  addBSRow(`BALANCE SHEET — ${taxYear.year} (Cash Method)`, "", "", true, sectionFill())
  addBSRow("ASSETS", "", "", true)

  let totalAssets = 0
  for (const acct of accounts) {
    // Cash balance = sum of inflows minus sum of outflows
    const netCash = acct.transactions.reduce((s, t) => s - Number(t.amountNormalized), 0)
    totalAssets += netCash
    const label = `${acct.institution}${acct.mask ? ` …${acct.mask}` : ""} (${acct.type})`
    addBSRow(`  ${label}`, netCash, "Net cash: inflows − outflows for year")
  }
  addBSRow("Total Assets", totalAssets, "", true, subtotalFill())
  addBSRow("", "", "")
  addBSRow("LIABILITIES", "", "", true)
  addBSRow("  Long-term liabilities", 0, "Cash method — accounts payable not tracked")
  addBSRow("Total Liabilities", 0, "", true, subtotalFill())
  addBSRow("", "", "")
  addBSRow("EQUITY", "", "", true)
  addBSRow("  Net Income for Year", netIncome)
  addBSRow("Total Equity", netIncome, "", true, subtotalFill())
  addBSRow("", "", "")
  addBSRow("NOTE", "", "Cash-method sole proprietorship. Equity = net Schedule C income. Balance sheet is informational only.")

  // ── Sheet 5: Schedule C Detail ────────────────────────────────────────────
  const detSheet = wb.addWorksheet("Schedule C Detail")
  detSheet.columns = [
    { header: "Sch C Line", key: "line", width: 24 },
    { header: "Date", key: "date", width: 12 },
    { header: "Account", key: "account", width: 20 },
    { header: "Merchant", key: "merchant", width: 30 },
    { header: "Amount", key: "amount", width: 12 },
    { header: "Biz %", key: "bizPct", width: 8 },
    { header: "Deductible", key: "deductible", width: 13 },
    { header: "IRC Citations", key: "irc", width: 36 },
    { header: "Tier", key: "tier", width: 6 },
    { header: "Reasoning", key: "reasoning", width: 50 },
  ]
  applyHeaderRow(detSheet.getRow(1))
  detSheet.views = [{ state: "frozen", ySplit: 1 }]
  detSheet.autoFilter = { from: "A1", to: "J1" }

  let detCurrentLine: string | null = null
  for (const tx of sortedDed) {
    const line = tx.classification.scheduleCLine ?? "N/A"
    if (line !== detCurrentLine) {
      detCurrentLine = line
      const lt = lineTotals.get(line)
      const hdr = detSheet.addRow({ line: `── ${line} ──`, date: `${lt?.count ?? 0} transactions`, deductible: lt?.total ?? 0 })
      hdr.font = { bold: true }
      hdr.fill = sectionFill()
      hdr.getCell("deductible").numFmt = '#,##0.00'
    }
    const ded = deductibleAmt(tx.amountNormalized, tx.classification.code, tx.classification.businessPct)
    const r = detSheet.addRow({
      line,
      date: tx.postedDate.toISOString().slice(0, 10),
      account: `${tx.account.institution}${tx.account.mask ? ` …${tx.account.mask}` : ""}`,
      merchant: tx.merchantNormalized ?? tx.merchantRaw,
      amount: tx.amountNormalized,
      bizPct: tx.classification.businessPct,
      deductible: ded,
      irc: tx.classification.ircCitations.join(", "),
      tier: tx.classification.evidenceTier,
      reasoning: tx.classification.reasoning ?? "",
    })
    r.getCell("amount").numFmt = '#,##0.00'
    r.getCell("deductible").numFmt = '#,##0.00'
  }

  const detTotalRow = detSheet.addRow({ line: "TOTAL DEDUCTIONS", deductible: totalDeductible })
  detTotalRow.font = { bold: true, size: 12 }
  detTotalRow.fill = totalFill()
  detTotalRow.getCell("deductible").numFmt = '#,##0.00'

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
