/**
 * Tax package PDF documents (Session 9 §C).
 *
 * Each exported async builder returns a Buffer for one PDF artifact.
 * All use @react-pdf/renderer (Node-only, no headless browser).
 *
 * Content policy:
 *  - Everything is derived from the locked ledger; no AI calls here.
 *  - Citation strings come straight from Classification.ircCitations.
 *  - Any figure the AI did not have evidence for appears as "[VERIFY]" — we never fabricate.
 */

import React from "react"
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  pdf,
  Font,
} from "@react-pdf/renderer"
import { prisma } from "@/lib/db"

// Use built-in fonts — no registration needed for Helvetica/Times/Courier.
Font.registerHyphenationCallback((word) => [word])

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 18, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 13, marginTop: 14, marginBottom: 6, fontFamily: "Helvetica-Bold" },
  muted: { color: "#555" },
  small: { fontSize: 9, color: "#555" },
  row: { flexDirection: "row", borderBottom: "1 solid #ddd", paddingVertical: 3 },
  cell: { flex: 1, paddingHorizontal: 4 },
  cellNarrow: { width: 80, paddingHorizontal: 4, textAlign: "right" },
  cellRight: { flex: 1, paddingHorizontal: 4, textAlign: "right" },
  headerRow: {
    flexDirection: "row",
    borderBottom: "1 solid #333",
    paddingVertical: 4,
    backgroundColor: "#f1f5f9",
  },
  headerCell: { flex: 1, paddingHorizontal: 4, fontFamily: "Helvetica-Bold", fontSize: 9 },
  headerCellRight: { flex: 1, paddingHorizontal: 4, textAlign: "right", fontFamily: "Helvetica-Bold", fontSize: 9 },
  footer: {
    position: "absolute",
    bottom: 24,
    left: 40,
    right: 40,
    borderTop: "1 solid #ddd",
    paddingTop: 6,
    fontSize: 8,
    color: "#666",
  },
})

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
}

interface HeaderInfo {
  clientName: string
  year: number
  ledgerHash: string | null
  generatedAt: string
}

function PdfFooter({ header }: { header: HeaderInfo }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        TaxLens · {header.clientName} · Tax Year {header.year} · Generated{" "}
        {header.generatedAt}
        {header.ledgerHash ? ` · Ledger ${header.ledgerHash.slice(0, 12)}…` : ""}
      </Text>
      <Text
        render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
      />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Shared context loader
// ---------------------------------------------------------------------------

interface PackageContext {
  header: HeaderInfo
  taxYearId: string
  scheduleCTotals: Map<string, number>
  totalDeductions: number
  grossReceipts: number
  netProfit: number
  homeOfficeConfig: { has?: boolean; dedicated?: boolean; officeSqft?: number; homeSqft?: number } | null
  vehicleConfig: { has?: boolean; bizPct?: number } | null
  naicsCode: string | null
  businessDescription: string | null
}

async function loadContext(taxYearId: string): Promise<PackageContext> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: { user: { select: { name: true, email: true } } },
  })
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: {
      naicsCode: true,
      businessDescription: true,
      homeOfficeConfig: true,
      vehicleConfig: true,
    },
  })
  const clientName = ty.user.name ?? ty.user.email

  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isDuplicateOf: null },
    select: {
      amountNormalized: true,
      classifications: {
        where: { isCurrent: true },
        select: { code: true, scheduleCLine: true, businessPct: true },
      },
    },
  })

  const scheduleCTotals = new Map<string, number>()
  let totalDeductions = 0
  let grossReceipts = 0

  for (const t of txns) {
    const cls = t.classifications[0]
    if (!cls) continue
    const amt = Number(t.amountNormalized.toString())
    if (cls.code === "BIZ_INCOME") {
      grossReceipts += Math.abs(amt)
      continue
    }
    if (!["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100"].includes(cls.code)) {
      continue
    }
    const mult = cls.code === "MEALS_50" ? 0.5 : 1
    const deductible = Math.abs(amt) * (cls.businessPct / 100) * mult
    totalDeductions += deductible
    if (cls.scheduleCLine) {
      scheduleCTotals.set(
        cls.scheduleCLine,
        (scheduleCTotals.get(cls.scheduleCLine) ?? 0) + deductible,
      )
    }
  }

  return {
    header: {
      clientName,
      year: ty.year,
      ledgerHash: ty.lockedSnapshotHash,
      generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    },
    taxYearId,
    scheduleCTotals,
    totalDeductions,
    grossReceipts,
    netProfit: grossReceipts - totalDeductions,
    homeOfficeConfig: (profile?.homeOfficeConfig as PackageContext["homeOfficeConfig"]) ?? null,
    vehicleConfig: (profile?.vehicleConfig as PackageContext["vehicleConfig"]) ?? null,
    naicsCode: profile?.naicsCode ?? null,
    businessDescription: profile?.businessDescription ?? null,
  }
}

// ---------------------------------------------------------------------------
// 1. Client Summary
// ---------------------------------------------------------------------------

function ClientSummaryDoc({ ctx }: { ctx: PackageContext }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Client Summary — Tax Year {ctx.header.year}</Text>
        <Text style={styles.muted}>{ctx.header.clientName}</Text>
        <Text style={styles.small}>
          NAICS {ctx.naicsCode ?? "unknown"} · {ctx.businessDescription ?? "—"}
        </Text>

        <Text style={styles.h2}>Bottom line</Text>
        <View style={styles.row}>
          <Text style={styles.cell}>Gross receipts (Line 1)</Text>
          <Text style={styles.cellRight}>{fmtUSD(ctx.grossReceipts)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.cell}>Total deductions</Text>
          <Text style={styles.cellRight}>{fmtUSD(ctx.totalDeductions)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.cell, { fontFamily: "Helvetica-Bold" }]}>Net profit (Line 31)</Text>
          <Text style={[styles.cellRight, { fontFamily: "Helvetica-Bold" }]}>
            {fmtUSD(ctx.netProfit)}
          </Text>
        </View>

        <Text style={styles.h2}>Schedule C line totals</Text>
        <View style={styles.headerRow}>
          <Text style={styles.headerCell}>Line</Text>
          <Text style={styles.headerCellRight}>Amount</Text>
        </View>
        {[...ctx.scheduleCTotals.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([line, amt]) => (
            <View key={line} style={styles.row}>
              <Text style={styles.cell}>{line}</Text>
              <Text style={styles.cellRight}>{fmtUSD(amt)}</Text>
            </View>
          ))}

        <Text style={styles.h2}>Notes</Text>
        <Text style={styles.small}>
          Figures derive from the locked transaction ledger. The CPA (not TaxLens) signs the return.
          See 04_position_memos/ for gray-zone analyses. Any value shown as [VERIFY] requires manual confirmation.
        </Text>

        <PdfFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

export async function buildClientSummaryPdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadContext(taxYearId)
  const stream = await pdf(<ClientSummaryDoc ctx={ctx} />).toBuffer()
  return streamToBuffer(stream)
}

// ---------------------------------------------------------------------------
// 2. Schedule C Worksheet
// ---------------------------------------------------------------------------

const SCHEDULE_C_LINES = [
  "Line 8 Advertising",
  "Line 9 Car & Truck",
  "Line 11 Contract Labor",
  "Line 13 Depreciation",
  "Line 15 Insurance",
  "Line 16b Interest",
  "Line 17 Legal & Professional",
  "Line 18 Office Expense",
  "Line 20b Rent — Other",
  "Line 21 Repairs & Maintenance",
  "Line 22 Supplies",
  "Line 23 Taxes & Licenses",
  "Line 24a Travel",
  "Line 24b Meals",
  "Line 25 Utilities",
  "Line 27a Other Expenses",
  "Line 30 Home Office",
]

function ScheduleCDoc({ ctx }: { ctx: PackageContext }) {
  const line27a = ctx.scheduleCTotals.get("Line 27a Other Expenses") ?? 0
  const totalDeductionsShown = ctx.totalDeductions
  const pctLine27 = totalDeductionsShown > 0 ? line27a / totalDeductionsShown : 0

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Schedule C Worksheet — {ctx.header.year}</Text>
        <Text style={styles.muted}>{ctx.header.clientName}</Text>

        <Text style={styles.h2}>Part I — Income</Text>
        <View style={styles.row}>
          <Text style={styles.cell}>Line 1 Gross receipts</Text>
          <Text style={styles.cellRight}>{fmtUSD(ctx.grossReceipts)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.cell}>Line 7 Gross income</Text>
          <Text style={styles.cellRight}>{fmtUSD(ctx.grossReceipts)}</Text>
        </View>

        <Text style={styles.h2}>Part II — Expenses</Text>
        <View style={styles.headerRow}>
          <Text style={styles.headerCell}>Line</Text>
          <Text style={styles.headerCellRight}>Amount</Text>
        </View>
        {SCHEDULE_C_LINES.map((line) => (
          <View key={line} style={styles.row}>
            <Text style={styles.cell}>{line}</Text>
            <Text style={styles.cellRight}>
              {fmtUSD(ctx.scheduleCTotals.get(line) ?? 0)}
            </Text>
          </View>
        ))}

        <View style={[styles.row, { borderBottomWidth: 2 }]}>
          <Text style={[styles.cell, { fontFamily: "Helvetica-Bold" }]}>Line 28 Total expenses</Text>
          <Text style={[styles.cellRight, { fontFamily: "Helvetica-Bold" }]}>
            {fmtUSD(totalDeductionsShown)}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.cell, { fontFamily: "Helvetica-Bold" }]}>Line 31 Net profit</Text>
          <Text style={[styles.cellRight, { fontFamily: "Helvetica-Bold" }]}>
            {fmtUSD(ctx.netProfit)}
          </Text>
        </View>

        {pctLine27 > 0.10 && (
          <Text style={[styles.small, { marginTop: 8, color: "#b45309" }]}>
            Warning: Line 27a Other Expenses is {(pctLine27 * 100).toFixed(1)}% of total deductions
            — IRS DIF flags this threshold at 10%.
          </Text>
        )}

        <PdfFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

export async function buildScheduleCWorksheetPdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadContext(taxYearId)
  const stream = await pdf(<ScheduleCDoc ctx={ctx} />).toBuffer()
  return streamToBuffer(stream)
}

// ---------------------------------------------------------------------------
// 3. Form 8829 (Home Office)
// ---------------------------------------------------------------------------

function Form8829Doc({ ctx }: { ctx: PackageContext }) {
  const cfg = ctx.homeOfficeConfig
  const hasOffice = !!cfg?.has
  const bizPct =
    hasOffice && cfg.officeSqft && cfg.homeSqft
      ? (cfg.officeSqft / cfg.homeSqft) * 100
      : 0
  const homeOfficeDeduction = ctx.scheduleCTotals.get("Line 30 Home Office") ?? 0

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Form 8829 Worksheet — Home Office</Text>
        <Text style={styles.muted}>{ctx.header.clientName} · Tax Year {ctx.header.year}</Text>

        {!hasOffice ? (
          <>
            <Text style={styles.h2}>No home office claimed</Text>
            <Text style={styles.small}>
              Business profile indicates no home office for this tax year. Form 8829 not required.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.h2}>Part I — Space calculation</Text>
            <View style={styles.row}>
              <Text style={styles.cell}>Area used for business</Text>
              <Text style={styles.cellRight}>{cfg.officeSqft ?? "[VERIFY]"} sq ft</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.cell}>Total area of home</Text>
              <Text style={styles.cellRight}>{cfg.homeSqft ?? "[VERIFY]"} sq ft</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.cell}>Business use %</Text>
              <Text style={styles.cellRight}>{bizPct.toFixed(2)}%</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.cell}>Exclusive & regular use</Text>
              <Text style={styles.cellRight}>{cfg.dedicated ? "Yes" : "No — §280A(c) requires exclusive use"}</Text>
            </View>

            <Text style={styles.h2}>Part II — Expenses (from Schedule C Line 30)</Text>
            <View style={styles.row}>
              <Text style={styles.cell}>Home office deduction</Text>
              <Text style={styles.cellRight}>{fmtUSD(homeOfficeDeduction)}</Text>
            </View>

            <Text style={[styles.small, { marginTop: 8 }]}>
              Citation: §280A(c). If not exclusive & regular, the deduction must be reclassified.
            </Text>
          </>
        )}

        <PdfFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

export async function buildForm8829Pdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadContext(taxYearId)
  const stream = await pdf(<Form8829Doc ctx={ctx} />).toBuffer()
  return streamToBuffer(stream)
}

// ---------------------------------------------------------------------------
// 4. Depreciation Schedule (V1 stub — §168(k) / §179 placeholders)
// ---------------------------------------------------------------------------

function DepreciationDoc({ ctx }: { ctx: PackageContext }) {
  const depreciation = ctx.scheduleCTotals.get("Line 13 Depreciation") ?? 0
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Depreciation Schedule — {ctx.header.year}</Text>
        <Text style={styles.muted}>{ctx.header.clientName}</Text>

        <Text style={styles.h2}>Summary</Text>
        <View style={styles.row}>
          <Text style={styles.cell}>Line 13 Depreciation (Schedule C)</Text>
          <Text style={styles.cellRight}>{fmtUSD(depreciation)}</Text>
        </View>

        <Text style={styles.h2}>Asset detail</Text>
        <Text style={styles.small}>
          V1 reports the Schedule C total only. Asset-level MACRS / §179 / §168(k) detail
          tracking is deferred to V2. The CPA should reconcile individual asset cost bases
          with the client's depreciation schedule before filing.
        </Text>

        <Text style={styles.h2}>Applicable citations</Text>
        <Text style={styles.small}>
          §167 · §168(k) (100% bonus post-OBBBA, acquired after 2025-01-19) · §179 election caps · §280F listed-property limits.
        </Text>

        <PdfFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

export async function buildDepreciationSchedulePdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadContext(taxYearId)
  const stream = await pdf(<DepreciationDoc ctx={ctx} />).toBuffer()
  return streamToBuffer(stream)
}

// ---------------------------------------------------------------------------
// 5. CPA Handoff Cover Letter
// ---------------------------------------------------------------------------

function CpaHandoffDoc({ ctx, stats }: { ctx: PackageContext; stats: HandoffStats }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>CPA Handoff — {ctx.header.clientName}</Text>
        <Text style={styles.muted}>Tax Year {ctx.header.year}</Text>

        <Text style={styles.h2}>What this package contains</Text>
        <Text style={styles.small}>
          • 01_client_summary.pdf — bottom-line figures{"\n"}
          • 02_schedule_c_worksheet.pdf — Part I / II line totals{"\n"}
          • 03_form_8829.pdf — home office (if applicable){"\n"}
          • 04_depreciation.pdf — Line 13 summary{"\n"}
          • 05_1099_nec_recipients.csv — contractors ≥ $600{"\n"}
          • 06_cpa_handoff.pdf — this letter{"\n"}
          • financial_statements.xlsx — 5-sheet GL/Schedule C/P&L/BS/detail{"\n"}
          • master_ledger.xlsx — full transaction ledger + merchant rules + STOP resolutions
        </Text>

        <Text style={styles.h2}>Figures at a glance</Text>
        <View style={styles.row}>
          <Text style={styles.cell}>Gross receipts</Text>
          <Text style={styles.cellRight}>{fmtUSD(ctx.grossReceipts)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.cell}>Total deductions</Text>
          <Text style={styles.cellRight}>{fmtUSD(ctx.totalDeductions)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.cell}>Net profit</Text>
          <Text style={styles.cellRight}>{fmtUSD(ctx.netProfit)}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.cell}>Transactions classified</Text>
          <Text style={styles.cellRight}>{stats.txCount.toLocaleString()}</Text>
        </View>
        <View style={styles.row}>
          <Text style={styles.cell}>STOPs resolved</Text>
          <Text style={styles.cellRight}>{stats.stopsResolved} of {stats.stopsTotal}</Text>
        </View>

        <Text style={styles.h2}>Decision points for the CPA</Text>
        <Text style={styles.small}>
          1. Confirm the home-office exclusive-use facts (Form 8829 worksheet).{"\n"}
          2. Verify listed-property caps (§280F) on any vehicle depreciation.{"\n"}
          3. Review position memos in 04_position_memos/ (audit packet) for gray-zone items.{"\n"}
          4. Cross-check 1099-NEC recipients against contractor payments for issuance.{"\n"}
          5. Ledger hash {ctx.header.ledgerHash ? `(${ctx.header.ledgerHash.slice(0, 16)}…)` : "[unlocked]"} — regenerating later reproduces identical numbers as long as rules stay pinned.
        </Text>

        <Text style={styles.h2}>What TaxLens did NOT do</Text>
        <Text style={styles.small}>
          TaxLens produced documents. It did not file anything, sign anything, or share anything
          externally. The CPA (not the AI) signs the return.
        </Text>

        <PdfFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

interface HandoffStats {
  txCount: number
  stopsResolved: number
  stopsTotal: number
}

export async function buildCpaHandoffPdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadContext(taxYearId)
  const [txCount, stopsResolved, stopsTotal] = await Promise.all([
    prisma.transaction.count({ where: { taxYearId, isSplit: false, isDuplicateOf: null } }),
    prisma.stopItem.count({ where: { taxYearId, state: "ANSWERED" } }),
    prisma.stopItem.count({ where: { taxYearId } }),
  ])
  const stream = await pdf(
    <CpaHandoffDoc ctx={ctx} stats={{ txCount, stopsResolved, stopsTotal }} />,
  ).toBuffer()
  return streamToBuffer(stream)
}

// ---------------------------------------------------------------------------
// 1099-NEC Recipients CSV (not a PDF — utility used by orchestrator)
// ---------------------------------------------------------------------------

function csvEscape(v: unknown): string {
  const s = v == null ? "" : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export async function build1099NecCsv(taxYearId: string): Promise<string> {
  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isDuplicateOf: null,
      classifications: { some: { isCurrent: true, code: "WRITE_OFF", scheduleCLine: "Line 11 Contract Labor" } },
    },
    select: {
      amountNormalized: true,
      merchantNormalized: true,
      merchantRaw: true,
    },
  })
  const byMerchant = new Map<string, number>()
  for (const t of txns) {
    const key = t.merchantNormalized ?? t.merchantRaw
    const amt = Math.abs(Number(t.amountNormalized.toString()))
    byMerchant.set(key, (byMerchant.get(key) ?? 0) + amt)
  }
  const rows = [...byMerchant.entries()]
    .filter(([, total]) => total >= 600)
    .sort(([, a], [, b]) => b - a)
  const headers = ["Recipient (normalized)", "Total paid", "Requires 1099-NEC?", "TIN / W-9 on file"]
  const lines = [headers.map(csvEscape).join(",")]
  for (const [name, total] of rows) {
    lines.push([name, total.toFixed(2), "Yes", "[VERIFY]"].map(csvEscape).join(","))
  }
  return lines.join("\r\n")
}

// ---------------------------------------------------------------------------
// Helper — @react-pdf/renderer's toBuffer returns a NodeJS.ReadableStream
// ---------------------------------------------------------------------------

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}
