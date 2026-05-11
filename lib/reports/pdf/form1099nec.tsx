/**
 * Form 1099-NEC PDF builder — produces Copy A (IRS), Copy B (recipient),
 * Copy C (payer file) per Form 1099-NEC Instructions Rev. January 2025.
 *
 * IMPORTANT: per IRS rules, paper Copy A must be on official red-ink IRS
 * forms (Forms 1096 + 1099 are pre-printed). The PDFs we generate here
 * are READABLE FACSIMILES — useful for client review, recipient delivery
 * (Copy B), and payer file (Copy C). Filing Copy A still requires either:
 *   a) Order pre-printed red-ink forms from irs.gov/orderforms
 *   b) E-file via IRS IRIS / FIRE (T.D. 9972 mandates e-file at 10+ returns)
 *
 * Generates one PDF per recipient containing all three copies stacked.
 * The 1096 transmittal builder is in form1096.tsx.
 */

import React from "react"
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer"

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 9, fontFamily: "Helvetica", color: "#111" },
  copyHeader: {
    backgroundColor: "#0a1f44",
    color: "#fff",
    padding: 6,
    fontFamily: "Helvetica-Bold",
    fontSize: 11,
    marginBottom: 8,
  },
  formTitle: {
    fontSize: 14,
    fontFamily: "Helvetica-Bold",
    marginBottom: 2,
  },
  yearBadge: {
    backgroundColor: "#000",
    color: "#fff",
    padding: 4,
    fontFamily: "Helvetica-Bold",
    fontSize: 16,
    width: 80,
    textAlign: "center",
    marginBottom: 4,
  },
  block: {
    border: "1 solid #444",
    padding: 6,
    marginBottom: 4,
  },
  blockTitle: {
    fontFamily: "Helvetica-Bold",
    fontSize: 8,
    marginBottom: 2,
    color: "#444",
  },
  twoCol: {
    flexDirection: "row",
    gap: 6,
    marginBottom: 4,
  },
  half: { flex: 1 },
  boxRow: {
    flexDirection: "row",
    border: "1 solid #444",
    padding: 4,
    marginBottom: 2,
  },
  boxNum: { width: 22, fontFamily: "Helvetica-Bold" },
  boxLabel: { flex: 1 },
  boxAmount: { width: 100, textAlign: "right", fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8, color: "#444" },
  divider: {
    borderTop: "2 dashed #888",
    marginVertical: 12,
  },
  notice: {
    fontSize: 7,
    color: "#666",
    marginTop: 6,
    fontStyle: "italic",
  },
})

export interface Form1099NecData {
  taxYear: number
  payer: {
    name: string
    address1: string
    address2?: string
    city: string
    state: string
    postal: string
    tin: string // EIN or SSN
  }
  recipient: {
    name: string
    address1: string
    address2?: string
    city: string
    state: string
    postal: string
    tin: string // SSN or EIN (last 4 visible on Copy B; full on A/C)
    accountNumber?: string
  }
  box1NonemployeeComp: number
  box4FederalTaxWithheld?: number
  // State withholding (boxes 5-7 — optional)
  state5?: { withheld: number; payerStateNo: string; stateIncome: number }
}

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  })
}

function maskTin(tin: string, mask: boolean): string {
  if (!tin) return ""
  if (!mask) return tin
  // Show only last 4 digits — XXX-XX-1234 or XX-XXX1234
  const clean = tin.replace(/\D/g, "")
  if (clean.length === 9) return `***-**-${clean.slice(-4)}`
  return `***${clean.slice(-4)}`
}

function CopyHeader({ copy, instructions }: { copy: "A" | "B" | "C"; instructions: string }) {
  return (
    <View style={styles.copyHeader}>
      <Text>
        FORM 1099-NEC — COPY {copy} ({instructions})
      </Text>
    </View>
  )
}

function FormBody({
  data,
  maskRecipientTin,
}: {
  data: Form1099NecData
  maskRecipientTin: boolean
}) {
  return (
    <View>
      <View style={styles.twoCol}>
        <View style={styles.half}>
          <Text style={styles.formTitle}>Form 1099-NEC — Nonemployee Compensation</Text>
          <Text style={styles.small}>
            For Tax Year {data.taxYear} · OMB No. 1545-0116
          </Text>
        </View>
        <View>
          <Text style={styles.yearBadge}>{data.taxYear}</Text>
        </View>
      </View>

      <View style={styles.block}>
        <Text style={styles.blockTitle}>PAYER&apos;S name, address, and TIN</Text>
        <Text>{data.payer.name}</Text>
        <Text>{data.payer.address1}</Text>
        {data.payer.address2 ? <Text>{data.payer.address2}</Text> : null}
        <Text>{`${data.payer.city}, ${data.payer.state} ${data.payer.postal}`}</Text>
        <Text style={{ marginTop: 3 }}>Payer&apos;s TIN: {data.payer.tin}</Text>
      </View>

      <View style={styles.block}>
        <Text style={styles.blockTitle}>RECIPIENT&apos;S name, address, and TIN</Text>
        <Text>{data.recipient.name}</Text>
        <Text>{data.recipient.address1}</Text>
        {data.recipient.address2 ? <Text>{data.recipient.address2}</Text> : null}
        <Text>{`${data.recipient.city}, ${data.recipient.state} ${data.recipient.postal}`}</Text>
        <Text style={{ marginTop: 3 }}>
          Recipient&apos;s TIN: {maskTin(data.recipient.tin, maskRecipientTin)}
        </Text>
        {data.recipient.accountNumber && (
          <Text>Account number: {data.recipient.accountNumber}</Text>
        )}
      </View>

      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>1</Text>
        <Text style={styles.boxLabel}>Nonemployee compensation</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box1NonemployeeComp)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>2</Text>
        <Text style={styles.boxLabel}>Payer made direct sales totaling \$5,000+ of consumer products</Text>
        <Text style={styles.boxAmount}>☐</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>4</Text>
        <Text style={styles.boxLabel}>Federal income tax withheld</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box4FederalTaxWithheld ?? 0)}</Text>
      </View>

      {data.state5 && (
        <>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>5</Text>
            <Text style={styles.boxLabel}>State tax withheld</Text>
            <Text style={styles.boxAmount}>{fmtUSD(data.state5.withheld)}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>6</Text>
            <Text style={styles.boxLabel}>Payer&apos;s state no.</Text>
            <Text style={styles.boxAmount}>{data.state5.payerStateNo}</Text>
          </View>
          <View style={styles.boxRow}>
            <Text style={styles.boxNum}>7</Text>
            <Text style={styles.boxLabel}>State income</Text>
            <Text style={styles.boxAmount}>{fmtUSD(data.state5.stateIncome)}</Text>
          </View>
        </>
      )}
    </View>
  )
}

function Form1099NecAllCopies({ data }: { data: Form1099NecData }) {
  return (
    <Document>
      {/* Copy A — IRS (filed via IRIS / FIRE or printed on red-ink form) */}
      <Page size="LETTER" style={styles.page}>
        <CopyHeader copy="A" instructions="For Internal Revenue Service Center — file via IRS IRIS / FIRE or pre-printed red-ink form" />
        <FormBody data={data} maskRecipientTin={false} />
        <Text style={styles.notice}>
          NOTICE: This is a TaxLens facsimile. Per IRS rules, paper Copy A must
          be filed on official red-ink IRS forms (irs.gov/orderforms). E-filing
          via IRS IRIS or FIRE is required when filing 10+ information returns
          (T.D. 9972).
        </Text>
      </Page>

      {/* Copy B — for Recipient (TIN masked except last 4) */}
      <Page size="LETTER" style={styles.page}>
        <CopyHeader copy="B" instructions="For Recipient — keep this copy with your tax records" />
        <FormBody data={data} maskRecipientTin={true} />
        <Text style={styles.notice}>
          You received this 1099-NEC because you were paid as a nonemployee in
          {` ${data.taxYear}`}. Report this income on Schedule C (Form 1040)
          line 1. If you believe this form is incorrect, contact the payer.
        </Text>
      </Page>

      {/* Copy C — for Payer (full TINs visible) */}
      <Page size="LETTER" style={styles.page}>
        <CopyHeader copy="C" instructions="For Payer — keep this copy in your tax-year file" />
        <FormBody data={data} maskRecipientTin={false} />
        <Text style={styles.notice}>
          Retain this copy in your tax-year records along with the recipient&apos;s
          signed Form W-9. Reg §31.6051-2 requires retention for at least 4
          years from the due date of the return.
        </Text>
      </Page>
    </Document>
  )
}

async function pdfToBuffer(stream: AsyncIterable<Buffer | string>): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

export async function buildForm1099NecPdf(data: Form1099NecData): Promise<Buffer> {
  const stream = await pdf(<Form1099NecAllCopies data={data} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}

// ─────────────────────────────────────────────────────────────────────────
// Form 1096 — Annual Summary and Transmittal of U.S. Information Returns
// Required when paper-filing 1099s. Sent to IRS with batch.
// ─────────────────────────────────────────────────────────────────────────

export interface Form1096Data {
  taxYear: number
  payer: Form1099NecData["payer"]
  contactPerson: { name: string; phone: string; email: string; faxOrEmail: string }
  totalNumberOfForms: number
  totalFederalTaxWithheld: number
  totalReportedAmount: number
  formType: string // "1099-NEC" / "1099-MISC"
}

function Form1096Doc({ data }: { data: Form1096Data }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.copyHeader}>
          <Text>FORM 1096 — Annual Summary and Transmittal of U.S. Information Returns</Text>
        </View>
        <View style={styles.twoCol}>
          <View style={styles.half}>
            <Text style={styles.formTitle}>Form 1096 — TY {data.taxYear}</Text>
            <Text style={styles.small}>OMB No. 1545-0108 · Filer (payer) details</Text>
          </View>
          <View>
            <Text style={styles.yearBadge}>{data.taxYear}</Text>
          </View>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>FILER&apos;S name, address, and TIN</Text>
          <Text>{data.payer.name}</Text>
          <Text>{data.payer.address1}</Text>
          {data.payer.address2 ? <Text>{data.payer.address2}</Text> : null}
          <Text>{`${data.payer.city}, ${data.payer.state} ${data.payer.postal}`}</Text>
          <Text style={{ marginTop: 3 }}>EIN/SSN: {data.payer.tin}</Text>
        </View>

        <View style={styles.block}>
          <Text style={styles.blockTitle}>Contact name, phone, email/fax</Text>
          <Text>{data.contactPerson.name}</Text>
          <Text>Phone: {data.contactPerson.phone}</Text>
          <Text>Email: {data.contactPerson.email}</Text>
          <Text>Fax/Alt: {data.contactPerson.faxOrEmail}</Text>
        </View>

        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>3</Text>
          <Text style={styles.boxLabel}>Total number of forms</Text>
          <Text style={styles.boxAmount}>{data.totalNumberOfForms}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>4</Text>
          <Text style={styles.boxLabel}>Federal income tax withheld</Text>
          <Text style={styles.boxAmount}>{fmtUSD(data.totalFederalTaxWithheld)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>5</Text>
          <Text style={styles.boxLabel}>Total amount reported (sum of Box 1 across all forms)</Text>
          <Text style={styles.boxAmount}>{fmtUSD(data.totalReportedAmount)}</Text>
        </View>
        <View style={styles.boxRow}>
          <Text style={styles.boxNum}>6</Text>
          <Text style={styles.boxLabel}>Type of return — check ONE box</Text>
          <Text style={styles.boxAmount}>☑ {data.formType}</Text>
        </View>

        <Text style={styles.notice}>
          NOTICE: Form 1096 is required only when filing PAPER 1099 returns. If
          filing electronically via IRS IRIS or FIRE, no 1096 is needed. T.D.
          9972 mandates e-filing for filers of 10 or more information returns
          starting TY2023.
        </Text>
        <Text style={styles.notice}>
          Paper deadline: February 28, {data.taxYear + 1} (mail to designated
          IRS submission processing center per Form 1096 instructions).
          E-file deadline: March 31, {data.taxYear + 1}. Recipient copies
          (Copy B) due January 31, {data.taxYear + 1} regardless of filing path.
        </Text>
      </Page>
    </Document>
  )
}

export async function buildForm1096Pdf(data: Form1096Data): Promise<Buffer> {
  const stream = await pdf(<Form1096Doc data={data} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}
