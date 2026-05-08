/**
 * Entity-specific tax-form PDF builders — Phase 3.
 *
 * Generates Form 1120-S (S-Corp), Form 1065 (partnership), and Schedule K-1
 * (per-owner) PDFs from the same locked-ledger data the existing Schedule C
 * package uses. Each builder emits a worksheet-style PDF with the official
 * line numbers and totals computed deterministically from the ledger — no AI
 * calls. The CPA reads this, confirms the numbers, and transcribes to the
 * IRS form.
 *
 * Single-owner default: until a Shareholder/Partner model lands, the K-1
 * defaults the owner to the taxpayer's User row at 100% ownership. The
 * builder accepts an `owners[]` argument for future expansion.
 */

import React from "react"
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer"
import { Readable } from "node:stream"
import { prisma } from "@/lib/db"
import { getFormSpec } from "@/lib/forms/registry"
import { inYearWindow } from "@/lib/queries/yearWindow"

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111" },
  formHeaderBar: {
    backgroundColor: "#0a1f44",
    color: "#fff",
    padding: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    marginBottom: 10,
  },
  h1: { fontSize: 16, marginBottom: 4, fontFamily: "Helvetica-Bold" },
  h2: { fontSize: 12, marginTop: 14, marginBottom: 6, fontFamily: "Helvetica-Bold" },
  muted: { color: "#555" },
  small: { fontSize: 9, color: "#555" },
  line: {
    flexDirection: "row",
    paddingVertical: 4,
    borderBottom: "1 solid #e5e7eb",
  },
  lineNum: { width: 36, fontFamily: "Helvetica-Bold", fontSize: 10 },
  lineLabel: { flex: 1, paddingRight: 8 },
  lineAmount: { width: 100, textAlign: "right", fontFamily: "Helvetica" },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderTop: "2 solid #0a1f44",
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
  },
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
  warningBox: {
    border: "1 solid #f59e0b",
    backgroundColor: "#fef3c7",
    padding: 8,
    marginVertical: 8,
    fontSize: 9,
  },
})

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
}

interface EntityHeader {
  clientName: string
  ein: string | null
  year: number
  primaryReturn: string
  generatedAt: string
}

function FormFooter({ header }: { header: EntityHeader }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        TaxLens · {header.clientName} · {header.primaryReturn} · TY {header.year} · Generated {header.generatedAt}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

// ---------------------------------------------------------------------------
// Entity-aware context loader
// ---------------------------------------------------------------------------

interface EntityContext {
  header: EntityHeader
  entityType: string
  formSpec: ReturnType<typeof getFormSpec>
  totalsByLine: Map<string, number>
  grossReceipts: number
  totalDeductions: number
  netIncome: number
  ownerName: string
  ownerEmail: string
}

async function loadEntityContext(taxYearId: string): Promise<EntityContext> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: { user: { select: { name: true, email: true } } },
  })
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { entityType: true },
  })
  const entityType = profile?.entityType ?? "SOLE_PROP"
  const formSpec = getFormSpec(entityType)
  const clientName = ty.user.name ?? ty.user.email

  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, isDuplicateOf: null, ...inYearWindow(ty.year) },
    select: {
      amountNormalized: true,
      classifications: {
        where: { isCurrent: true },
        select: { code: true, scheduleCLine: true, businessPct: true },
      },
    },
  })

  const totalsByLine = new Map<string, number>()
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
      totalsByLine.set(cls.scheduleCLine, (totalsByLine.get(cls.scheduleCLine) ?? 0) + deductible)
    }
  }

  return {
    header: {
      clientName,
      ein: null, // EIN field not yet captured — placeholder for future BusinessProfile.ein.
      year: ty.year,
      primaryReturn: formSpec.primaryReturn,
      generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    },
    entityType,
    formSpec,
    totalsByLine,
    grossReceipts,
    totalDeductions,
    netIncome: grossReceipts - totalDeductions,
    ownerName: clientName,
    ownerEmail: ty.user.email,
  }
}

// ---------------------------------------------------------------------------
// Shared row component
// ---------------------------------------------------------------------------

function FormLine({ num, label, amount }: { num: string; label: string; amount: number | null }) {
  return (
    <View style={styles.line}>
      <Text style={styles.lineNum}>{num}</Text>
      <Text style={styles.lineLabel}>{label}</Text>
      <Text style={styles.lineAmount}>{amount === null ? "—" : fmtUSD(amount)}</Text>
    </View>
  )
}

// ---------------------------------------------------------------------------
// Form 1120-S — S-Corp Income Tax Return Worksheet
// ---------------------------------------------------------------------------

function Form1120SDoc({ ctx }: { ctx: EntityContext }) {
  const t = ctx.totalsByLine
  // Map computed totals → IRS Form 1120-S line numbers (2025 form).
  const grossReceipts = ctx.grossReceipts
  const cogs = t.get("Part III COGS") ?? 0
  const grossProfit = grossReceipts - cogs

  // Deduction-side bucketization. The CPA agent writes the line names
  // verbatim; we group by their semantic mapping to Form 1120-S lines.
  const officerComp = t.get("7 Compensation of officers") ?? 0
  const salaries = t.get("8 Salaries and wages (less employment credits)") ?? 0
  const repairs = t.get("9 Repairs and maintenance") ?? t.get("Line 21 Repairs & Maintenance") ?? 0
  const rents = t.get("11 Rents") ?? t.get("Line 20b Rent — Other") ?? 0
  const taxes = t.get("12 Taxes and licenses") ?? t.get("Line 23 Taxes & Licenses") ?? 0
  const interest = t.get("13 Interest expense") ?? t.get("Line 16b Interest") ?? 0
  const depreciation = t.get("14 Depreciation") ?? t.get("Line 13 Depreciation") ?? 0
  const advertising = t.get("16 Advertising") ?? t.get("Line 8 Advertising") ?? 0
  const benefits = t.get("18 Employee benefit programs") ?? t.get("Line 15 Insurance") ?? 0
  // Everything else → "19 Other deductions"
  const knownLines = new Set([
    "7 Compensation of officers",
    "8 Salaries and wages (less employment credits)",
    "9 Repairs and maintenance",
    "11 Rents",
    "12 Taxes and licenses",
    "13 Interest expense",
    "14 Depreciation",
    "16 Advertising",
    "17 Pension, profit-sharing, etc., plans",
    "18 Employee benefit programs",
    "Part III COGS",
    "Line 21 Repairs & Maintenance",
    "Line 20b Rent — Other",
    "Line 23 Taxes & Licenses",
    "Line 16b Interest",
    "Line 13 Depreciation",
    "Line 8 Advertising",
    "Line 15 Insurance",
  ])
  let other = 0
  for (const [line, amt] of t.entries()) {
    if (!knownLines.has(line)) other += amt
  }

  const totalDeductions =
    officerComp + salaries + repairs + rents + taxes + interest + depreciation + advertising + benefits + other
  const ordinaryIncome = grossProfit - totalDeductions

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.formHeaderBar}>
          <Text>FORM 1120-S WORKSHEET — TaxLens (not the official IRS form)</Text>
        </View>
        <Text style={styles.h1}>{ctx.ownerName}</Text>
        <Text style={styles.muted}>
          S-Corporation Income Tax Return · Tax Year {ctx.header.year}
          {ctx.header.ein ? ` · EIN ${ctx.header.ein}` : " · EIN: [VERIFY]"}
        </Text>

        <Text style={styles.h2}>Income</Text>
        <FormLine num="1a" label="Gross receipts or sales" amount={grossReceipts} />
        <FormLine num="2" label="Cost of goods sold" amount={cogs} />
        <FormLine num="3" label="Gross profit" amount={grossProfit} />

        <Text style={styles.h2}>Deductions</Text>
        <FormLine num="7" label="Compensation of officers" amount={officerComp} />
        <FormLine num="8" label="Salaries and wages (less employment credits)" amount={salaries} />
        <FormLine num="9" label="Repairs and maintenance" amount={repairs} />
        <FormLine num="11" label="Rents" amount={rents} />
        <FormLine num="12" label="Taxes and licenses" amount={taxes} />
        <FormLine num="13" label="Interest expense" amount={interest} />
        <FormLine num="14" label="Depreciation" amount={depreciation} />
        <FormLine num="16" label="Advertising" amount={advertising} />
        <FormLine num="18" label="Employee benefit programs" amount={benefits} />
        <FormLine num="19" label="Other deductions (see attached statement)" amount={other} />

        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>20</Text>
          <Text style={styles.lineLabel}>Total deductions</Text>
          <Text style={styles.lineAmount}>{fmtUSD(totalDeductions)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>21</Text>
          <Text style={styles.lineLabel}>Ordinary business income (loss) — flows to Schedule K-1 Box 1</Text>
          <Text style={styles.lineAmount}>{fmtUSD(ordinaryIncome)}</Text>
        </View>

        {officerComp === 0 && grossReceipts > 0 && (
          <View style={styles.warningBox}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>⚠ Reasonable compensation flag</Text>
            <Text style={{ marginTop: 3 }}>
              Officer compensation is $0 with $
              {grossReceipts.toLocaleString()} in gross receipts. The IRS treats zero
              W-2 wages on a profitable S-Corp as a top-tier audit trigger
              (§1402 / Watson v. Commissioner). Add officer payroll before filing.
            </Text>
          </View>
        )}

        <FormFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Form 1065 — Partnership Return Worksheet
// ---------------------------------------------------------------------------

function Form1065Doc({ ctx }: { ctx: EntityContext }) {
  const t = ctx.totalsByLine
  const grossReceipts = ctx.grossReceipts
  const cogs = t.get("Part III COGS") ?? 0
  const grossProfit = grossReceipts - cogs

  const salaries = t.get("9 Salaries and wages (less employment credits)") ?? 0
  const guaranteedPay = t.get("10 Guaranteed payments to partners") ?? 0
  const repairs = t.get("11 Repairs and maintenance") ?? t.get("Line 21 Repairs & Maintenance") ?? 0
  const rent = t.get("13 Rent") ?? t.get("Line 20b Rent — Other") ?? 0
  const taxes = t.get("14 Taxes and licenses") ?? t.get("Line 23 Taxes & Licenses") ?? 0
  const interest = t.get("15 Interest expense") ?? t.get("Line 16b Interest") ?? 0
  const depreciation = t.get("16a Depreciation") ?? t.get("Line 13 Depreciation") ?? 0

  const knownLines = new Set([
    "9 Salaries and wages (less employment credits)",
    "10 Guaranteed payments to partners",
    "11 Repairs and maintenance",
    "13 Rent",
    "14 Taxes and licenses",
    "15 Interest expense",
    "16a Depreciation",
    "Part III COGS",
    "Line 21 Repairs & Maintenance",
    "Line 20b Rent — Other",
    "Line 23 Taxes & Licenses",
    "Line 16b Interest",
    "Line 13 Depreciation",
  ])
  let other = 0
  for (const [line, amt] of t.entries()) {
    if (!knownLines.has(line)) other += amt
  }

  const totalDeductions = salaries + guaranteedPay + repairs + rent + taxes + interest + depreciation + other
  const ordinaryIncome = grossProfit - totalDeductions

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.formHeaderBar}>
          <Text>FORM 1065 WORKSHEET — TaxLens (not the official IRS form)</Text>
        </View>
        <Text style={styles.h1}>{ctx.ownerName}</Text>
        <Text style={styles.muted}>
          Partnership / Multi-Member LLC Return · Tax Year {ctx.header.year}
          {ctx.header.ein ? ` · EIN ${ctx.header.ein}` : " · EIN: [VERIFY]"}
        </Text>

        <Text style={styles.h2}>Income</Text>
        <FormLine num="1a" label="Gross receipts or sales" amount={grossReceipts} />
        <FormLine num="2" label="Cost of goods sold" amount={cogs} />
        <FormLine num="3" label="Gross profit" amount={grossProfit} />

        <Text style={styles.h2}>Deductions</Text>
        <FormLine num="9" label="Salaries and wages (less employment credits)" amount={salaries} />
        <FormLine num="10" label="Guaranteed payments to partners" amount={guaranteedPay} />
        <FormLine num="11" label="Repairs and maintenance" amount={repairs} />
        <FormLine num="13" label="Rent" amount={rent} />
        <FormLine num="14" label="Taxes and licenses" amount={taxes} />
        <FormLine num="15" label="Interest expense" amount={interest} />
        <FormLine num="16a" label="Depreciation" amount={depreciation} />
        <FormLine num="20" label="Other deductions (see attached statement)" amount={other} />

        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>21</Text>
          <Text style={styles.lineLabel}>Total deductions</Text>
          <Text style={styles.lineAmount}>{fmtUSD(totalDeductions)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>22</Text>
          <Text style={styles.lineLabel}>Ordinary business income (loss) — flows to Schedule K-1 Box 1</Text>
          <Text style={styles.lineAmount}>{fmtUSD(ordinaryIncome)}</Text>
        </View>

        <FormFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Schedule K-1 — single-owner default (100%)
// ---------------------------------------------------------------------------

interface K1Owner {
  name: string
  ssnLast4: string | null
  ownershipPct: number
  /** S-Corp only: owner's W-2 wages from the corp during the year. */
  w2Wages?: number
  /** Partnership only: §707(c) guaranteed payments to this partner. */
  guaranteedPayments?: number
  /** OFFICER | SHAREHOLDER | GENERAL_PARTNER | LIMITED_PARTNER | MEMBER */
  kind?: string
}

/**
 * Loads the recorded Owner rows for a TaxYear's BusinessProfile. Returns []
 * when no owners are recorded — caller should fall back to a single-owner
 * 100% default in that case.
 */
async function loadOwnersForTaxYear(taxYearId: string): Promise<K1Owner[]> {
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { id: true },
  })
  if (!profile) return []
  const owners = await prisma.owner.findMany({
    where: { profileId: profile.id },
    orderBy: { ownershipPct: "desc" },
  })
  return owners.map((o) => ({
    name: o.name,
    ssnLast4: o.ssnLast4,
    ownershipPct: Number(o.ownershipPct.toString()),
    w2Wages: o.w2Wages ? Number(o.w2Wages.toString()) : undefined,
    guaranteedPayments: o.guaranteedPayments ? Number(o.guaranteedPayments.toString()) : undefined,
    kind: o.kind,
  }))
}

function ScheduleK1Doc({
  ctx,
  owner,
  sourceForm,
  isSingleOwnerDefault,
}: {
  ctx: EntityContext
  owner: K1Owner
  sourceForm: "1120-S" | "1065"
  isSingleOwnerDefault: boolean
}) {
  const t = ctx.totalsByLine
  const grossReceipts = ctx.grossReceipts
  const cogs = t.get("Part III COGS") ?? 0
  const totalDeductions = ctx.totalDeductions
  const ordinaryIncome = grossReceipts - cogs - totalDeductions
  const allocated = ordinaryIncome * (owner.ownershipPct / 100)

  // SE-tax posture differs by source form AND owner.kind for partnerships.
  // General partners pay SE tax on Box 14; limited partners do NOT (per
  // §1402(a)(13) self-employment exception). S-Corp shareholders never pay
  // SE tax on K-1 distributions — only on W-2 wages.
  const isLimitedPartner = sourceForm === "1065" && owner.kind === "LIMITED_PARTNER"
  const seTaxNote =
    sourceForm === "1065"
      ? isLimitedPartner
        ? `Limited partner — Box 14 self-employment earnings excluded per §1402(a)(13).`
        : `Box 14 self-employment earnings: ${fmtUSD(allocated)} (general partner — subject to §1402 SE tax)`
      : `S-Corp distributions are NOT subject to §1402 SE tax — owner pays SE tax on W-2 wages only.`

  const ownerLabel =
    sourceForm === "1120-S"
      ? owner.kind === "OFFICER"
        ? "S-Corp Officer-Shareholder"
        : "S-Corp Shareholder"
      : owner.kind === "GENERAL_PARTNER"
        ? "General Partner"
        : owner.kind === "LIMITED_PARTNER"
          ? "Limited Partner"
          : "Partner / Member"

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.formHeaderBar}>
          <Text>SCHEDULE K-1 ({sourceForm}) WORKSHEET — TaxLens (not the official IRS form)</Text>
        </View>
        <Text style={styles.h1}>Schedule K-1 — {owner.name}</Text>
        <Text style={styles.muted}>
          {ownerLabel} · {owner.ownershipPct.toFixed(2)}% ownership
          {owner.ssnLast4 ? ` · SSN ending ${owner.ssnLast4}` : " · SSN: [VERIFY]"}
        </Text>
        <Text style={styles.muted}>
          {ctx.ownerName} · {ctx.header.primaryReturn} · TY {ctx.header.year}
        </Text>

        <Text style={styles.h2}>Allocable income items</Text>
        <FormLine num="1" label="Ordinary business income (loss)" amount={allocated} />
        <FormLine num="2" label="Net rental real estate income (loss)" amount={null} />
        <FormLine num={sourceForm === "1065" ? "5" : "4"} label="Interest income" amount={null} />
        <FormLine num={sourceForm === "1065" ? "6a" : "5a"} label="Ordinary dividends" amount={null} />

        {sourceForm === "1065" && owner.guaranteedPayments !== undefined && owner.guaranteedPayments > 0 && (
          <FormLine num="4a" label="Guaranteed payments for services (§707(c))" amount={owner.guaranteedPayments} />
        )}

        {sourceForm === "1120-S" && owner.w2Wages !== undefined && (
          <>
            <Text style={styles.h2}>Owner W-2 wages (informational)</Text>
            <FormLine num="—" label="Owner W-2 wages from this corporation" amount={owner.w2Wages} />
          </>
        )}

        <Text style={styles.h2}>SE tax posture</Text>
        <Text style={styles.small}>{seTaxNote}</Text>

        {isSingleOwnerDefault && (
          <View style={styles.warningBox}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>Single-owner default</Text>
            <Text style={{ marginTop: 3 }}>
              No Owner records have been entered for this entity, so this K-1
              defaults the taxpayer to 100% ownership. Add Owner rows
              (Profile → Owners) to render one K-1 per shareholder/partner
              with per-owner ownership %, W-2 wages, and guaranteed payments.
            </Text>
          </View>
        )}

        <FormFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Form 1120 — C-Corp Income Tax Return Worksheet
// ---------------------------------------------------------------------------

const C_CORP_FED_RATE = 0.21

function Form1120Doc({ ctx }: { ctx: EntityContext }) {
  const t = ctx.totalsByLine
  const grossReceipts = ctx.grossReceipts
  const cogs = t.get("Part III COGS") ?? 0
  const grossProfit = grossReceipts - cogs

  const officerComp = t.get("12 Compensation of officers") ?? 0
  const salaries = t.get("13 Salaries and wages (less employment credits)") ?? 0
  const repairs = t.get("14 Repairs and maintenance") ?? t.get("Line 21 Repairs & Maintenance") ?? 0
  const rents = t.get("16 Rents") ?? t.get("Line 20b Rent — Other") ?? 0
  const taxes = t.get("17 Taxes and licenses") ?? t.get("Line 23 Taxes & Licenses") ?? 0
  const interest = t.get("18 Interest") ?? t.get("Line 16b Interest") ?? 0
  const charitable = t.get("19 Charitable contributions") ?? 0
  const depreciation = t.get("20 Depreciation") ?? t.get("Line 13 Depreciation") ?? 0
  const advertising = t.get("22 Advertising") ?? t.get("Line 8 Advertising") ?? 0
  const benefits = t.get("24 Employee benefit programs") ?? t.get("Line 15 Insurance") ?? 0

  const knownLines = new Set([
    "12 Compensation of officers",
    "13 Salaries and wages (less employment credits)",
    "14 Repairs and maintenance",
    "16 Rents",
    "17 Taxes and licenses",
    "18 Interest",
    "19 Charitable contributions",
    "20 Depreciation",
    "22 Advertising",
    "23 Pension, profit-sharing, etc., plans",
    "24 Employee benefit programs",
    "Part III COGS",
    "Line 21 Repairs & Maintenance",
    "Line 20b Rent — Other",
    "Line 23 Taxes & Licenses",
    "Line 16b Interest",
    "Line 13 Depreciation",
    "Line 8 Advertising",
    "Line 15 Insurance",
  ])
  let other = 0
  for (const [line, amt] of t.entries()) {
    if (!knownLines.has(line)) other += amt
  }

  const totalDeductions =
    officerComp + salaries + repairs + rents + taxes + interest + charitable + depreciation + advertising + benefits + other
  const taxableIncome = grossProfit - totalDeductions
  const fedTax = Math.max(0, taxableIncome) * C_CORP_FED_RATE

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.formHeaderBar}>
          <Text>FORM 1120 WORKSHEET — TaxLens (not the official IRS form)</Text>
        </View>
        <Text style={styles.h1}>{ctx.ownerName}</Text>
        <Text style={styles.muted}>
          C-Corporation Income Tax Return · Tax Year {ctx.header.year}
          {ctx.header.ein ? ` · EIN ${ctx.header.ein}` : " · EIN: [VERIFY]"}
        </Text>

        <Text style={styles.h2}>Income</Text>
        <FormLine num="1a" label="Gross receipts or sales" amount={grossReceipts} />
        <FormLine num="2" label="Cost of goods sold" amount={cogs} />
        <FormLine num="3" label="Gross profit" amount={grossProfit} />

        <Text style={styles.h2}>Deductions</Text>
        <FormLine num="12" label="Compensation of officers" amount={officerComp} />
        <FormLine num="13" label="Salaries and wages (less employment credits)" amount={salaries} />
        <FormLine num="14" label="Repairs and maintenance" amount={repairs} />
        <FormLine num="16" label="Rents" amount={rents} />
        <FormLine num="17" label="Taxes and licenses" amount={taxes} />
        <FormLine num="18" label="Interest" amount={interest} />
        <FormLine num="19" label="Charitable contributions" amount={charitable} />
        <FormLine num="20" label="Depreciation" amount={depreciation} />
        <FormLine num="22" label="Advertising" amount={advertising} />
        <FormLine num="24" label="Employee benefit programs" amount={benefits} />
        <FormLine num="26" label="Other deductions (see attached statement)" amount={other} />

        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>27</Text>
          <Text style={styles.lineLabel}>Total deductions</Text>
          <Text style={styles.lineAmount}>{fmtUSD(totalDeductions)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>30</Text>
          <Text style={styles.lineLabel}>Taxable income (before NOL/special deductions)</Text>
          <Text style={styles.lineAmount}>{fmtUSD(taxableIncome)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>31</Text>
          <Text style={styles.lineLabel}>Federal income tax @ 21% flat rate</Text>
          <Text style={styles.lineAmount}>{fmtUSD(fedTax)}</Text>
        </View>

        {officerComp === 0 && grossReceipts > 0 && (
          <View style={styles.warningBox}>
            <Text style={{ fontFamily: "Helvetica-Bold" }}>⚠ Officer compensation flag</Text>
            <Text style={{ marginTop: 3 }}>
              Officer compensation is $0 with positive gross receipts. C-Corp
              shareholder-officers actively rendering services should receive
              W-2 wages. Unreasonably low officer pay can be re-characterized
              by the IRS, especially in closely-held C-Corps that distribute
              dividends.
            </Text>
          </View>
        )}

        <View style={styles.warningBox}>
          <Text style={{ fontFamily: "Helvetica-Bold" }}>Double-taxation reminder</Text>
          <Text style={{ marginTop: 3 }}>
            C-Corp net income is taxed at the entity level (~$
            {Math.round(fedTax).toLocaleString()} above). Distributions to
            shareholders are then taxed again as dividends on their personal
            1040. Compare against an S-Corp election for closely-held single-
            owner businesses.
          </Text>
        </View>

        <FormFooter header={ctx.header} />
      </Page>
    </Document>
  )
}

// ---------------------------------------------------------------------------
// Public builders
// ---------------------------------------------------------------------------

async function pdfToBuffer(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function buildForm1120SPdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadEntityContext(taxYearId)
  const stream = await pdf(<Form1120SDoc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildForm1065Pdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadEntityContext(taxYearId)
  const stream = await pdf(<Form1065Doc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildForm1120Pdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadEntityContext(taxYearId)
  const stream = await pdf(<Form1120Doc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildScheduleK1Pdf(
  taxYearId: string,
  opts: { sourceForm: "1120-S" | "1065"; owner?: Partial<K1Owner> } = { sourceForm: "1120-S" },
): Promise<Buffer> {
  const ctx = await loadEntityContext(taxYearId)
  const owner: K1Owner = {
    name: opts.owner?.name ?? ctx.ownerName,
    ssnLast4: opts.owner?.ssnLast4 ?? null,
    ownershipPct: opts.owner?.ownershipPct ?? 100,
    w2Wages: opts.owner?.w2Wages,
    guaranteedPayments: opts.owner?.guaranteedPayments,
    kind: opts.owner?.kind,
  }
  const stream = await pdf(
    <ScheduleK1Doc ctx={ctx} owner={owner} sourceForm={opts.sourceForm} isSingleOwnerDefault={true} />,
  ).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

/**
 * Per-owner K-1 emitter. Reads Owner rows from BusinessProfile; emits one
 * K-1 PDF per recorded owner. Falls back to the single-owner-100% default
 * (via buildScheduleK1Pdf) when no Owner rows exist for the profile.
 *
 * Returns an array of `{ owner, buffer }` so the tax-package router can
 * name each PDF with the owner's name (e.g. `08_k1_atif_ameer.pdf`).
 */
export async function buildScheduleK1PdfPerOwner(
  taxYearId: string,
  sourceForm: "1120-S" | "1065",
): Promise<Array<{ owner: K1Owner; buffer: Buffer }>> {
  const owners = await loadOwnersForTaxYear(taxYearId)
  if (owners.length === 0) {
    // No owners on file — fall back to single-owner default.
    const buf = await buildScheduleK1Pdf(taxYearId, { sourceForm })
    const ctx = await loadEntityContext(taxYearId)
    return [{
      owner: { name: ctx.ownerName, ssnLast4: null, ownershipPct: 100 },
      buffer: buf,
    }]
  }
  const ctx = await loadEntityContext(taxYearId)
  const out: Array<{ owner: K1Owner; buffer: Buffer }> = []
  for (const owner of owners) {
    const stream = await pdf(
      <ScheduleK1Doc ctx={ctx} owner={owner} sourceForm={sourceForm} isSingleOwnerDefault={false} />,
    ).toBuffer()
    const buffer = await pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
    out.push({ owner, buffer })
  }
  return out
}

/** Slugify an owner name for use in a filename. */
function slugifyOwnerName(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .slice(0, 40)
}

export { slugifyOwnerName }

void Readable // satisfy import-not-used in some setups
