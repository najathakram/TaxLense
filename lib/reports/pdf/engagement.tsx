/**
 * Engagement letter + Form 8879 PDF builders.
 *
 * Engagement letter = the AICPA/CIRC230-compliant CPA↔client agreement
 * defining scope, fees, responsibilities. Drafted before lock.
 *
 * Form 8879 = IRS e-file authorization (Pub 1345). Auto-populated from
 * the locked Schedule C / 1120-S / 1065 / 1120 totals; signed by taxpayer
 * before the ERO transmits.
 *
 * Both are stored as Document rows (category=ENGAGEMENT_LEGAL) once
 * signed. The unsigned drafts are generated on demand from this module.
 */

import React from "react"
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer"
import { prisma } from "@/lib/db"
import { inYearWindow } from "@/lib/queries/yearWindow"

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 10, fontFamily: "Helvetica", color: "#111" },
  h1: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  h2: { fontSize: 12, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  p: { lineHeight: 1.4, marginBottom: 8 },
  small: { fontSize: 8, color: "#555" },
  signatureBlock: {
    marginTop: 32,
    paddingTop: 12,
    borderTop: "1 solid #444",
  },
  signLine: {
    flexDirection: "row",
    marginBottom: 14,
  },
  signLabel: { width: 120, fontFamily: "Helvetica-Bold" },
  signField: {
    flex: 1,
    borderBottom: "1 solid #444",
    paddingBottom: 2,
    minHeight: 16,
  },
  formHeaderBar: {
    backgroundColor: "#0a1f44",
    color: "#fff",
    padding: 8,
    fontFamily: "Helvetica-Bold",
    fontSize: 12,
    marginBottom: 12,
  },
  block: {
    border: "1 solid #444",
    padding: 8,
    marginBottom: 6,
  },
  blockTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    marginBottom: 3,
    color: "#333",
  },
  boxRow: {
    flexDirection: "row",
    border: "1 solid #444",
    padding: 5,
    marginBottom: 2,
  },
  boxNum: { width: 22, fontFamily: "Helvetica-Bold" },
  boxLabel: { flex: 1 },
  boxAmount: { width: 100, textAlign: "right", fontFamily: "Helvetica-Bold" },
})

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

// ─────────────────────────────────────────────────────────────────────────
// Engagement Letter
// ─────────────────────────────────────────────────────────────────────────

interface EngagementContext {
  year: number
  cpaName: string
  cpaEmail: string
  clientName: string
  clientEmail: string
  bodyMarkdown: string
}

function EngagementLetterDoc({ ctx }: { ctx: EngagementContext }) {
  // Render the markdown body as plain paragraphs (preserving paragraph breaks)
  const paragraphs = ctx.bodyMarkdown.split(/\n\n+/).map((p) => p.trim()).filter(Boolean)
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.h1}>Engagement Letter — Tax Year {ctx.year}</Text>
        <Text style={styles.small}>
          Between {ctx.cpaName} (Preparer) and {ctx.clientName} (Client)
        </Text>

        {paragraphs.map((p, i) => (
          <Text key={i} style={styles.p}>
            {p}
          </Text>
        ))}

        <View style={styles.signatureBlock}>
          <Text style={styles.h2}>Signatures</Text>
          <View style={styles.signLine}>
            <Text style={styles.signLabel}>Preparer ({ctx.cpaName})</Text>
            <Text style={styles.signField}> </Text>
          </View>
          <View style={styles.signLine}>
            <Text style={styles.signLabel}>Date</Text>
            <Text style={styles.signField}> </Text>
          </View>
          <View style={styles.signLine}>
            <Text style={styles.signLabel}>Client ({ctx.clientName})</Text>
            <Text style={styles.signField}> </Text>
          </View>
          <View style={styles.signLine}>
            <Text style={styles.signLabel}>Date</Text>
            <Text style={styles.signField}> </Text>
          </View>
        </View>

        <Text style={styles.small}>
          Authority: AICPA SSARS / Circular 230 §10.30. This engagement letter
          governs the preparation services provided for tax year {ctx.year}.
        </Text>
      </Page>
    </Document>
  )
}

const DEFAULT_ENGAGEMENT_BODY = (year: number, clientName: string) => `Dear ${clientName},

This letter confirms our engagement to prepare your federal and applicable state
income tax returns for tax year ${year}. The scope of our services includes:

1. Preparation of the relevant federal income tax return (Schedule C / Form
1120-S / Form 1065 / Form 1120) and any required supplementary schedules
identified by the entity-aware Final Dump panel in TaxLens.

2. Preparation of any required information returns (Form 1099-NEC / 1099-MISC /
W-2 / W-3) where the underlying classified ledger meets the IRS reporting
thresholds.

3. Reconciliation of bank, credit-card, and money-mover statements to the
locked transaction ledger; generation of the audit defense packet under IRC
§6001 record-keeping rules.

Our fee for this engagement is to be agreed separately. Out-of-scope items
(amended prior-year returns, IRS audit representation, state franchise filings
beyond Texas PIR, payroll runs) are billable at our standard hourly rate.

You agree to provide complete and accurate source statements for every account
that touched the business in ${year}, and to confirm any inactive-month
attestations recorded on the Coverage page. We agree to maintain confidentiality
under §7216 / Reg §301.7216-3 and to apply due-diligence standards under
Circular 230 §10.34.

Either party may terminate this engagement on written notice. Work performed
to that point remains billable.

Sincerely,
`

async function loadEngagementContext(taxYearId: string): Promise<EngagementContext> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: {
      user: { select: { name: true, email: true } },
      engagementLetter: true,
    },
  })
  const clientName = ty.user.name ?? ty.user.email
  const existing = ty.engagementLetter
  const cpaName = existing
    ? (
        await prisma.user.findUnique({ where: { id: existing.cpaUserId }, select: { name: true, email: true } })
      )?.name ?? "Preparer"
    : "Preparer"
  const cpaEmail = existing
    ? (
        await prisma.user.findUnique({ where: { id: existing.cpaUserId }, select: { email: true } })
      )?.email ?? ""
    : ""

  return {
    year: ty.year,
    cpaName,
    cpaEmail,
    clientName,
    clientEmail: ty.user.email,
    bodyMarkdown: existing?.bodyMarkdown ?? DEFAULT_ENGAGEMENT_BODY(ty.year, clientName),
  }
}

async function pdfToBuffer(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function buildEngagementLetterPdf(taxYearId: string): Promise<Buffer> {
  const ctx = await loadEngagementContext(taxYearId)
  const stream = await pdf(<EngagementLetterDoc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

export const ENGAGEMENT_DEFAULT_BODY = DEFAULT_ENGAGEMENT_BODY

// ─────────────────────────────────────────────────────────────────────────
// Form 8879 — IRS e-file Signature Authorization
// ─────────────────────────────────────────────────────────────────────────

interface F8879Context {
  year: number
  taxpayerName: string
  taxpayerEmail: string
  totalIncome: number
  taxableIncome: number
  totalTax: number
  refundOrDue: number
  eroPin: string
  taxpayerPin: string
  spousePin: string
  filerSsn: string
}

function Form8879Doc({ ctx }: { ctx: F8879Context }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.formHeaderBar}>
          <Text>FORM 8879 — IRS e-file Signature Authorization</Text>
        </View>
        <Text style={styles.h1}>Form 8879 — TY {ctx.year}</Text>
        <Text style={styles.small}>
          OMB No. 1545-0074 · For use with Forms 1040, 1040-SR, 1040-NR, 1040-PR, and 1040-SS
        </Text>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Taxpayer Information</Text>
          <Text>{ctx.taxpayerName}</Text>
          <Text>{ctx.taxpayerEmail}</Text>
          <Text style={{ marginTop: 3 }}>Taxpayer SSN: {ctx.filerSsn || "[VERIFY]"}</Text>
        </View>

        <Text style={styles.h2}>Part I — Tax Return Information (whole dollars only)</Text>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>1</Text>
          <Text style={styles.boxLabel}>Adjusted gross income (Form 1040, line 11)</Text>
          <Text style={styles.boxAmount}>{fmtUSD(ctx.totalIncome)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>2</Text>
          <Text style={styles.boxLabel}>Total tax (Form 1040, line 24)</Text>
          <Text style={styles.boxAmount}>{fmtUSD(ctx.totalTax)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>3</Text>
          <Text style={styles.boxLabel}>Federal income tax withheld (Form 1040, line 25)</Text>
          <Text style={styles.boxAmount}>—</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>4</Text>
          <Text style={styles.boxLabel}>Refund (Form 1040, line 34) OR Amount you owe (line 37)</Text>
          <Text style={styles.boxAmount}>{fmtUSD(ctx.refundOrDue)}</Text>
        </View>

        <Text style={styles.h2}>Part II — Taxpayer Declaration and Signature Authorization</Text>
        <Text style={styles.p}>
          Under penalties of perjury, I declare that I have examined a copy of my electronic
          income tax return and accompanying schedules and statements for the tax year
          ending December 31, {ctx.year}, and to the best of my knowledge and belief, they
          are true, correct, and complete. I further declare that the amounts in Part I above
          agree with the amounts on the corresponding lines of my electronic income tax return.
          I consent to allow my electronic return originator (ERO), transmitter, or
          intermediate service provider to send my return to the IRS.
        </Text>

        <Text style={styles.h2}>Taxpayer self-select PIN</Text>
        <View style={{ flexDirection: "row", gap: 16, marginBottom: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={styles.small}>5-digit PIN (cannot be all zeros):</Text>
            <Text style={{ ...styles.signField, padding: 4 }}>{ctx.taxpayerPin || "_____"}</Text>
          </View>
          {ctx.spousePin !== undefined && (
            <View style={{ flex: 1 }}>
              <Text style={styles.small}>Spouse 5-digit PIN (if joint):</Text>
              <Text style={{ ...styles.signField, padding: 4 }}>{ctx.spousePin || "_____"}</Text>
            </View>
          )}
        </View>

        <View style={styles.signLine}>
          <Text style={styles.signLabel}>Taxpayer signature</Text>
          <Text style={styles.signField}> </Text>
        </View>
        <View style={styles.signLine}>
          <Text style={styles.signLabel}>Date</Text>
          <Text style={styles.signField}> </Text>
        </View>

        <Text style={styles.h2}>Part III — Certification and Authentication (ERO use)</Text>
        <View style={styles.signLine}>
          <Text style={styles.signLabel}>ERO PIN (5-digit)</Text>
          <Text style={styles.signField}>{ctx.eroPin || "_____"}</Text>
        </View>
        <View style={styles.signLine}>
          <Text style={styles.signLabel}>ERO signature</Text>
          <Text style={styles.signField}> </Text>
        </View>

        <Text style={styles.small}>
          Authority: IRC §7216; Pub 1345 §1.3 — ERO must obtain signed Form 8879 from the
          taxpayer BEFORE transmitting the return. Retain in records for 3 years per
          Pub 1345 §6.04.
        </Text>
      </Page>
    </Document>
  )
}

async function load8879Context(taxYearId: string): Promise<F8879Context> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: {
      user: { select: { name: true, email: true } },
      form8879: true,
    },
  })

  // Aggregate Schedule C net income from the locked ledger as a proxy for
  // total income — Form 8879 Part I shows the BIG numbers from the 1040.
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, ...inYearWindow(ty.year) },
    select: {
      amountNormalized: true,
      classifications: { where: { isCurrent: true }, select: { code: true, businessPct: true }, take: 1 },
    },
  })
  let grossReceipts = 0
  let totalDeductible = 0
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const amt = Math.abs(Number(t.amountNormalized.toString()))
    if (c.code === "BIZ_INCOME") grossReceipts += amt
    else if (
      ["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100"].includes(c.code)
    ) {
      const mult = c.code === "MEALS_50" ? 0.5 : 1
      totalDeductible += amt * (c.businessPct / 100) * mult
    }
  }
  const totalIncome = grossReceipts - totalDeductible
  // Conservative tax estimate at 25% combined federal+SE+state
  const totalTax = Math.max(0, totalIncome) * 0.25
  const refundOrDue = -totalTax

  const f8879 = ty.form8879
  return {
    year: ty.year,
    taxpayerName: ty.user.name ?? ty.user.email,
    taxpayerEmail: ty.user.email,
    totalIncome,
    taxableIncome: totalIncome,
    totalTax,
    refundOrDue,
    eroPin: f8879?.eroPin ?? "",
    taxpayerPin: f8879?.taxpayerPin ?? "",
    spousePin: f8879?.spousePin ?? "",
    filerSsn: "",
  }
}

export async function buildForm8879Pdf(taxYearId: string): Promise<Buffer> {
  const ctx = await load8879Context(taxYearId)
  const stream = await pdf(<Form8879Doc ctx={ctx} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}
