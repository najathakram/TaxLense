/**
 * Supplementary tax-form PDFs — Schedule SE, Form 8995 (QBI), Form 1125-A
 * (COGS), Form 4562 (depreciation), Schedule M-1 / M-2 / L (corp books).
 *
 * Same data-source pattern as entityForms.tsx — pure functions over the
 * locked-ledger snapshot. CPA reviews the worksheet and transcribes to
 * the official IRS form. No AI calls.
 *
 * Per TY2025 IRS rules:
 *   - Schedule SE: 92.35% × Schedule C net × 15.3% (12.4% SS up to wage
 *     base + 2.9% Medicare on all). Wage base for 2025: $176,100.
 *   - Form 8995 (Simplified): QBI threshold $241,950 single / $483,900
 *     MFJ. Above threshold → Form 8995-A required.
 *   - §168(k) bonus: 40% for 2025. §179 cap: $1,250,000 with phaseout
 *     starting at $3,130,000 (Rev. Proc. 2024-40).
 */

import React from "react"
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer"
import { prisma } from "@/lib/db"
import { inYearWindow } from "@/lib/queries/yearWindow"

const TY2025_SS_WAGE_BASE = 176_100
const TY2025_SS_RATE = 0.124
const TY2025_MEDICARE_RATE = 0.029
const TY2025_SE_BASE_FACTOR = 0.9235

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: "Helvetica", color: "#111" },
  header: {
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
  lineAmount: { width: 100, textAlign: "right" },
  totalRow: {
    flexDirection: "row",
    paddingVertical: 6,
    borderTop: "2 solid #0a1f44",
    marginTop: 6,
    fontFamily: "Helvetica-Bold",
  },
  authority: {
    fontSize: 8,
    color: "#666",
    marginTop: 8,
    fontStyle: "italic",
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
})

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

function FormLine({
  num,
  label,
  amount,
  bold,
}: {
  num: string
  label: string
  amount: number | null
  bold?: boolean
}) {
  return (
    <View style={styles.line}>
      <Text style={[styles.lineNum, bold ? { fontFamily: "Helvetica-Bold" } : {}]}>{num}</Text>
      <Text style={[styles.lineLabel, bold ? { fontFamily: "Helvetica-Bold" } : {}]}>{label}</Text>
      <Text style={[styles.lineAmount, bold ? { fontFamily: "Helvetica-Bold" } : {}]}>
        {amount === null ? "—" : fmtUSD(amount)}
      </Text>
    </View>
  )
}

interface ContextHeader {
  clientName: string
  year: number
  generatedAt: string
}

function PageFooter({ header, formId }: { header: ContextHeader; formId: string }) {
  return (
    <View style={styles.footer} fixed>
      <Text>
        TaxLens · {header.clientName} · {formId} · TY {header.year} · Generated {header.generatedAt}
      </Text>
      <Text render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  )
}

interface ScheduleContext {
  header: ContextHeader
  netProfit: number
  grossReceipts: number
  totalDeductions: number
  cogs: number
  totalsByLine: Map<string, number>
  hasHomeOffice: boolean
  homeOfficeMethod: string | null
  entityType: string
}

async function loadScheduleContext(taxYearId: string): Promise<ScheduleContext> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: { user: { select: { name: true, email: true } } },
  })
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { entityType: true, homeOfficeConfig: true },
  })

  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, ...inYearWindow(ty.year) },
    select: {
      amountNormalized: true,
      classifications: {
        where: { isCurrent: true },
        select: { code: true, scheduleCLine: true, businessPct: true },
      },
    },
  })

  const totalsByLine = new Map<string, number>()
  let grossReceipts = 0
  let totalDeductions = 0
  let cogs = 0
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
    if (cls.scheduleCLine?.toLowerCase().includes("part iii cogs") || cls.code === "WRITE_OFF_COGS") {
      cogs += deductible
    }
    if (cls.scheduleCLine) {
      totalsByLine.set(cls.scheduleCLine, (totalsByLine.get(cls.scheduleCLine) ?? 0) + deductible)
    }
  }

  const ho = (profile?.homeOfficeConfig ?? {}) as { has?: boolean; method?: string }

  return {
    header: {
      clientName: ty.user.name ?? ty.user.email,
      year: ty.year,
      generatedAt: new Date().toISOString().slice(0, 19).replace("T", " "),
    },
    netProfit: grossReceipts - totalDeductions,
    grossReceipts,
    totalDeductions,
    cogs,
    totalsByLine,
    hasHomeOffice: !!ho.has,
    homeOfficeMethod: ho.method ?? null,
    entityType: profile?.entityType ?? "SOLE_PROP",
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Schedule SE — Self-Employment Tax
// ─────────────────────────────────────────────────────────────────────────

function ScheduleSeDoc({ ctx }: { ctx: ScheduleContext }) {
  const line2 = Math.max(0, ctx.netProfit)                   // Net SE earnings from Schedule C line 31
  const line3 = line2                                        // No farm income line
  const line4a = line3 * TY2025_SE_BASE_FACTOR               // 92.35%
  const line4c = line4a                                      // No optional methods
  const line8a = 0                                           // W-2 SS wages — not tracked
  const line8d = 0
  const line9 = Math.max(0, TY2025_SS_WAGE_BASE - line8d)
  const line10 = Math.min(line4c, line9) * TY2025_SS_RATE    // SS portion
  const line11 = line4c * TY2025_MEDICARE_RATE               // Medicare portion
  const line12 = line10 + line11                             // Total SE tax
  const line13 = line12 * 0.5                                // Deductible portion (Schedule 1 line 15)

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>SCHEDULE SE WORKSHEET — TaxLens (not the official IRS form)</Text>
        </View>
        <Text style={styles.h1}>{ctx.header.clientName}</Text>
        <Text style={styles.muted}>
          Self-Employment Tax · Tax Year {ctx.header.year}
        </Text>

        <Text style={styles.h2}>Part I — Self-Employment Tax</Text>
        <FormLine num="2" label="Net profit from Schedule C, line 31" amount={line2} />
        <FormLine num="3" label="Combine lines 1a, 1b, and 2" amount={line3} />
        <FormLine num="4a" label="Multiply line 3 by 92.35% (.9235)" amount={line4a} />
        <FormLine num="4c" label="Combine lines 4a and 4b" amount={line4c} />
        <FormLine
          num="8a"
          label="Total Social Security wages and tips from W-2 (taxpayer-supplied)"
          amount={line8a}
        />
        <FormLine
          num="9"
          label={`Subtract line 8d from $${TY2025_SS_WAGE_BASE.toLocaleString()} (TY2025 SS wage base)`}
          amount={line9}
        />
        <FormLine
          num="10"
          label={`Multiply smaller of line 6 or 9 by 12.4% (Social Security)`}
          amount={line10}
        />
        <FormLine num="11" label="Multiply line 6 by 2.9% (Medicare)" amount={line11} />
        <FormLine num="12" label="Self-employment tax (lines 10 + 11)" amount={line12} bold />
        <FormLine
          num="13"
          label="Deduction for one-half of SE tax — flows to Schedule 1, line 15"
          amount={line13}
          bold
        />

        <Text style={styles.authority}>
          Authority: IRC §1401, §1402; Schedule SE (Form 1040) Instructions Rev. 2025.
          TY2025 Social Security wage base $176,100 per SSA Cost-of-Living Adjustment Notice.
        </Text>

        {line2 < 400 && (
          <View style={[styles.line, { borderColor: "#f59e0b", backgroundColor: "#fef3c7", padding: 6, marginTop: 12 }]}>
            <Text style={{ fontSize: 9 }}>
              Net SE earnings ${line2.toFixed(2)} below $400 threshold (IRC §1402(b)) — Schedule SE not required.
            </Text>
          </View>
        )}

        <PageFooter header={ctx.header} formId="Schedule SE (Form 1040)" />
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Form 8995 — QBI Deduction Simplified
// ─────────────────────────────────────────────────────────────────────────

function Form8995Doc({ ctx }: { ctx: ScheduleContext }) {
  // Simplified method (TY2025 thresholds: $241,950 single / $483,900 MFJ).
  // We can't know taxpayer's filing status / total taxable income from the
  // ledger alone, so this worksheet computes the QBI component and notes
  // the 20% × lesser-of comparison the taxpayer must do on their 1040.
  const qbi = Math.max(0, ctx.netProfit)
  const seTaxDeduction = qbi * TY2025_SE_BASE_FACTOR * (TY2025_SS_RATE + TY2025_MEDICARE_RATE) * 0.5
  const adjustedQbi = qbi - seTaxDeduction // Per §199A regs — QBI reduced by deductible SE-tax half
  const qbiComponent = adjustedQbi * 0.2
  const totalQbiDeduction = qbiComponent

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>FORM 8995 WORKSHEET — TaxLens (Simplified QBI Deduction)</Text>
        </View>
        <Text style={styles.h1}>{ctx.header.clientName}</Text>
        <Text style={styles.muted}>
          QBI Deduction (§199A) · Tax Year {ctx.header.year}
        </Text>

        <Text style={styles.h2}>Qualified Business Income</Text>
        <FormLine num="1i" label="Trade or business name" amount={null} />
        <FormLine num="1ii" label="Taxpayer EIN" amount={null} />
        <FormLine num="1iii" label="Qualified business income (loss) — Schedule C net" amount={qbi} />
        <FormLine num="—" label="Less: deductible 1/2 SE-tax adjustment (per §199A regs)" amount={seTaxDeduction} />
        <FormLine num="2" label="Total qualified business income" amount={adjustedQbi} bold />

        <Text style={styles.h2}>QBI Component</Text>
        <FormLine num="5" label="QBI component — 20% of line 2" amount={qbiComponent} bold />

        <Text style={styles.h2}>Final calculation</Text>
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>15</Text>
          <Text style={styles.lineLabel}>QBI deduction — flows to Form 1040 line 13</Text>
          <Text style={styles.lineAmount}>{fmtUSD(totalQbiDeduction)}</Text>
        </View>

        <Text style={styles.authority}>
          Authority: IRC §199A; Reg §1.199A-1; Form 8995 Instructions Rev. 2025.
          TY2025 thresholds: $241,950 single / $483,900 MFJ. Above threshold OR
          SSTB requires Form 8995-A (not generated here).
        </Text>

        {ctx.netProfit <= 0 && (
          <View style={[styles.line, { borderColor: "#f59e0b", backgroundColor: "#fef3c7", padding: 6, marginTop: 12 }]}>
            <Text style={{ fontSize: 9 }}>
              Net Schedule C is a loss — QBI for this business is $0 this year.
              The negative QBI is carried forward as a §199A loss to future years
              (captured automatically in PriorYearContext.qbiLossCarryforward at lock).
            </Text>
          </View>
        )}

        <PageFooter header={ctx.header} formId="Form 8995" />
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Form 1125-A — Cost of Goods Sold
// ─────────────────────────────────────────────────────────────────────────

function Form1125ADoc({ ctx }: { ctx: ScheduleContext }) {
  // Without inventory tracking we treat the year as cash-method dropship:
  // BOY inventory $0 + purchases (= COGS classifications) − EOY inventory $0
  // = COGS. CPA can override on the form.
  const purchases = ctx.cogs
  const totalCogs = 0 + purchases - 0

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>FORM 1125-A WORKSHEET — TaxLens (Cost of Goods Sold)</Text>
        </View>
        <Text style={styles.h1}>{ctx.header.clientName}</Text>
        <Text style={styles.muted}>
          Cost of Goods Sold · Tax Year {ctx.header.year}
        </Text>

        <FormLine num="1" label="Inventory at beginning of year" amount={0} />
        <FormLine num="2" label="Purchases" amount={purchases} />
        <FormLine num="3" label="Cost of labor" amount={0} />
        <FormLine num="4" label="Additional §263A costs" amount={0} />
        <FormLine num="5" label="Other costs (attach schedule)" amount={0} />
        <FormLine num="6" label="Total (sum lines 1-5)" amount={purchases} />
        <FormLine num="7" label="Inventory at end of year" amount={0} />
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>8</Text>
          <Text style={styles.lineLabel}>Cost of goods sold (line 6 minus line 7)</Text>
          <Text style={styles.lineAmount}>{fmtUSD(totalCogs)}</Text>
        </View>

        <Text style={styles.h2}>Inventory method (Part II)</Text>
        <Text style={styles.small}>9a ☐ Cost  9b ☐ Lower of cost or market  9c ☐ Other</Text>
        <Text style={styles.small}>9d Method change in this year? ☐ Yes ☐ No</Text>
        <Text style={styles.small}>
          9e ☐ §263A applies (taxpayers with avg gross receipts ≥ $30M for prior 3 years).
          Below threshold per Rev. Proc. 2018-40 small-business exemption.
        </Text>

        <Text style={styles.authority}>
          Authority: IRC §263A; Reg §1.471-1; Form 1125-A Instructions Rev. 2025.
          Cash-method dropshipping with no physical inventory: BOY/EOY inventory
          treated as $0; total purchases = total COGS.
        </Text>

        <PageFooter header={ctx.header} formId="Form 1125-A" />
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Form 4562 — Depreciation and Amortization
// ─────────────────────────────────────────────────────────────────────────

function Form4562Doc({ ctx }: { ctx: ScheduleContext }) {
  // We surface the depreciation totals computed from ledger classifications.
  // Asset-level detail is captured via PriorYearContext.depreciationSchedule
  // when assets are entered; this worksheet lists totals and references
  // §179 / §168(k) elections.
  const depreciation =
    (ctx.totalsByLine.get("Line 13 Depreciation") ?? 0) +
    (ctx.totalsByLine.get("14 Depreciation") ?? 0) +
    (ctx.totalsByLine.get("16a Depreciation") ?? 0) +
    (ctx.totalsByLine.get("20 Depreciation") ?? 0)

  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>FORM 4562 WORKSHEET — TaxLens (Depreciation and Amortization)</Text>
        </View>
        <Text style={styles.h1}>{ctx.header.clientName}</Text>
        <Text style={styles.muted}>
          Depreciation and Amortization · Tax Year {ctx.header.year}
        </Text>

        <Text style={styles.h2}>Part I — Election To Expense Certain Property Under §179</Text>
        <FormLine num="1" label="Maximum amount (TY2025 cap)" amount={1_250_000} />
        <FormLine num="2" label="Total cost of §179 property placed in service" amount={null} />
        <FormLine num="3" label="Threshold cost (TY2025)" amount={3_130_000} />
        <FormLine num="4" label="Reduction in limitation (line 2 − line 3, ≥ 0)" amount={null} />
        <FormLine num="5" label="§179 dollar limitation (line 1 − line 4)" amount={null} />

        <Text style={styles.h2}>Part II — Special Depreciation Allowance</Text>
        <FormLine
          num="14"
          label="Special depreciation allowance (§168(k) bonus 40% for TY2025)"
          amount={null}
        />

        <Text style={styles.h2}>Part III — MACRS Depreciation</Text>
        <Text style={styles.small}>
          Listed by recovery class (3-yr / 5-yr / 7-yr / 10-yr / 15-yr / 20-yr / 27.5-yr res. rental / 39-yr non-res).
          Per-asset detail in attached depreciation schedule.
        </Text>

        <Text style={styles.h2}>Summary</Text>
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>22</Text>
          <Text style={styles.lineLabel}>Total depreciation (lines 12 + 14-17 + 19 + 21)</Text>
          <Text style={styles.lineAmount}>{fmtUSD(depreciation)}</Text>
        </View>

        <Text style={styles.authority}>
          Authority: IRC §167, §168, §179; Form 4562 Instructions Rev. 2025.
          TY2025 §168(k) bonus = 40% (post-OBBBA phase-down: 60% / 40% / 20% / 0%
          for 2024-2027). §179 cap $1,250,000 with phaseout starting at
          $3,130,000 (Rev. Proc. 2024-40).
        </Text>

        <PageFooter header={ctx.header} formId="Form 4562" />
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Schedule M-1 — Reconciliation of Income (Loss) per Books With Income per Return
// ─────────────────────────────────────────────────────────────────────────

function ScheduleM1Doc({ ctx, formContext }: { ctx: ScheduleContext; formContext: "1120-S" | "1065" | "1120" }) {
  // Without separate book records we treat book-net = tax-net (cash method
  // taxpayer with no GAAP adjustments). Gives the CPA a clean starting point
  // to add: tax-exempt income, expenses on books not on tax (e.g. 50% meals
  // disallowance already applied), depreciation differences, etc.
  const bookNet = ctx.netProfit
  const taxNet = ctx.netProfit
  const m1Diff = taxNet - bookNet
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>
            SCHEDULE M-1 ({formContext}) WORKSHEET — TaxLens (Books vs. Tax Return)
          </Text>
        </View>
        <Text style={styles.h1}>{ctx.header.clientName}</Text>
        <Text style={styles.muted}>
          Reconciliation of Income (Loss) per Books With Income per Return · TY {ctx.header.year}
        </Text>

        <FormLine num="1" label="Net income (loss) per books" amount={bookNet} />
        <FormLine num="2" label="Federal income tax per books" amount={null} />
        <FormLine num="3" label="Excess of capital losses over capital gains" amount={null} />
        <FormLine num="4" label="Income subject to tax not recorded on books" amount={null} />
        <FormLine num="5" label="Expenses recorded on books not on return (e.g. 50% meals)" amount={null} />
        <FormLine num="6" label="Add lines 1-5" amount={bookNet} />
        <FormLine num="7" label="Income on books not on return (e.g. tax-exempt interest)" amount={null} />
        <FormLine num="8" label="Deductions on return not on books (e.g. §179)" amount={null} />
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>9</Text>
          <Text style={styles.lineLabel}>Income per return (line 6 − line 7 − line 8)</Text>
          <Text style={styles.lineAmount}>{fmtUSD(taxNet)}</Text>
        </View>
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>—</Text>
          <Text style={styles.lineLabel}>M-1 reconciliation difference</Text>
          <Text style={styles.lineAmount}>{fmtUSD(m1Diff)}</Text>
        </View>

        <Text style={styles.authority}>
          Authority: Form {formContext} Instructions Rev. 2025; Schedule B questions 11a-11c.
          Book-tax difference is $0 for cash-method taxpayers without GAAP
          adjustments. Add manual adjustments for 50% meals disallowance, depreciation
          method differences, charitable contribution timing, etc.
        </Text>

        <PageFooter header={ctx.header} formId={`Schedule M-1 (${formContext})`} />
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Schedule M-2 — Capital roll-forward (S-Corp AAA / Partnership capital)
// ─────────────────────────────────────────────────────────────────────────

interface M2OwnerRow {
  name: string
  ownershipPct: number
  capitalContribution: number
  distributions: number
  stockBasis: number
  partnerCapitalStart: number
}

function ScheduleM2Doc({
  ctx,
  formContext,
  owners,
}: {
  ctx: ScheduleContext
  formContext: "1120-S" | "1065"
  owners: M2OwnerRow[]
}) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>
            SCHEDULE M-2 ({formContext}) WORKSHEET — TaxLens (Capital roll-forward)
          </Text>
        </View>
        <Text style={styles.h1}>{ctx.header.clientName}</Text>
        <Text style={styles.muted}>
          {formContext === "1120-S"
            ? "Accumulated Adjustments Account (AAA) + per-shareholder capital"
            : "Partners' Capital Accounts (§704(b))"}{" "}
          · TY {ctx.header.year}
        </Text>

        {owners.length === 0 ? (
          <View style={[styles.line, { borderColor: "#f59e0b", backgroundColor: "#fef3c7", padding: 8, marginTop: 12 }]}>
            <Text style={{ fontSize: 10, fontFamily: "Helvetica-Bold" }}>
              No owner records configured
            </Text>
            <Text style={{ fontSize: 9, marginTop: 4 }}>
              Add owners on /years/{ctx.header.year}/owners with capital
              contributions, distributions, and (for S-Corp) stock basis. M-2
              roll-forward cannot be computed without owner records.
            </Text>
          </View>
        ) : (
          <>
            <Text style={styles.h2}>Per-owner roll-forward</Text>
            {owners.map((o, i) => {
              const start = formContext === "1120-S" ? o.stockBasis : o.partnerCapitalStart
              const contribution = o.capitalContribution
              const allocated = ctx.netProfit * (o.ownershipPct / 100)
              const distrib = o.distributions
              const ending = start + contribution + allocated - distrib
              return (
                <View key={i} style={{ marginBottom: 10, padding: 8, border: "1 solid #e5e7eb", borderRadius: 4 }}>
                  <Text style={{ fontFamily: "Helvetica-Bold", fontSize: 10 }}>
                    {o.name} ({o.ownershipPct.toFixed(2)}%)
                  </Text>
                  <View style={styles.line}>
                    <Text style={styles.lineLabel}>Beginning balance</Text>
                    <Text style={styles.lineAmount}>{fmtUSD(start)}</Text>
                  </View>
                  <View style={styles.line}>
                    <Text style={styles.lineLabel}>+ Capital contribution this year</Text>
                    <Text style={styles.lineAmount}>{fmtUSD(contribution)}</Text>
                  </View>
                  <View style={styles.line}>
                    <Text style={styles.lineLabel}>+ Allocated income / (loss)</Text>
                    <Text style={styles.lineAmount}>{fmtUSD(allocated)}</Text>
                  </View>
                  <View style={styles.line}>
                    <Text style={styles.lineLabel}>− Distributions</Text>
                    <Text style={styles.lineAmount}>{fmtUSD(distrib)}</Text>
                  </View>
                  <View style={styles.totalRow}>
                    <Text style={styles.lineLabel}>Ending balance</Text>
                    <Text style={styles.lineAmount}>{fmtUSD(ending)}</Text>
                  </View>
                </View>
              )
            })}
          </>
        )}

        <Text style={styles.authority}>
          Authority: {formContext === "1120-S"
            ? "IRC §1368; Reg §1.1368-2; Form 1120-S Schedule M-2 Instructions Rev. 2025"
            : "IRC §704; Reg §1.704-1; Form 1065 Schedule M-2 Instructions Rev. 2025"}.
        </Text>

        <PageFooter header={ctx.header} formId={`Schedule M-2 (${formContext})`} />
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Schedule L — Balance Sheet per Books
// ─────────────────────────────────────────────────────────────────────────

function ScheduleLDoc({
  ctx,
  formContext,
}: {
  ctx: ScheduleContext
  formContext: "1120-S" | "1065" | "1120"
}) {
  // Without a proper trial balance we surface the framework + leave the
  // line-amount fields as placeholders. CPA fills in BOY / EOY values from
  // bookkeeping records.
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>SCHEDULE L ({formContext}) WORKSHEET — TaxLens (Balance Sheet per Books)</Text>
        </View>
        <Text style={styles.h1}>{ctx.header.clientName}</Text>
        <Text style={styles.muted}>Balance Sheet per Books · TY {ctx.header.year}</Text>

        <Text style={styles.h2}>Assets</Text>
        <FormLine num="1" label="Cash" amount={null} />
        <FormLine num="2a" label="Trade notes and accounts receivable" amount={null} />
        <FormLine num="3" label="Inventories" amount={null} />
        <FormLine num="6" label="Other current assets" amount={null} />
        <FormLine num="10a" label="Buildings and other depreciable assets" amount={null} />
        <FormLine num="13" label="Other assets" amount={null} />
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>15</Text>
          <Text style={styles.lineLabel}>Total assets</Text>
          <Text style={styles.lineAmount}>—</Text>
        </View>

        <Text style={styles.h2}>Liabilities and Capital</Text>
        <FormLine num="16" label="Accounts payable" amount={null} />
        <FormLine num="17" label="Mortgages, notes, bonds payable < 1 year" amount={null} />
        <FormLine num="18" label="Other current liabilities" amount={null} />
        <FormLine num="20" label="Mortgages, notes, bonds payable ≥ 1 year" amount={null} />
        <FormLine num="22" label="Capital stock / Partners' capital / Member equity" amount={null} />
        <FormLine num="24" label="Retained earnings (1120-S: AAA)" amount={null} />
        <View style={styles.totalRow}>
          <Text style={styles.lineNum}>27</Text>
          <Text style={styles.lineLabel}>Total liabilities and capital</Text>
          <Text style={styles.lineAmount}>—</Text>
        </View>

        <Text style={styles.authority}>
          Authority: Form {formContext} Instructions Rev. 2025. TY2025 threshold:
          required when gross receipts ≥ $250,000 AND total assets ≥ $250,000
          (1120-S, 1065). Always required for 1120 (C-Corp).
        </Text>

        <PageFooter header={ctx.header} formId={`Schedule L (${formContext})`} />
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Public builders
// ─────────────────────────────────────────────────────────────────────────

async function pdfToBuffer(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function buildScheduleSePdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadScheduleContext(taxYearId)
  const stream = await pdf(<ScheduleSeDoc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildForm8995Pdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadScheduleContext(taxYearId)
  const stream = await pdf(<Form8995Doc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildForm1125APdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadScheduleContext(taxYearId)
  const stream = await pdf(<Form1125ADoc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildForm4562Pdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadScheduleContext(taxYearId)
  const stream = await pdf(<Form4562Doc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildScheduleM1Pdf(
  taxYearId: string,
  formContext: "1120-S" | "1065" | "1120",
): Promise<Buffer> {
  const ctx = await loadScheduleContext(taxYearId)
  const stream = await pdf(<ScheduleM1Doc ctx={ctx} formContext={formContext} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildScheduleM2Pdf(
  taxYearId: string,
  formContext: "1120-S" | "1065",
): Promise<Buffer> {
  const ctx = await loadScheduleContext(taxYearId)
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { id: true },
  })
  const ownerRows = profile
    ? await prisma.owner.findMany({
        where: { profileId: profile.id, isActive: true },
        select: {
          name: true,
          ownershipPct: true,
          capitalContribution: true,
          distributions: true,
          stockBasis: true,
          partnerCapitalStart: true,
        },
      })
    : []
  const owners: M2OwnerRow[] = ownerRows.map((o) => ({
    name: o.name,
    ownershipPct: Number(o.ownershipPct.toString()),
    capitalContribution: Number(o.capitalContribution?.toString() ?? "0"),
    distributions: Number(o.distributions?.toString() ?? "0"),
    stockBasis: Number(o.stockBasis?.toString() ?? "0"),
    partnerCapitalStart: Number(o.partnerCapitalStart?.toString() ?? "0"),
  }))
  const stream = await pdf(
    <ScheduleM2Doc ctx={ctx} formContext={formContext} owners={owners} />,
  ).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildScheduleLPdf(
  taxYearId: string,
  formContext: "1120-S" | "1065" | "1120",
): Promise<Buffer> {
  const ctx = await loadScheduleContext(taxYearId)
  const stream = await pdf(<ScheduleLDoc ctx={ctx} formContext={formContext} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}
