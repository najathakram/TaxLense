/**
 * Financial Statements XLSX — spec §10.2
 *
 * Five sheets:
 *   1. General Ledger  — deductible txns sorted by primary-form line then date
 *   2. Tax Return Summary — one row per primary-form line, totals, IRC citations
 *      (titled "Schedule C" for sole prop / SMLLC, "Form 1120-S" for S-Corp,
 *      "Form 1065" for partnership/LLC-multi, "Form 1120" for C-Corp).
 *   3. P&L             — Gross Receipts → COGS → Gross Profit → Expenses → Net Income
 *   4. Balance Sheet   — cash-method: cash assets + equity (or stockholders' equity for corps)
 *   5. Tax Return Detail — every deductible txn grouped by line with section headers
 *
 * Multi-entity correctness (CPA review round 7): the line set + sheet labels
 * now come from lib/forms/registry.ts (getFormSpec) instead of hardcoded
 * SCHEDULE_C_LINES. Without this, S-Corp / partnership / C-Corp clients
 * produced a Schedule C P&L — wrong financials regardless of the locked
 * ledger contents.
 */

import ExcelJS from "exceljs"
import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"
import {
  DEDUCTIBLE_CODES as SHARED_DEDUCTIBLE_CODES,
  computeDeductibleAmt,
} from "@/lib/classification/deductible"
import { inYearWindow } from "@/lib/queries/yearWindow"
import { getFormSpec, type FormSpec } from "@/lib/forms/registry"
import {
  FS_COLORS,
  FS_FONT,
  FS_NUM_FMT_MONEY,
  fsTitleStyle,
  fsSubtitleStyle,
  fsSectionBandStyle,
  fsLineHeaderStyle,
  fsBodyStyle,
  fsPositiveAccentStyle,
  fsRiskAccentStyle,
  fsFinalTallyStyle,
  fsHeaderRowStyle,
  fsFooterNoteStyle,
  applyRowStyle,
  mergeAndStyle,
} from "./financialStatementsStyles"
import { semanticFillFor } from "./codeFillsBySemantics"
import {
  classifyLine27aSubCategory,
  isLine27a,
  LINE_27A_SUBCATEGORY_DISPLAY_ORDER,
  type Line27aSubCategory,
} from "./sch_c_subcategories"

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

function formLineLabelFromSpec(spec: FormSpec): string {
  if (spec.primaryReturn.includes("Schedule C")) return "Schedule C Line"
  if (spec.primaryReturn.includes("1120-S")) return "Form 1120-S Line"
  if (spec.primaryReturn.includes("1065")) return "Form 1065 Line"
  if (spec.primaryReturn.includes("1120")) return "Form 1120 Line"
  return "Form Line"
}

/**
 * Group BIZ_INCOME transactions by counterparty (merchantNormalized) so the
 * Schedule C / P&L sheets can emit one indented sub-row per revenue source
 * under Line 1 Gross Receipts.
 */
function groupRevenueByCounterparty(
  incomeTxns: ClassifiedTx[]
): Array<{ counterparty: string; total: number; count: number }> {
  const map = new Map<string, { total: number; count: number }>()
  for (const t of incomeTxns) {
    const key = (t.merchantNormalized ?? t.merchantRaw).trim().slice(0, 70) || "(Unspecified)"
    const e = map.get(key) ?? { total: 0, count: 0 }
    e.total += Math.abs(t.amountNormalized)
    e.count++
    map.set(key, e)
  }
  return [...map.entries()]
    .map(([counterparty, v]) => ({ counterparty, total: v.total, count: v.count }))
    .sort((a, b) => b.total - a.total)
}

/**
 * Split MEALS classifications into 100% vs 50% buckets. Used for the §274(n)
 * sub-row breakdown under Line 24b Meals.
 */
function splitMealsBy274n(
  deductibleTxns: ClassifiedTx[]
): { meals100Total: number; meals50Total: number; meals100Count: number; meals50Count: number } {
  let meals100Total = 0
  let meals50Total = 0
  let meals100Count = 0
  let meals50Count = 0
  for (const t of deductibleTxns) {
    if (t.classification.code === "MEALS_100") {
      meals100Total += deductibleAmt(t.amountNormalized, t.classification.code, t.classification.businessPct)
      meals100Count++
    } else if (t.classification.code === "MEALS_50") {
      meals50Total += deductibleAmt(t.amountNormalized, t.classification.code, t.classification.businessPct)
      meals50Count++
    }
  }
  return { meals100Total, meals50Total, meals100Count, meals50Count }
}

/**
 * Group Line 27a Other Expenses transactions by sub-category. Used to emit
 * indented sub-rows under Line 27a on the Schedule C and P&L sheets.
 */
function groupLine27aBySubCategory(
  deductibleTxns: ClassifiedTx[]
): Map<Line27aSubCategory, { total: number; count: number }> {
  const m = new Map<Line27aSubCategory, { total: number; count: number }>()
  for (const t of deductibleTxns) {
    if (!isLine27a(t.classification.scheduleCLine)) continue
    const sub = classifyLine27aSubCategory(t.merchantNormalized ?? t.merchantRaw)
    const e = m.get(sub) ?? { total: 0, count: 0 }
    e.total += deductibleAmt(t.amountNormalized, t.classification.code, t.classification.businessPct)
    e.count++
    m.set(sub, e)
  }
  return m
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
  const ty = await prisma.taxYear.findUnique({ where: { id: taxYearId }, select: { year: true } })
  if (!ty) return []
  const rows = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, ...inYearWindow(ty.year) },
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

  // Resolve the entity-specific line set + sheet labels via the form
  // registry so S-Corp / 1065 / 1120 produce their own returns instead of
  // a Schedule C P&L.
  const formSpec: FormSpec = getFormSpec(profile?.entityType)
  const formLines: string[] = formSpec.lines
  const isScheduleC = formSpec.primaryReturn.includes("Schedule C")
  const sheetTitle = formSpec.primaryReturn.length > 28
    ? formSpec.primaryReturn.slice(0, 28)
    : formSpec.primaryReturn
  const detailSheetTitle = `${sheetTitle.slice(0, 21)} Detail`
  const entityLabel = profile?.entityType === "LLC_SINGLE"
    ? "Single-Member LLC (Schedule C — disregarded)"
    : profile?.entityType === "S_CORP"
    ? "S-Corporation"
    : profile?.entityType === "LLC_MULTI"
    ? "Multi-Member LLC (Partnership)"
    : profile?.entityType === "C_CORP"
    ? "C-Corporation"
    : "Sole Proprietorship"
  // Entity display name from the profile description; fall back to "Business"
  const businessDisplay = (profile?.businessDescription?.slice(0, 60) ?? "Business").toUpperCase()

  // ── Sheet 1: General Ledger ──────────────────────────────────────────────
  const glSheet = wb.addWorksheet("General Ledger")
  glSheet.columns = [
    { header: "", key: "date", width: 12 },
    { header: "", key: "account", width: 26 },
    { header: "", key: "merchant", width: 36 },
    { header: "", key: "amount", width: 14 },
    { header: "", key: "bizPct", width: 9 },
    { header: "", key: "deductible", width: 14 },
    { header: "", key: "schCLine", width: 28 },
    { header: "", key: "irc", width: 32 },
    { header: "", key: "tier", width: 6 },
    { header: "", key: "reasoning", width: 50 },
  ]

  // Row 1: Title
  glSheet.getRow(1).getCell(1).value = `${businessDisplay} — General Ledger ${taxYear.year} — All Classified Transactions`
  applyRowStyle(glSheet.getRow(1), fsTitleStyle())
  glSheet.mergeCells("A1:J1")

  // Row 2: Subtitle
  glSheet.getRow(2).getCell(1).value = `Source: Master Transaction Ledger | Entity: ${entityLabel} | Method: Cash | Year: ${taxYear.year}`
  applyRowStyle(glSheet.getRow(2), fsSubtitleStyle())
  glSheet.mergeCells("A2:J2")

  // Row 3: Column headers
  const glHeaderRow = glSheet.getRow(3)
  glHeaderRow.values = [
    "Date",
    "Account",
    "Merchant",
    "Amount ($)",
    "Biz %",
    "Deductible ($)",
    `${formLineLabelFromSpec(formSpec)}`,
    "IRC Citations",
    "Tier",
    "Reasoning / Notes",
  ]
  applyRowStyle(glHeaderRow, fsHeaderRowStyle())
  glSheet.views = [{ state: "frozen", ySplit: 3 }]
  glSheet.autoFilter = { from: "A3", to: "J3" }

  // Sort by line order then date
  const lineOrder = new Map(formLines.map((l, i) => [l, i]))
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
      const subRow = glSheet.addRow({
        date: line,
        account: "",
        merchant: "",
        amount: "",
        bizPct: "",
        deductible: "",
        schCLine: "",
        irc: "",
        tier: "",
        reasoning: "",
      })
      applyRowStyle(subRow, fsLineHeaderStyle())
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
      reasoning: (tx.classification.reasoning ?? "").slice(0, 200),
    })
    r.font = { name: FS_FONT.name, size: FS_FONT.bodySize }
    r.getCell("amount").numFmt = FS_NUM_FMT_MONEY
    r.getCell("deductible").numFmt = FS_NUM_FMT_MONEY
    // Apply semantic fill across the row based on (code, businessPct, line).
    const fill = semanticFillFor(tx.classification.code, tx.classification.businessPct, line)
    if (fill) {
      r.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = fill
      })
    }
  }

  // Subtotal rows per line
  for (const lt of [...lineTotals.values()].sort((a, b) => (lineOrder.get(a.line) ?? 999) - (lineOrder.get(b.line) ?? 999))) {
    const subRow = glSheet.addRow({
      date: `Subtotal — ${lt.line}`,
      deductible: lt.total,
    })
    applyRowStyle(subRow, fsPositiveAccentStyle())
    subRow.getCell("deductible").numFmt = FS_NUM_FMT_MONEY
  }

  const glTotalRow = glSheet.addRow({ date: "TOTAL DEDUCTIONS", deductible: totalDeductible })
  applyRowStyle(glTotalRow, fsFinalTallyStyle())
  glTotalRow.getCell("deductible").numFmt = FS_NUM_FMT_MONEY

  // ── Sheet 2: Tax-Return Summary (Schedule C / 1120-S / 1065 / 1120) ─────
  // Layout (matches the reference workbook):
  //   Row 1: Title
  //   Row 2: Subtitle (entity + tax year + return type)
  //   Row 3: blank
  //   Row 4: "PART I — INCOME" colored band
  //   Rows N: Line headers + indented per-counterparty sub-rows
  //   ...
  //   Row M: "PART II — EXPENSES" colored band
  //   Rows N: Line headers + indented sub-rows (§274(n) meals split, Line 27a sub-categories)
  //   Row ZZ: Total Expenses (red accent)
  //   Row YY: Net Profit / (Loss) (salmon final-tally accent)
  //   Row ?: blank
  //   Row WW: Footer note (italic gray)
  const schSheet = wb.addWorksheet(sheetTitle)
  schSheet.columns = [
    { header: "", key: "label", width: 44 },
    { header: "", key: "b", width: 12 },
    { header: "", key: "c", width: 13 },
    { header: "", key: "d", width: 13 },
    { header: "", key: "amount", width: 16 },
  ]

  // Title + subtitle (merged across A:E)
  schSheet.getRow(1).getCell(1).value = `${sheetTitle.toUpperCase()} — ${
    isScheduleC ? "PROFIT OR LOSS FROM BUSINESS" : "INCOME & DEDUCTIONS"
  }`
  applyRowStyle(schSheet.getRow(1), fsTitleStyle())
  schSheet.mergeCells("A1:E1")

  schSheet.getRow(2).getCell(1).value = `${businessDisplay}  |  Tax Year ${taxYear.year}  |  ${entityLabel}`
  applyRowStyle(schSheet.getRow(2), fsSubtitleStyle())
  schSheet.mergeCells("A2:E2")

  // Row 4 — PART I — INCOME band
  const part1Row = schSheet.getRow(4)
  part1Row.getCell(1).value = isScheduleC ? "PART I — INCOME" : "INCOME"
  applyRowStyle(part1Row, fsSectionBandStyle("income"))
  schSheet.mergeCells("A4:E4")

  let cursor = 5

  // Line 1 Gross Receipts (with per-counterparty sub-rows)
  if (isScheduleC) {
    const grossReceiptsRow = schSheet.getRow(cursor)
    grossReceiptsRow.getCell(1).value = "Line 1  — Gross Receipts or Sales"
    grossReceiptsRow.getCell(5).value = grossRevenue
    applyRowStyle(grossReceiptsRow, fsLineHeaderStyle())
    grossReceiptsRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
    cursor++

    // Indented per-counterparty sub-rows
    const revenueByCp = groupRevenueByCounterparty(incomeTxns)
    for (const { counterparty, total } of revenueByCp) {
      const r = schSheet.getRow(cursor)
      r.getCell(1).value = `        ${counterparty}`
      r.getCell(5).value = total
      applyRowStyle(r, fsBodyStyle())
      r.getCell(5).numFmt = FS_NUM_FMT_MONEY
      cursor++
    }

    // Line 4 COGS
    const cogsRow = schSheet.getRow(cursor)
    cogsRow.getCell(1).value = "Line 4  — Cost of Goods Sold"
    cogsRow.getCell(5).value = cogsTotal
    applyRowStyle(cogsRow, fsLineHeaderStyle())
    cogsRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
    cursor++

    // Line 5 Gross Profit (positive accent)
    const gpRow = schSheet.getRow(cursor)
    gpRow.getCell(1).value = "Line 5  — Gross Profit"
    gpRow.getCell(5).value = grossRevenue - cogsTotal
    applyRowStyle(gpRow, fsPositiveAccentStyle())
    gpRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
    cursor++
  } else {
    // Non-Schedule-C entity: dump line totals as-is in this section.
    for (const line of formLines) {
      const lt = lineTotals.get(line)
      if (!lt || lt.total === 0) continue
      // Heuristic: lines with "receipt", "income", "dividend", "gross profit" go in PART I.
      if (!/receipt|income|profit|dividend|interest income|gain|rent|royalt/i.test(line)) continue
      const r = schSheet.getRow(cursor)
      r.getCell(1).value = `${line.trim()}`
      r.getCell(5).value = lt.total
      applyRowStyle(r, fsLineHeaderStyle())
      r.getCell(5).numFmt = FS_NUM_FMT_MONEY
      cursor++
    }
  }

  // Skip a row, then PART II — EXPENSES band
  cursor++
  const part2Row = schSheet.getRow(cursor)
  part2Row.getCell(1).value = isScheduleC ? "PART II — EXPENSES" : "DEDUCTIONS"
  applyRowStyle(part2Row, fsSectionBandStyle("expenses"))
  schSheet.mergeCells(`A${cursor}:E${cursor}`)
  cursor++

  // Pre-compute meal split + Line 27a sub-categories for sub-row rendering
  const mealSplit = splitMealsBy274n(deductibleTxns)
  const line27aSubGroups = groupLine27aBySubCategory(deductibleTxns)

  // Render each expense line (skipping COGS — already handled in PART I).
  for (const line of formLines) {
    const lt = lineTotals.get(line)
    if (!lt || lt.total === 0) continue
    if (line.includes("COGS") || isScheduleC && line === "Line 4 — Cost of Goods Sold") continue
    // Skip income-y lines (handled in PART I)
    if (/receipt|income|profit|dividend|gross|rent|royalt/i.test(line) && isScheduleC) continue

    const r = schSheet.getRow(cursor)
    r.getCell(1).value = line.startsWith("Line ") ? line.replace(/^Line\s+(\d+\w*)\s+/, "Line $1 — ") : line
    r.getCell(5).value = lt.total
    applyRowStyle(r, fsLineHeaderStyle())
    r.getCell(5).numFmt = FS_NUM_FMT_MONEY
    cursor++

    // §274(n) meals sub-rows under Line 24b
    if (line.toLowerCase().includes("meals") && (mealSplit.meals100Total > 0 || mealSplit.meals50Total > 0)) {
      if (mealSplit.meals100Total > 0) {
        const sub = schSheet.getRow(cursor)
        sub.getCell(1).value = `        Content creation meals (100% deductible)`
        sub.getCell(5).value = mealSplit.meals100Total
        applyRowStyle(sub, fsBodyStyle())
        sub.getCell(5).numFmt = FS_NUM_FMT_MONEY
        cursor++
      }
      if (mealSplit.meals50Total > 0) {
        const sub = schSheet.getRow(cursor)
        sub.getCell(1).value = `        Business meals (50% after §274(n) reduction)`
        sub.getCell(5).value = mealSplit.meals50Total
        applyRowStyle(sub, fsBodyStyle())
        sub.getCell(5).numFmt = FS_NUM_FMT_MONEY
        cursor++
      }
    }

    // Line 27a sub-category breakdown
    if (isLine27a(line) && line27aSubGroups.size > 0) {
      for (const subCat of LINE_27A_SUBCATEGORY_DISPLAY_ORDER) {
        const entry = line27aSubGroups.get(subCat)
        if (!entry || entry.total === 0) continue
        const sub = schSheet.getRow(cursor)
        sub.getCell(1).value = `        ${subCat}`
        sub.getCell(5).value = entry.total
        applyRowStyle(sub, fsBodyStyle())
        sub.getCell(5).numFmt = FS_NUM_FMT_MONEY
        cursor++
      }
    }
  }

  // Total Expenses (risk-red accent)
  cursor++
  const totalExpRow = schSheet.getRow(cursor)
  totalExpRow.getCell(1).value = isScheduleC ? "Line 28 — Total Expenses" : "Total Deductions"
  totalExpRow.getCell(5).value = totalDeductible - cogsTotal
  applyRowStyle(totalExpRow, fsRiskAccentStyle())
  totalExpRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  cursor += 2

  // Net Profit / (Loss) — final-tally accent
  const netRow = schSheet.getRow(cursor)
  netRow.getCell(1).value = isScheduleC ? "Line 31 — Net Profit (or Loss)" : "Net Income / (Loss)"
  netRow.getCell(5).value = netIncome
  applyRowStyle(netRow, fsFinalTallyStyle())
  netRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  cursor += 3

  // Footer note
  const footerRow = schSheet.getRow(cursor)
  footerRow.getCell(1).value = isScheduleC
    ? `NOTE: Net loss from Schedule C may be deductible against W-2 salary income on Form 1040 (subject to passive activity and at-risk rules under §469 and §465). Consult your CPA before claiming.`
    : `NOTE: This summary aligns to ${formSpec.primaryReturn}${formSpec.k1 ? " (with K-1 distributions to owners)" : ""}. ${formSpec.requiresOwnerPayroll ? "Owner W-2 / reasonable comp required. " : ""}Consult your CPA for entity-specific SE / payroll / state adjustments.`
  applyRowStyle(footerRow, fsFooterNoteStyle())
  schSheet.mergeCells(`A${cursor}:E${cursor}`)

  // ── Sheet 3: P&L (Profit & Loss Statement) ────────────────────────────────
  // Organized by operating category (NOT by Schedule C line). Travel combines
  // Line 24a + Line 27a "Travel" sub-category. Meals splits 100% / 50%. Subs
  // pulls from Line 18 + Line 27a "Subscriptions" sub-category.
  const plSheet = wb.addWorksheet("Profit & Loss Statement")
  plSheet.columns = [
    { header: "", key: "label", width: 44 },
    { header: "", key: "b", width: 14 },
    { header: "", key: "c", width: 14 },
    { header: "", key: "d", width: 14 },
    { header: "", key: "amount", width: 18 },
  ]

  // Title + subtitle
  plSheet.getRow(1).getCell(1).value = businessDisplay
  applyRowStyle(plSheet.getRow(1), fsTitleStyle())
  plSheet.mergeCells("A1:E1")

  plSheet.getRow(2).getCell(1).value = `Profit & Loss Statement — January 1, ${taxYear.year} through December 31, ${taxYear.year}`
  applyRowStyle(plSheet.getRow(2), fsSubtitleStyle())
  plSheet.mergeCells("A2:E2")

  plSheet.getRow(3).getCell(1).value = `Basis: Cash Method  |  Entity: ${entityLabel}  |  Source: Master Transaction Ledger`
  applyRowStyle(plSheet.getRow(3), fsSubtitleStyle())
  plSheet.mergeCells("A3:E3")

  let plCursor = 5

  // REVENUE band
  const plRevBand = plSheet.getRow(plCursor)
  plRevBand.getCell(1).value = "REVENUE"
  applyRowStyle(plRevBand, fsSectionBandStyle("income"))
  plSheet.mergeCells(`A${plCursor}:E${plCursor}`)
  plCursor++

  // Revenue sub-rows per counterparty (just the indented ones, no aggregate header — reference omits it)
  const revenueByCp = groupRevenueByCounterparty(incomeTxns)
  if (revenueByCp.length > 0) {
    const headerRow = plSheet.getRow(plCursor)
    headerRow.getCell(1).value = "Photography Session Fees / Service Revenue"
    applyRowStyle(headerRow, fsBodyStyle())
    headerRow.font = { ...headerRow.font, bold: true }
    plCursor++
    for (const { counterparty, total } of revenueByCp) {
      const r = plSheet.getRow(plCursor)
      r.getCell(1).value = `        ${counterparty}`
      r.getCell(5).value = total
      applyRowStyle(r, fsBodyStyle())
      r.getCell(5).numFmt = FS_NUM_FMT_MONEY
      plCursor++
    }
  }

  const totalRevRow = plSheet.getRow(plCursor)
  totalRevRow.getCell(1).value = "Total Revenue"
  totalRevRow.getCell(5).value = grossRevenue
  applyRowStyle(totalRevRow, fsPositiveAccentStyle())
  totalRevRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  plCursor += 2

  // OPERATING EXPENSES band
  const plExpBand = plSheet.getRow(plCursor)
  plExpBand.getCell(1).value = "OPERATING EXPENSES"
  applyRowStyle(plExpBand, fsSectionBandStyle("expenses"))
  plSheet.mergeCells(`A${plCursor}:E${plCursor}`)
  plCursor++

  // Build operating-category totals. For Schedule C entities, we collapse:
  //   - Travel category = Line 24a Travel + Line 27a "Travel" sub-category
  //   - Meals category  = Line 24b Meals (split 100% / 50%)
  //   - Subscriptions   = Line 18 Office Expense + Line 27a "Subscriptions"
  //   - Auto Expenses   = Line 9 Car & Truck + Line 27a "Auto Expense"
  //   - Each remaining Line as its own category
  const lineByName = new Map<string, { total: number; count: number }>()
  for (const [line, lt] of lineTotals) lineByName.set(line, { total: lt.total, count: lt.count })

  const get = (lineKey: string): number =>
    [...lineByName.entries()].find(([k]) => k.toLowerCase().includes(lineKey.toLowerCase()))?.[1].total ?? 0

  const line27aSubGet = (sub: Line27aSubCategory): number => line27aSubGroups.get(sub)?.total ?? 0

  type CategoryRow = { label: string; total: number; subItems?: Array<{ label: string; total: number }> }
  const categories: CategoryRow[] = []

  if (isScheduleC) {
    // Equipment / Photography (Line 13 Depreciation + §179)
    const equipmentTotal = get("Line 13") + line27aSubGet("Props & Supplies")
    if (equipmentTotal > 0) {
      categories.push({
        label: "Equipment & Production",
        total: equipmentTotal,
        subItems: [
          ...(get("Line 13") > 0 ? [{ label: "Equipment — §179 Expensed (Line 13)", total: get("Line 13") }] : []),
          ...(line27aSubGet("Props & Supplies") > 0
            ? [{ label: "Content Props & Supplies", total: line27aSubGet("Props & Supplies") }]
            : []),
        ],
      })
    }

    // Travel
    const travelTotal = get("Line 24a") + line27aSubGet("Travel")
    if (travelTotal > 0) {
      categories.push({
        label: "Travel (Lines 24a + 27a Travel)",
        total: travelTotal,
        subItems: [
          ...(get("Line 24a") > 0 ? [{ label: "Travel — Line 24a (airfare, hotels, ground)", total: get("Line 24a") }] : []),
          ...(line27aSubGet("Travel") > 0
            ? [{ label: "Travel — Line 27a sub-category", total: line27aSubGet("Travel") }]
            : []),
        ],
      })
    }

    // Meals (with §274(n) split)
    if (mealSplit.meals100Total + mealSplit.meals50Total > 0) {
      categories.push({
        label: "Meals (Line 24b — split per §274(n))",
        total: mealSplit.meals100Total + mealSplit.meals50Total,
        subItems: [
          ...(mealSplit.meals100Total > 0
            ? [{ label: "Content creation meals (100%)", total: mealSplit.meals100Total }]
            : []),
          ...(mealSplit.meals50Total > 0 ? [{ label: "Business meals (50%)", total: mealSplit.meals50Total }] : []),
        ],
      })
    }

    // Subscriptions & Software
    const subsTotal = get("Line 18") + line27aSubGet("Subscriptions")
    if (subsTotal > 0) {
      categories.push({
        label: "Subscriptions & Software",
        total: subsTotal,
        subItems: [
          ...(get("Line 18") > 0 ? [{ label: "Office Expense / Software (Line 18)", total: get("Line 18") }] : []),
          ...(line27aSubGet("Subscriptions") > 0
            ? [{ label: "Platforms, Cloud, Subs (Line 27a)", total: line27aSubGet("Subscriptions") }]
            : []),
        ],
      })
    }

    // Auto Expenses
    const autoTotal = get("Line 9") + line27aSubGet("Auto Expense")
    if (autoTotal > 0) {
      categories.push({
        label: "Auto Expenses",
        total: autoTotal,
        subItems: [
          ...(get("Line 9") > 0 ? [{ label: "Car & Truck (Line 9)", total: get("Line 9") }] : []),
          ...(line27aSubGet("Auto Expense") > 0
            ? [{ label: "Auto Expense (Line 27a)", total: line27aSubGet("Auto Expense") }]
            : []),
        ],
      })
    }

    // Clothing & Grooming (only Line 27a)
    if (line27aSubGet("Clothing & Grooming") > 0) {
      categories.push({
        label: "Clothing & Grooming",
        total: line27aSubGet("Clothing & Grooming"),
      })
    }

    // Legal & Professional
    if (get("Line 17") > 0) {
      categories.push({ label: "Legal & Professional Services (Line 17)", total: get("Line 17") })
    }

    // Contract Labor
    if (get("Line 11") > 0) {
      categories.push({ label: "Contract Labor (Line 11)", total: get("Line 11") })
    }

    // Interest
    if (get("Line 16b") > 0 || line27aSubGet("Bank Interest") > 0) {
      categories.push({
        label: "Business Interest",
        total: get("Line 16b") + line27aSubGet("Bank Interest"),
      })
    }

    // Bank fees
    if (line27aSubGet("Card & Bank Fees") > 0) {
      categories.push({ label: "Card & Bank Fees", total: line27aSubGet("Card & Bank Fees") })
    }

    // Robinhood / etc — any leftover Line 27a "Other"
    if (line27aSubGet("Other") > 0 || line27aSubGet("Robinhood Card") > 0) {
      categories.push({
        label: "Other Business Expenses",
        total: line27aSubGet("Other") + line27aSubGet("Robinhood Card"),
        subItems: [
          ...(line27aSubGet("Robinhood Card") > 0
            ? [{ label: "Robinhood Card Expenses", total: line27aSubGet("Robinhood Card") }]
            : []),
          ...(line27aSubGet("Other") > 0 ? [{ label: "Other (uncategorized)", total: line27aSubGet("Other") }] : []),
        ],
      })
    }

    // Home Office
    if (get("Line 30") > 0) {
      categories.push({ label: "Home Office (Form 8829)", total: get("Line 30") })
    }

    // Advertising
    if (get("Line 8") > 0) {
      categories.push({ label: "Advertising (Line 8)", total: get("Line 8") })
    }
  } else {
    // Non-Schedule-C entity: dump every non-COGS, non-income line as its own category.
    for (const line of formLines) {
      const lt = lineTotals.get(line)
      if (!lt || lt.total === 0) continue
      if (line.includes("COGS") || /receipt|income|profit|dividend|gross|gain/i.test(line)) continue
      categories.push({ label: line, total: lt.total })
    }
  }

  // Render categories
  for (const cat of categories) {
    const r = plSheet.getRow(plCursor)
    r.getCell(1).value = `  ${cat.label}`
    r.getCell(5).value = cat.total
    applyRowStyle(r, fsBodyStyle())
    r.font = { ...r.font, bold: true }
    r.getCell(5).numFmt = FS_NUM_FMT_MONEY
    plCursor++
    if (cat.subItems) {
      for (const sub of cat.subItems) {
        const sr = plSheet.getRow(plCursor)
        sr.getCell(1).value = `        ${sub.label}`
        sr.getCell(5).value = sub.total
        applyRowStyle(sr, fsBodyStyle())
        sr.getCell(5).numFmt = FS_NUM_FMT_MONEY
        plCursor++
      }
    }
  }

  // Total Operating Expenses
  plCursor++
  const totalOpExpRow = plSheet.getRow(plCursor)
  totalOpExpRow.getCell(1).value = "TOTAL OPERATING EXPENSES"
  totalOpExpRow.getCell(5).value = totalDeductible - cogsTotal
  applyRowStyle(totalOpExpRow, fsRiskAccentStyle())
  totalOpExpRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  plCursor += 2

  // Net Profit / (Loss)
  const plNetRow = plSheet.getRow(plCursor)
  plNetRow.getCell(1).value = "NET PROFIT / (LOSS)"
  plNetRow.getCell(5).value = netIncome
  applyRowStyle(plNetRow, fsFinalTallyStyle())
  plNetRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  plCursor += 3

  // Footer note
  const plFooterRow = plSheet.getRow(plCursor)
  plFooterRow.getCell(1).value = isScheduleC
    ? `NOTE: Schedule C net loss may offset W-2 salary income on joint Form 1040, subject to at-risk rules (§465) and passive activity rules (§469). For QBI / §199A deduction analysis and SE-tax computation, consult your CPA.`
    : `NOTE: This is a cash-method ${entityLabel} P&L. Net income${formSpec.k1 ? " is distributed via K-1 to owners" : ""}; consult your CPA for entity-specific tax adjustments.`
  applyRowStyle(plFooterRow, fsFooterNoteStyle())
  plSheet.mergeCells(`A${plCursor}:E${plCursor}`)

  // ── Sheet 4: Balance Sheet ────────────────────────────────────────────────
  // Per-account cash, per-asset fixed assets (§179 expensed), per-card
  // liabilities, per-owner equity (from Owner records).
  const bsSheet = wb.addWorksheet("Balance Sheet")
  bsSheet.columns = [
    { header: "", key: "label", width: 44 },
    { header: "", key: "b", width: 14 },
    { header: "", key: "c", width: 14 },
    { header: "", key: "d", width: 14 },
    { header: "", key: "amount", width: 18 },
  ]

  // Title + subtitle
  bsSheet.getRow(1).getCell(1).value = businessDisplay
  applyRowStyle(bsSheet.getRow(1), fsTitleStyle())
  bsSheet.mergeCells("A1:E1")

  bsSheet.getRow(2).getCell(1).value = `Balance Sheet — As of December 31, ${taxYear.year}`
  applyRowStyle(bsSheet.getRow(2), fsSubtitleStyle())
  bsSheet.mergeCells("A2:E2")

  bsSheet.getRow(3).getCell(1).value = `Cash Method  |  ${entityLabel}${isScheduleC ? "  |  Equipment fully expensed under §179 (book value = $0)" : ""}`
  applyRowStyle(bsSheet.getRow(3), fsSubtitleStyle())
  bsSheet.mergeCells("A3:E3")

  // Load supporting data: accounts, owners, prior-year context (for depreciation schedule),
  // and OWNER_EQUITY classifications (drives the new ledger-derived owner equity rows).
  const [accounts, owners, priorYear, ownerEquityClassifications] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { taxYearId },
      include: {
        transactions: {
          where: { taxYearId, isSplit: false, isStale: false },
          select: { amountNormalized: true },
        },
      },
    }),
    prisma.owner.findMany({
      where: { profile: { taxYearId } },
      orderBy: { name: "asc" },
    }),
    prisma.priorYearContext.findUnique({ where: { taxYearId } }),
    prisma.classification.findMany({
      where: {
        isCurrent: true,
        code: "OWNER_EQUITY",
        transaction: { taxYearId, isSplit: false, isStale: false },
      },
      include: { transaction: { select: { amountNormalized: true } } },
    }),
  ])

  // Sum OWNER_EQUITY by direction. Sign convention: amountNormalized > 0 is
  // an outflow (owner draw); < 0 is an inflow (owner contribution).
  let ledgerOwnerContributions = 0
  let ledgerOwnerDistributions = 0
  for (const c of ownerEquityClassifications) {
    const amt = Number(c.transaction.amountNormalized)
    if (amt < 0) ledgerOwnerContributions += -amt
    else ledgerOwnerDistributions += amt
  }

  let bsCursor = 5

  // ASSETS band
  const bsAssetsBand = bsSheet.getRow(bsCursor)
  bsAssetsBand.getCell(1).value = "ASSETS"
  applyRowStyle(bsAssetsBand, fsSectionBandStyle("income"))
  bsSheet.mergeCells(`A${bsCursor}:E${bsCursor}`)
  bsCursor++

  // Current Assets — per-account cash
  const curAssetsHeader = bsSheet.getRow(bsCursor)
  curAssetsHeader.getCell(1).value = "Current Assets"
  applyRowStyle(curAssetsHeader, fsLineHeaderStyle())
  bsCursor++

  // Filter checking/savings only; credit cards go to liabilities
  const cashAccounts = accounts.filter((a) => a.type === "CHECKING" || a.type === "SAVINGS")
  const creditCardAccounts = accounts.filter((a) => a.type === "CREDIT_CARD")
  let totalCurrentAssets = 0
  for (const acct of cashAccounts) {
    const netCash = acct.transactions.reduce((s, t) => s - Number(t.amountNormalized), 0)
    totalCurrentAssets += netCash
    const r = bsSheet.getRow(bsCursor)
    r.getCell(1).value = `    Cash — ${acct.institution}${acct.mask ? ` …${acct.mask}` : ""} (${acct.nickname ?? acct.type.toLowerCase()})`
    r.getCell(5).value = netCash
    applyRowStyle(r, fsBodyStyle())
    r.getCell(5).numFmt = FS_NUM_FMT_MONEY
    bsCursor++
  }
  // Accounts Receivable — always 0 for cash method
  const arRow = bsSheet.getRow(bsCursor)
  arRow.getCell(1).value = "    Accounts Receivable"
  arRow.getCell(5).value = 0
  applyRowStyle(arRow, fsBodyStyle())
  arRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor++

  const totalCurAssetsRow = bsSheet.getRow(bsCursor)
  totalCurAssetsRow.getCell(1).value = "Total Current Assets"
  totalCurAssetsRow.getCell(5).value = totalCurrentAssets
  applyRowStyle(totalCurAssetsRow, fsPositiveAccentStyle())
  totalCurAssetsRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor += 2

  // Fixed Assets — per-asset breakdown from PriorYearContext.depreciationSchedule (if present)
  const fixedHeader = bsSheet.getRow(bsCursor)
  fixedHeader.getCell(1).value = "Fixed Assets"
  applyRowStyle(fixedHeader, fsLineHeaderStyle())
  bsCursor++

  type DepAsset = { description?: string; basis?: number; method?: string; lifeYears?: number; accumulatedDep?: number }
  const depreciationSchedule = (priorYear?.depreciationSchedule as DepAsset[] | null) ?? []
  const totalFixedAssetCost = depreciationSchedule.reduce((s, a) => s + (a.basis ?? 0), 0)
  const totalAccumDep = depreciationSchedule.reduce((s, a) => s + (a.accumulatedDep ?? a.basis ?? 0), 0)

  if (depreciationSchedule.length > 0) {
    const equipmentRow = bsSheet.getRow(bsCursor)
    equipmentRow.getCell(1).value = `    Equipment & Capital Assets (cost: ~$${totalFixedAssetCost.toFixed(2)})`
    equipmentRow.getCell(5).value = totalFixedAssetCost
    applyRowStyle(equipmentRow, fsBodyStyle())
    equipmentRow.font = { ...equipmentRow.font, bold: true }
    equipmentRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
    bsCursor++
    for (const asset of depreciationSchedule.slice(0, 20)) {
      const ar = bsSheet.getRow(bsCursor)
      const label = `          ${asset.description ?? "(unnamed)"} ${asset.method === "179" ? "(§179 expensed)" : ""}`.trim()
      ar.getCell(1).value = label
      ar.getCell(5).value = asset.basis ?? 0
      applyRowStyle(ar, fsBodyStyle())
      ar.getCell(5).numFmt = FS_NUM_FMT_MONEY
      bsCursor++
    }
    const accumDepRow = bsSheet.getRow(bsCursor)
    accumDepRow.getCell(1).value = "    Less: Accumulated Depreciation (§179 + MACRS)"
    accumDepRow.getCell(5).value = -totalAccumDep
    applyRowStyle(accumDepRow, fsBodyStyle())
    accumDepRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
    bsCursor++
  } else {
    const fixedNoneRow = bsSheet.getRow(bsCursor)
    fixedNoneRow.getCell(1).value = "    Equipment & Capital Assets"
    fixedNoneRow.getCell(5).value = 0
    applyRowStyle(fixedNoneRow, fsBodyStyle())
    fixedNoneRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
    bsCursor++
  }

  const netFixedAssets = totalFixedAssetCost - totalAccumDep
  const netFixedRow = bsSheet.getRow(bsCursor)
  netFixedRow.getCell(1).value = "Net Fixed Assets"
  netFixedRow.getCell(5).value = netFixedAssets
  applyRowStyle(netFixedRow, fsPositiveAccentStyle())
  netFixedRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor += 2

  // TOTAL ASSETS
  const totalAssetsValue = totalCurrentAssets + netFixedAssets
  const totalAssetsRow = bsSheet.getRow(bsCursor)
  totalAssetsRow.getCell(1).value = "TOTAL ASSETS"
  totalAssetsRow.getCell(5).value = totalAssetsValue
  applyRowStyle(totalAssetsRow, fsRiskAccentStyle())
  totalAssetsRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor += 3

  // LIABILITIES band
  const bsLiabBand = bsSheet.getRow(bsCursor)
  bsLiabBand.getCell(1).value = "LIABILITIES"
  applyRowStyle(bsLiabBand, fsSectionBandStyle("expenses"))
  bsSheet.mergeCells(`A${bsCursor}:E${bsCursor}`)
  bsCursor++

  // Credit Card balances (estimates — taxlens doesn't track formal CC balances)
  const ccHeader = bsSheet.getRow(bsCursor)
  ccHeader.getCell(1).value = "Credit Card Balances (Approx. Year-End)"
  applyRowStyle(ccHeader, fsLineHeaderStyle())
  bsCursor++

  let totalCCBalances = 0
  for (const cc of creditCardAccounts) {
    // Year-end balance estimate: net of charges − payments. Negative outflow on a CC is "payment to card" → balance reduction.
    const netCC = cc.transactions.reduce((s, t) => s + Number(t.amountNormalized), 0)
    // Positive netCC means net charges exceed payments → balance owed
    const ccBalance = Math.max(0, netCC)
    totalCCBalances += ccBalance
    const r = bsSheet.getRow(bsCursor)
    r.getCell(1).value = `    ${cc.institution}${cc.mask ? ` …${cc.mask}` : ""} (${cc.nickname ?? "credit card"})`
    r.getCell(5).value = ccBalance
    applyRowStyle(r, fsBodyStyle())
    r.getCell(5).numFmt = FS_NUM_FMT_MONEY
    bsCursor++
  }
  const totalLiabRow = bsSheet.getRow(bsCursor)
  totalLiabRow.getCell(1).value = "Total Liabilities"
  totalLiabRow.getCell(5).value = totalCCBalances
  applyRowStyle(totalLiabRow, fsRiskAccentStyle())
  totalLiabRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor += 2

  const totalLiabBigRow = bsSheet.getRow(bsCursor)
  totalLiabBigRow.getCell(1).value = "TOTAL LIABILITIES"
  totalLiabBigRow.getCell(5).value = totalCCBalances
  applyRowStyle(totalLiabBigRow, fsRiskAccentStyle())
  totalLiabBigRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor += 3

  // OWNER'S EQUITY band
  const bsEqBand = bsSheet.getRow(bsCursor)
  bsEqBand.getCell(1).value = "OWNER'S EQUITY"
  applyRowStyle(bsEqBand, fsSectionBandStyle("income"))
  bsSheet.mergeCells(`A${bsCursor}:E${bsCursor}`)
  bsCursor++

  // Per-owner contributions (manual entry on /owners page; primarily for
  // multi-owner entities). For Sole Prop / SMLLC, this is typically empty —
  // the ledger-derived OWNER_EQUITY rows below are the canonical source.
  let totalManualContributions = 0
  if (owners.length > 0) {
    for (const owner of owners) {
      const contrib = Number(owner.capitalContribution ?? 0)
      if (contrib === 0) continue // Skip empty per-owner lines; ledger rows below cover Sole Prop.
      totalManualContributions += contrib
      const r = bsSheet.getRow(bsCursor)
      r.getCell(1).value = `    Member Contributions — ${owner.name} (recorded)`
      r.getCell(5).value = contrib
      applyRowStyle(r, fsBodyStyle())
      r.getCell(5).numFmt = FS_NUM_FMT_MONEY
      bsCursor++
    }
  }

  // Ledger-derived OWNER_EQUITY rows — actual cash movement classified as
  // owner contributions (inflows) and owner draws (outflows). Sole Prop /
  // SMLLC pipeline auto-classifies ATM withdrawals + owner-name Zelle/Venmo +
  // personal-card payments into OWNER_EQUITY. Shown even when zero so the
  // CPA can see "we looked for owner activity and found $0".
  const ownerContribsRow = bsSheet.getRow(bsCursor)
  ownerContribsRow.getCell(1).value = "    Owner Contributions — Detected (ledger)"
  ownerContribsRow.getCell(5).value = ledgerOwnerContributions
  applyRowStyle(ownerContribsRow, fsBodyStyle())
  ownerContribsRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor++

  const ownerDrawsRow = bsSheet.getRow(bsCursor)
  ownerDrawsRow.getCell(1).value = "    Owner Distributions / Draws — Detected (ledger)"
  ownerDrawsRow.getCell(5).value = -ledgerOwnerDistributions // Display as negative — reduces equity
  applyRowStyle(ownerDrawsRow, fsBodyStyle())
  ownerDrawsRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor++

  // Retained Earnings (prior periods)
  const retainedRow = bsSheet.getRow(bsCursor)
  retainedRow.getCell(1).value = "    Retained Earnings — Prior Periods"
  retainedRow.getCell(5).value = 0
  applyRowStyle(retainedRow, fsBodyStyle())
  retainedRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor++

  // Net Income (Loss) for current year
  const niRow = bsSheet.getRow(bsCursor)
  niRow.getCell(1).value = `    Net Income (Loss) — ${taxYear.year}`
  niRow.getCell(5).value = netIncome
  applyRowStyle(niRow, fsBodyStyle())
  niRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor++

  const totalEquity = totalManualContributions + ledgerOwnerContributions - ledgerOwnerDistributions + netIncome
  const totalEqRow = bsSheet.getRow(bsCursor)
  totalEqRow.getCell(1).value = "Total Owner's Equity"
  totalEqRow.getCell(5).value = totalEquity
  applyRowStyle(totalEqRow, fsPositiveAccentStyle())
  totalEqRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor += 2

  const totalLEqRow = bsSheet.getRow(bsCursor)
  totalLEqRow.getCell(1).value = "TOTAL LIABILITIES + EQUITY"
  totalLEqRow.getCell(5).value = totalCCBalances + totalEquity
  applyRowStyle(totalLEqRow, fsFinalTallyStyle())
  totalLEqRow.getCell(5).numFmt = FS_NUM_FMT_MONEY
  bsCursor += 3

  // Footer
  const bsFooter = bsSheet.getRow(bsCursor)
  bsFooter.getCell(1).value = `NOTES: Balance sheet is approximate.${isScheduleC ? " Equipment fully expensed under §179 (book value = $0)." : ""} Credit card balances are year-end estimates derived from transaction sign analysis. Cash balances reflect year-end net of inflows/outflows for ${taxYear.year}.`
  applyRowStyle(bsFooter, fsFooterNoteStyle())
  bsSheet.mergeCells(`A${bsCursor}:E${bsCursor}`)

  // ── Sheet 5: Schedule C — Detail ──────────────────────────────────────────
  // Grouped by Schedule C line with section headers + transaction rows +
  // SUM-formula subtotals (lets a CPA audit "do my detail rows sum to the
  // headline line?"). Adds a Sub-Category column for Line 27a transactions.
  const detSheet = wb.addWorksheet(detailSheetTitle)
  detSheet.columns = [
    { header: "", key: "date", width: 12 },
    { header: "", key: "merchant", width: 56 },
    { header: "", key: "account", width: 26 },
    { header: "", key: "category", width: 42 },
    { header: "", key: "line", width: 36 },
    { header: "", key: "subCategory", width: 22 },
    { header: "", key: "amount", width: 13 },
    { header: "", key: "deductible", width: 13 },
  ]

  // Title row
  detSheet.getRow(1).getCell(1).value = `SCHEDULE C — Supporting Detail — ${businessDisplay} — ${taxYear.year}`
  applyRowStyle(detSheet.getRow(1), fsTitleStyle())
  detSheet.mergeCells("A1:H1")

  // Row 2: Column headers
  const detHeaderRow = detSheet.getRow(2)
  detHeaderRow.values = [
    "Date",
    "Description",
    "Card / Account",
    "Category",
    "Schedule C Line",
    "Sub-Category (27a)",
    "Amount ($)",
    "Deductible ($)",
  ]
  applyRowStyle(detHeaderRow, fsHeaderRowStyle())
  detSheet.views = [{ state: "frozen", ySplit: 2 }]
  detSheet.autoFilter = { from: "A2", to: "H2" }

  let detCursor = 3
  let detCurrentLine: string | null = null
  let detSectionStartRow = 0

  // Helper: when transitioning lines, emit the subtotal formula for the prior section
  const emitSubtotal = (prevLine: string, sectionStart: number, sectionEnd: number) => {
    if (sectionStart >= sectionEnd) return
    const subRow = detSheet.getRow(detCursor)
    subRow.getCell(2).value = `  Subtotal — ${prevLine}`
    // Excel formula spanning the section's deductible column (H)
    subRow.getCell(8).value = { formula: `SUM(H${sectionStart}:H${sectionEnd})` } as ExcelJS.CellValue
    applyRowStyle(subRow, fsPositiveAccentStyle())
    subRow.getCell(8).numFmt = FS_NUM_FMT_MONEY
    detCursor++
    // Blank spacer row between sections
    detCursor++
  }

  for (const tx of sortedDed) {
    const line = tx.classification.scheduleCLine ?? "N/A"
    if (line !== detCurrentLine) {
      // Close prior section with SUM formula
      if (detCurrentLine && detSectionStartRow > 0) {
        emitSubtotal(detCurrentLine, detSectionStartRow, detCursor - 1)
      }
      detCurrentLine = line
      // Section header
      const hdr = detSheet.getRow(detCursor)
      hdr.getCell(1).value = line
      applyRowStyle(hdr, fsLineHeaderStyle())
      detSheet.mergeCells(`A${detCursor}:H${detCursor}`)
      detCursor++
      detSectionStartRow = detCursor
    }
    const ded = deductibleAmt(tx.amountNormalized, tx.classification.code, tx.classification.businessPct)
    const subCategory = isLine27a(line)
      ? classifyLine27aSubCategory(tx.merchantNormalized ?? tx.merchantRaw)
      : ""
    const r = detSheet.getRow(detCursor)
    r.getCell(1).value = tx.postedDate.toISOString().slice(0, 10)
    r.getCell(2).value = (tx.merchantNormalized ?? tx.merchantRaw).slice(0, 80)
    r.getCell(3).value = `${tx.account.institution}${tx.account.mask ? ` …${tx.account.mask}` : ""}`
    r.getCell(4).value = tx.classification.code
    r.getCell(5).value = line
    r.getCell(6).value = subCategory
    r.getCell(7).value = tx.amountNormalized
    r.getCell(8).value = ded
    applyRowStyle(r, fsBodyStyle())
    r.getCell(7).numFmt = FS_NUM_FMT_MONEY
    r.getCell(8).numFmt = FS_NUM_FMT_MONEY
    // Apply semantic fill across the row
    const fill = semanticFillFor(tx.classification.code, tx.classification.businessPct, line)
    if (fill) {
      r.eachCell({ includeEmpty: true }, (cell) => {
        cell.fill = fill
      })
    }
    detCursor++
  }

  // Close the final section
  if (detCurrentLine && detSectionStartRow > 0) {
    emitSubtotal(detCurrentLine, detSectionStartRow, detCursor - 1)
  }

  // Grand total — sum of all section subtotals (using a SUM over a single column)
  const detTotalRow = detSheet.getRow(detCursor)
  detTotalRow.getCell(2).value = "GRAND TOTAL — All Deductions"
  detTotalRow.getCell(8).value = totalDeductible
  applyRowStyle(detTotalRow, fsFinalTallyStyle())
  detTotalRow.getCell(8).numFmt = FS_NUM_FMT_MONEY

  // ── Sheet 6: Cash Flow Statement ─────────────────────────────────────────
  // Indirect-method cash-flow proxy. For a cash-method taxpayer, operating
  // cash flow = net income + non-cash adjustments. Since cash-method
  // bookkeeping doesn't accrue receivables/payables, operating cash flow ≈
  // net income, with depreciation as the typical add-back. Investing flows
  // = transfers between owned accounts and asset purchases. Financing flows
  // = owner contributions and distributions. We report them by category so
  // a CPA can verify period-over-period cash continuity.
  const cfSheet = wb.addWorksheet("Cash Flow")
  cfSheet.columns = [
    { header: "Section", key: "section", width: 38 },
    { header: "Amount ($)", key: "amt", width: 18 },
    { header: "Notes", key: "notes", width: 50 },
  ]
  applyHeaderRow(cfSheet.getRow(1))

  const addCfRow = (section: string, amt: number | "", notes = "", bold = false, fill?: ExcelJS.Fill) => {
    const r = cfSheet.addRow({ section, amt, notes })
    if (bold) r.font = { bold: true }
    if (fill) r.fill = fill
    if (typeof amt === "number") r.getCell("amt").numFmt = '#,##0.00'
    return r
  }

  // Sum amounts by classification code for cash-flow categorization.
  let depreciation = 0
  for (const [line, lt] of lineTotals) {
    if (line.toLowerCase().includes("depreciation") || line.includes("Line 13")) {
      depreciation += lt.total
    }
  }

  // Transfers between owned accounts (paired) — already excluded from P&L
  // but disclosed here for cash-continuity context.
  const transferTxns = allTxns.filter(
    (t) => t.classification.code === "TRANSFER" || t.classification.code === "PAYMENT",
  )
  const transferTotal = transferTxns.reduce((s, t) => s + Math.abs(t.amountNormalized), 0)

  addCfRow(`CASH FLOW STATEMENT — ${taxYear.year} (Indirect Method)`, "", "", true, sectionFill())
  addCfRow("OPERATING ACTIVITIES", "", "", true, subtotalFill())
  addCfRow("  Net Income / (Loss)", netIncome, "From P&L sheet")
  addCfRow("  + Depreciation (non-cash add-back)", depreciation, "Line 13 / 14 / 16a / 20 totals")
  const operatingCash = netIncome + depreciation
  addCfRow("Cash from Operating Activities", operatingCash, "Net + non-cash adjustments", true, subtotalFill())
  addCfRow("", "", "")
  addCfRow("INVESTING ACTIVITIES", "", "", true, subtotalFill())
  addCfRow("  Asset purchases", 0, "Capitalized purchases (deferred to 4562 detail)")
  addCfRow("Cash from Investing Activities", 0, "", true, subtotalFill())
  addCfRow("", "", "")
  addCfRow("FINANCING ACTIVITIES", "", "", true, subtotalFill())
  addCfRow(
    "  Owner contributions",
    ledgerOwnerContributions,
    `OWNER_EQUITY inflows from ledger (${ownerEquityClassifications.filter((c) => Number(c.transaction.amountNormalized) < 0).length} txns)`,
  )
  addCfRow(
    "  Owner distributions / draws",
    -ledgerOwnerDistributions,
    `OWNER_EQUITY outflows from ledger (${ownerEquityClassifications.filter((c) => Number(c.transaction.amountNormalized) > 0).length} txns)`,
  )
  const financingCash = ledgerOwnerContributions - ledgerOwnerDistributions
  addCfRow("Cash from Financing Activities", financingCash, "", true, subtotalFill())
  addCfRow("", "", "")
  addCfRow(
    "Net change in cash",
    operatingCash + financingCash,
    "Sum of operating + investing + financing",
    true,
    totalFill(),
  )
  addCfRow("", "", "")
  addCfRow("INFORMATIONAL — Inter-account transfers", transferTotal, `${transferTxns.length} paired transfer/payment txns; excluded from P&L by design`)
  addCfRow(
    "NOTE",
    "",
    "Cash-method indirect cash flow. Owner contributions/draws derived from OWNER_EQUITY classifications; manual Owner records still drive K-1 capital roll-forward for multi-owner entities.",
  )

  // ── Sheet 7: Trial Balance ───────────────────────────────────────────────
  // GAAP-style trial balance grouped by account category. For a cash-method
  // dropshipping taxpayer the "accounts" are: cash by FinancialAccount (asset)
  // + revenue (income) + each expense category by Schedule C / form line.
  const tbSheet = wb.addWorksheet("Trial Balance")
  tbSheet.columns = [
    { header: "Account", key: "account", width: 40 },
    { header: "Debit ($)", key: "debit", width: 16 },
    { header: "Credit ($)", key: "credit", width: 16 },
    { header: "Net ($)", key: "net", width: 16 },
  ]
  applyHeaderRow(tbSheet.getRow(1))
  tbSheet.views = [{ state: "frozen", ySplit: 1 }]

  const addTbRow = (account: string, debit: number, credit: number, opts?: { bold?: boolean; fill?: ExcelJS.Fill }) => {
    const r = tbSheet.addRow({
      account,
      debit: debit || "",
      credit: credit || "",
      net: debit - credit,
    })
    if (opts?.bold) r.font = { bold: true }
    if (opts?.fill) r.fill = opts.fill
    if (debit) r.getCell("debit").numFmt = '#,##0.00'
    if (credit) r.getCell("credit").numFmt = '#,##0.00'
    r.getCell("net").numFmt = '#,##0.00'
    return r
  }

  let tbDebits = 0
  let tbCredits = 0
  // Header
  tbSheet.addRow({ account: `TRIAL BALANCE — ${taxYear.year}`, debit: "", credit: "", net: "" }).font = { bold: true }

  // ASSETS section — cash by account (debit balance for positive cash)
  const assetHeader = tbSheet.addRow({ account: "ASSETS — Cash" })
  assetHeader.font = { bold: true }
  assetHeader.fill = sectionFill()
  for (const acct of accounts) {
    const netCash = acct.transactions.reduce((s, t) => s - Number(t.amountNormalized), 0)
    const label = `  ${acct.institution}${acct.mask ? ` …${acct.mask}` : ""} (${acct.type})`
    if (netCash >= 0) {
      addTbRow(label, netCash, 0)
      tbDebits += netCash
    } else {
      addTbRow(label, 0, -netCash)
      tbCredits += -netCash
    }
  }

  // REVENUES section (credit balance)
  const revHeader = tbSheet.addRow({ account: "REVENUE" })
  revHeader.font = { bold: true }
  revHeader.fill = sectionFill()
  if (grossRevenue > 0) {
    addTbRow("  Gross Receipts (BIZ_INCOME)", 0, grossRevenue)
    tbCredits += grossRevenue
  }

  // EXPENSES section (debit balance) — one row per Schedule C / form line
  const expHeader = tbSheet.addRow({ account: "EXPENSES" })
  expHeader.font = { bold: true }
  expHeader.fill = sectionFill()
  const sortedExpenseLines = [...lineTotals.entries()].sort(
    (a, b) => (lineOrder.get(a[0]) ?? 999) - (lineOrder.get(b[0]) ?? 999),
  )
  for (const [line, lt] of sortedExpenseLines) {
    if (lt.total === 0) continue
    addTbRow(`  ${line}`, lt.total, 0)
    tbDebits += lt.total
  }

  // EQUITY balancer (plug) — net income flows to retained earnings
  const equityHeader = tbSheet.addRow({ account: "EQUITY" })
  equityHeader.font = { bold: true }
  equityHeader.fill = sectionFill()
  const equityPlug = tbDebits - tbCredits
  if (equityPlug >= 0) {
    addTbRow("  Owner's Equity (balancing)", 0, equityPlug)
    tbCredits += equityPlug
  } else {
    addTbRow("  Owner's Equity (balancing)", -equityPlug, 0)
    tbDebits += -equityPlug
  }

  // TOTALS row — must balance (debits == credits)
  const totalsRow = tbSheet.addRow({
    account: "TOTALS",
    debit: tbDebits,
    credit: tbCredits,
    net: tbDebits - tbCredits,
  })
  totalsRow.font = { bold: true }
  totalsRow.fill = totalFill()
  totalsRow.getCell("debit").numFmt = '#,##0.00'
  totalsRow.getCell("credit").numFmt = '#,##0.00'
  totalsRow.getCell("net").numFmt = '#,##0.00'

  tbSheet.addRow({ account: "" })
  tbSheet.addRow({
    account: "NOTE: Cash-method dropshipping → no AR/AP/Inventory; Owner's Equity is a balancing plug equal to cumulative retained earnings.",
  })

  // ── Sheet 8: Vendor List ─────────────────────────────────────────────────
  // Aggregates all WRITE_OFF / MEALS_* outflows by merchant (normalized) so
  // the CPA can sanity-check who got paid + flag candidates for 1099-NEC /
  // 1099-MISC issuance. Sorted by total spend descending.
  const vendorMap = new Map<
    string,
    { count: number; total: number; deductible: number; codes: Set<string>; lines: Set<string> }
  >()
  for (const t of deductibleTxns) {
    const key = (t.merchantNormalized ?? t.merchantRaw.trim().slice(0, 80)) || "(unknown)"
    if (!vendorMap.has(key)) {
      vendorMap.set(key, { count: 0, total: 0, deductible: 0, codes: new Set(), lines: new Set() })
    }
    const v = vendorMap.get(key)!
    v.count++
    v.total += Math.abs(t.amountNormalized)
    v.deductible += deductibleAmt(t.amountNormalized, t.classification.code, t.classification.businessPct)
    v.codes.add(t.classification.code)
    if (t.classification.scheduleCLine) v.lines.add(t.classification.scheduleCLine)
  }

  const vendorSheet = wb.addWorksheet("Vendor List")
  vendorSheet.columns = [
    { header: "Vendor / Merchant", key: "vendor", width: 40 },
    { header: "# Txns", key: "count", width: 8 },
    { header: "Total Paid ($)", key: "total", width: 16 },
    { header: "Deductible ($)", key: "deductible", width: 16 },
    { header: "Codes", key: "codes", width: 24 },
    { header: "Schedule lines", key: "lines", width: 30 },
    { header: "Likely 1099 ≥ $600", key: "needs1099", width: 18 },
  ]
  applyHeaderRow(vendorSheet.getRow(1))
  vendorSheet.views = [{ state: "frozen", ySplit: 1 }]
  vendorSheet.autoFilter = { from: "A1", to: "G1" }

  const sortedVendors = [...vendorMap.entries()].sort(
    (a, b) => b[1].deductible - a[1].deductible,
  )
  for (const [vendor, v] of sortedVendors) {
    const r = vendorSheet.addRow({
      vendor,
      count: v.count,
      total: v.total,
      deductible: v.deductible,
      codes: [...v.codes].join(", "),
      lines: [...v.lines].join("; "),
      // Flag 1099-NEC candidates: contract-labor lines ≥ $600 to non-corp
      // (corp exemption applied at the per-payee level via W-9 — so this is a
      // best-guess flag; the 1099s page does the canonical check).
      needs1099: v.deductible >= 600 && [...v.lines].some((l) => /Line 11|Contract Labor|Compensation|Salaries|Guaranteed/i.test(l)) ? "Yes (NEC)" : v.deductible >= 600 && [...v.lines].some((l) => /rent|royalt/i.test(l)) ? "Yes (MISC)" : "—",
    })
    r.getCell("total").numFmt = '#,##0.00'
    r.getCell("deductible").numFmt = '#,##0.00'
  }
  const vendorTotal = vendorSheet.addRow({
    vendor: "TOTAL",
    count: sortedVendors.reduce((s, [, v]) => s + v.count, 0),
    total: sortedVendors.reduce((s, [, v]) => s + v.total, 0),
    deductible: totalDeductible,
  })
  vendorTotal.font = { bold: true }
  vendorTotal.fill = totalFill()
  vendorTotal.getCell("total").numFmt = '#,##0.00'
  vendorTotal.getCell("deductible").numFmt = '#,##0.00'

  const buf = await wb.xlsx.writeBuffer()
  return Buffer.from(buf)
}
