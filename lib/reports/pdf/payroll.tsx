/**
 * Payroll-form PDF skeletons — W-2 / W-3 (employee wage), Form 941 (quarterly
 * federal tax), Form 940 (FUTA annual), Form 1125-E (officer compensation).
 *
 * These render as proper IRS-line-numbered worksheets with placeholder values
 * the CPA fills in. Full payroll integration (importing from Gusto / ADP /
 * QuickBooks Payroll) is a future system; until then the worksheets give a
 * defensible printable record.
 *
 * Authority: IRC §3402, §3102, §3301, §6051. Form revisions per 2025
 * IRS instructions.
 */

import React from "react"
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer"
import { prisma } from "@/lib/db"

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  header: {
    backgroundColor: "#0a1f44",
    color: "#fff",
    padding: 7,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 10,
  },
  h1: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 3 },
  h2: { fontSize: 11, fontFamily: "Helvetica-Bold", marginTop: 12, marginBottom: 4 },
  muted: { fontSize: 9, color: "#555" },
  small: { fontSize: 8, color: "#666" },
  block: { border: "1 solid #444", padding: 6, marginBottom: 4 },
  blockTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, color: "#444", marginBottom: 2 },
  boxRow: { flexDirection: "row", border: "1 solid #444", padding: 4, marginBottom: 2 },
  boxNum: { width: 26, fontFamily: "Helvetica-Bold" },
  boxLabel: { flex: 1 },
  boxAmount: { width: 100, textAlign: "right", fontFamily: "Helvetica-Bold" },
  authority: { fontSize: 8, color: "#666", marginTop: 8, fontStyle: "italic" },
})

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

interface PayrollContext {
  year: number
  employerName: string
  employerEin: string
}

async function loadPayrollContext(taxYearId: string): Promise<PayrollContext> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: { user: { select: { name: true, email: true } } },
  })
  return {
    year: ty.year,
    employerName: ty.user.name ?? ty.user.email,
    employerEin: "[VERIFY]",
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Form W-2 (per employee) + W-3 (transmittal)
// ─────────────────────────────────────────────────────────────────────────

function FormW2W3Doc({ ctx }: { ctx: PayrollContext }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>FORM W-2 / W-3 WORKSHEET — TaxLens (Wage and Tax Statement)</Text>
        </View>
        <Text style={styles.h1}>{ctx.employerName}</Text>
        <Text style={styles.muted}>
          Employee Wage Statements · Tax Year {ctx.year} · Employer EIN: {ctx.employerEin}
        </Text>

        <Text style={styles.h2}>Per-Employee W-2 Worksheet</Text>
        <View style={styles.block}>
          <Text style={styles.blockTitle}>Employee 1 — fill one block per person</Text>
          <View style={styles.boxRow}>
            <Text style={styles.boxLabel}>Box a — Employee SSN</Text>
            <Text style={styles.boxAmount}>[VERIFY]</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxLabel}>Box e — Employee name</Text>
            <Text style={styles.boxAmount}>[VERIFY]</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>1</Text>
            <Text style={styles.boxLabel}>Wages, tips, other compensation</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>2</Text>
            <Text style={styles.boxLabel}>Federal income tax withheld</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>3</Text>
            <Text style={styles.boxLabel}>Social Security wages (capped at TY2025 wage base $176,100)</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>4</Text>
            <Text style={styles.boxLabel}>Social Security tax withheld (6.2% of Box 3)</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>5</Text>
            <Text style={styles.boxLabel}>Medicare wages and tips (no cap)</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>6</Text>
            <Text style={styles.boxLabel}>Medicare tax withheld (1.45% of Box 5; +0.9% over $200K)</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>12</Text>
            <Text style={styles.boxLabel}>Codes (D=401k, DD=health, etc.) + amounts</Text>
            <Text style={styles.boxAmount}>—</Text>
          </View>
        </View>

        <Text style={styles.h2}>W-3 Transmittal (totals across all employees)</Text>
        <View style={styles.block}>
          <View style={styles.boxRow}>
            <Text style={styles.boxLabel}>Total Box 1 wages</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxLabel}>Total Box 2 federal withholding</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxLabel}>Total Box 3 SS wages</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxLabel}>Total Box 5 Medicare wages</Text>
            <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxLabel}>Number of W-2s submitted</Text>
            <Text style={styles.boxAmount}>0</Text>
          </View>
        </View>

        <Text style={styles.authority}>
          Authority: IRC §6051; W-2/W-3 Instructions Rev. 2025. Filing deadline: January 31 of
          following year for both SSA submission AND employee delivery.
        </Text>
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Form 941 — Employer's Quarterly Federal Tax Return
// ─────────────────────────────────────────────────────────────────────────

function Form941Doc({ ctx, quarter }: { ctx: PayrollContext; quarter: number }) {
  const quarterLabel = `Q${quarter} ${ctx.year}`
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>FORM 941 WORKSHEET — TaxLens ({quarterLabel})</Text>
        </View>
        <Text style={styles.h1}>{ctx.employerName}</Text>
        <Text style={styles.muted}>
          Employer&apos;s Quarterly Federal Tax Return · {quarterLabel} · EIN: {ctx.employerEin}
        </Text>

        <Text style={styles.h2}>Part 1 — Quarterly figures</Text>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>1</Text>
          <Text style={styles.boxLabel}>Number of employees who received wages this quarter</Text>
          <Text style={styles.boxAmount}>0</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>2</Text>
          <Text style={styles.boxLabel}>Wages, tips, other compensation</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>3</Text>
          <Text style={styles.boxLabel}>Federal income tax withheld</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>5a</Text>
          <Text style={styles.boxLabel}>Taxable Social Security wages × 12.4%</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>5c</Text>
          <Text style={styles.boxLabel}>Taxable Medicare wages × 2.9%</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>5d</Text>
          <Text style={styles.boxLabel}>Additional Medicare 0.9% on wages over $200K</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>6</Text>
          <Text style={styles.boxLabel}>Total taxes before adjustments</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>10</Text>
          <Text style={styles.boxLabel}>Total taxes after adjustments</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>12</Text>
          <Text style={styles.boxLabel}>Total taxes after credits</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>13</Text>
          <Text style={styles.boxLabel}>Total deposits for the quarter</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>

        <Text style={styles.authority}>
          Authority: IRC §3402, §3102; Form 941 Instructions Rev. March 2025. Quarterly due
          dates: April 30, July 31, October 31, January 31.
        </Text>
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Form 940 — FUTA Annual Return
// ─────────────────────────────────────────────────────────────────────────

function Form940Doc({ ctx }: { ctx: PayrollContext }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>FORM 940 WORKSHEET — TaxLens (FUTA Annual)</Text>
        </View>
        <Text style={styles.h1}>{ctx.employerName}</Text>
        <Text style={styles.muted}>
          Employer&apos;s Annual Federal Unemployment (FUTA) Tax Return · TY {ctx.year} · EIN:{" "}
          {ctx.employerEin}
        </Text>

        <Text style={styles.h2}>Part 2 — FUTA tax before adjustments</Text>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>3</Text>
          <Text style={styles.boxLabel}>Total payments to all employees</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>4</Text>
          <Text style={styles.boxLabel}>Payments exempt from FUTA tax</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>5</Text>
          <Text style={styles.boxLabel}>Total payments above first $7,000 per employee</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>7</Text>
          <Text style={styles.boxLabel}>Total taxable FUTA wages</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>8</Text>
          <Text style={styles.boxLabel}>FUTA tax before adjustments (line 7 × 0.6%)</Text>
          <Text style={styles.boxAmount}>{fmtUSD(0)}</Text>
        </View>

        <Text style={styles.authority}>
          Authority: IRC §3301; Form 940 Instructions Rev. 2025. Standard FUTA rate: 6.0%
          minus 5.4% credit for full state UI payment = 0.6% effective. Annual return due
          January 31 of following year (or February 10 if all deposits made on time).
        </Text>
      </Page>
    </Document>
  )
}

// ─────────────────────────────────────────────────────────────────────────
// Form 1125-E — Compensation of Officers (corp w/ receipts ≥ $500K)
// ─────────────────────────────────────────────────────────────────────────

interface F1125EOfficer {
  name: string
  ssnLast4: string | null
  ownershipPct: number
  w2Wages: number
}

function Form1125EDoc({
  ctx,
  officers,
}: {
  ctx: PayrollContext
  officers: F1125EOfficer[]
}) {
  const totalComp = officers.reduce((s, o) => s + o.w2Wages, 0)
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.header}>
          <Text>FORM 1125-E WORKSHEET — TaxLens (Compensation of Officers)</Text>
        </View>
        <Text style={styles.h1}>{ctx.employerName}</Text>
        <Text style={styles.muted}>
          Compensation of Officers · TY {ctx.year} · EIN: {ctx.employerEin}
        </Text>

        <Text style={styles.h2}>Per-officer compensation</Text>
        {officers.length === 0 ? (
          <Text style={styles.small}>No officers configured. Add Owner records (kind=OFFICER) on /years/{ctx.year}/owners.</Text>
        ) : (
          officers.map((o, i) => (
            <View key={i} style={styles.block}>
              <Text style={styles.blockTitle}>Officer {i + 1}</Text>
              <View style={styles.boxRow}>
                <Text style={styles.boxNum}>(a)</Text>
                <Text style={styles.boxLabel}>Name of officer</Text>
                <Text style={styles.boxAmount}>{o.name}</Text>
              </View>
              <View style={styles.boxRow}>
                <Text style={styles.boxNum}>(b)</Text>
                <Text style={styles.boxLabel}>Social Security number</Text>
                <Text style={styles.boxAmount}>
                  {o.ssnLast4 ? `***-**-${o.ssnLast4}` : "[VERIFY]"}
                </Text>
              </View>
              <View style={styles.boxRow}>
                <Text style={styles.boxNum}>(c)</Text>
                <Text style={styles.boxLabel}>% of time devoted to business</Text>
                <Text style={styles.boxAmount}>[VERIFY]</Text>
              </View>
              <View style={styles.boxRow}>
                <Text style={styles.boxNum}>(d)</Text>
                <Text style={styles.boxLabel}>% of stock owned (common)</Text>
                <Text style={styles.boxAmount}>{o.ownershipPct.toFixed(2)}%</Text>
              </View>
              <View style={styles.boxRow}>
                <Text style={styles.boxNum}>(f)</Text>
                <Text style={styles.boxLabel}>Amount of compensation</Text>
                <Text style={styles.boxAmount}>{fmtUSD(o.w2Wages)}</Text>
              </View>
            </View>
          ))
        )}
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>2</Text>
          <Text style={styles.boxLabel}>Total compensation of officers — flows to corporate return</Text>
          <Text style={styles.boxAmount}>{fmtUSD(totalComp)}</Text>
        </View>

        <Text style={styles.authority}>
          Authority: Form 1125-E Instructions Rev. 2025. Required when total receipts ≥
          $500,000 (1120-S, 1120). For S-Corp officers, reasonable comp per Rev. Rul. 59-221
          and Watson v. Commissioner (8th Cir. 2012).
        </Text>
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

export async function buildFormW2W3Pdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadPayrollContext(taxYearId)
  const stream = await pdf(<FormW2W3Doc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildForm941Pdf(taxYearId: string, quarter: number): Promise<Buffer> {
  const ctx = await loadPayrollContext(taxYearId)
  const stream = await pdf(<Form941Doc ctx={ctx} quarter={quarter} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildForm940Pdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadPayrollContext(taxYearId)
  const stream = await pdf(<Form940Doc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export async function buildForm1125EPdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadPayrollContext(taxYearId)
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { id: true },
  })
  const officers = profile
    ? await prisma.owner.findMany({
        where: { profileId: profile.id, isActive: true, kind: "OFFICER" },
        select: { name: true, ssnLast4: true, ownershipPct: true, w2Wages: true },
      })
    : []
  const officerRows: F1125EOfficer[] = officers.map((o) => ({
    name: o.name,
    ssnLast4: o.ssnLast4,
    ownershipPct: Number(o.ownershipPct.toString()),
    w2Wages: Number(o.w2Wages?.toString() ?? "0"),
  }))
  const stream = await pdf(<Form1125EDoc ctx={ctx} officers={officerRows} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}
