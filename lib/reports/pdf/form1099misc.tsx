/**
 * Form 1099-MISC PDF builder — for rents (Box 1), royalties (Box 2), other
 * income (Box 3), and other categories. Threshold $600/year/payee per
 * Reg §1.6041-1, except royalties at $10/year per Reg §1.6050N-1.
 *
 * Companion to form1099nec.tsx — same Copy A/B/C structure, distinct boxes.
 * Per Pub 1220 the IRS mandates separate 1099-MISC vs 1099-NEC since
 * TY2020 (NEC was previously MISC Box 7).
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
  formTitle: { fontSize: 14, fontFamily: "Helvetica-Bold", marginBottom: 2 },
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
  block: { border: "1 solid #444", padding: 6, marginBottom: 4 },
  blockTitle: { fontFamily: "Helvetica-Bold", fontSize: 8, marginBottom: 2, color: "#444" },
  twoCol: { flexDirection: "row", gap: 6, marginBottom: 4 },
  half: { flex: 1 },
  boxRow: { flexDirection: "row", border: "1 solid #444", padding: 4, marginBottom: 2 },
  boxNum: { width: 28, fontFamily: "Helvetica-Bold" },
  boxLabel: { flex: 1 },
  boxAmount: { width: 100, textAlign: "right", fontFamily: "Helvetica-Bold" },
  small: { fontSize: 8, color: "#444" },
  notice: { fontSize: 7, color: "#666", marginTop: 6, fontStyle: "italic" },
})

export interface Form1099MiscData {
  taxYear: number
  payer: {
    name: string
    address1: string
    address2?: string
    city: string
    state: string
    postal: string
    tin: string
  }
  recipient: {
    name: string
    address1: string
    address2?: string
    city: string
    state: string
    postal: string
    tin: string
    accountNumber?: string
  }
  // Box amounts (TY2025 1099-MISC layout)
  box1Rents?: number
  box2Royalties?: number
  box3OtherIncome?: number
  box4FederalTaxWithheld?: number
  box5FishingBoatProceeds?: number
  box6MedicalAndHealthCarePayments?: number
  box8SubstitutePayments?: number
  box10GrossProceedsToAttorney?: number
  box14NonqualifiedDeferredComp?: number
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
  const clean = tin.replace(/\D/g, "")
  if (clean.length === 9) return `***-**-${clean.slice(-4)}`
  return `***${clean.slice(-4)}`
}

function FormBody({
  data,
  maskRecipientTin,
}: {
  data: Form1099MiscData
  maskRecipientTin: boolean
}) {
  return (
    <View>
      <View style={styles.twoCol}>
        <View style={styles.half}>
          <Text style={styles.formTitle}>Form 1099-MISC — Miscellaneous Information</Text>
          <Text style={styles.small}>For Tax Year {data.taxYear} · OMB No. 1545-0115</Text>
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
      </View>

      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>1</Text>
        <Text style={styles.boxLabel}>Rents</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box1Rents ?? 0)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>2</Text>
        <Text style={styles.boxLabel}>Royalties (≥ $10/yr per Reg §1.6050N-1)</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box2Royalties ?? 0)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>3</Text>
        <Text style={styles.boxLabel}>Other income</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box3OtherIncome ?? 0)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>4</Text>
        <Text style={styles.boxLabel}>Federal income tax withheld</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box4FederalTaxWithheld ?? 0)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>5</Text>
        <Text style={styles.boxLabel}>Fishing boat proceeds</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box5FishingBoatProceeds ?? 0)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>6</Text>
        <Text style={styles.boxLabel}>Medical and health care payments</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box6MedicalAndHealthCarePayments ?? 0)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>8</Text>
        <Text style={styles.boxLabel}>Substitute payments in lieu of dividends/interest</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box8SubstitutePayments ?? 0)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>10</Text>
        <Text style={styles.boxLabel}>Gross proceeds paid to an attorney</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box10GrossProceedsToAttorney ?? 0)}</Text>
      </View>
      <View style={styles.boxRow}>
        <Text style={styles.boxNum}>14</Text>
        <Text style={styles.boxLabel}>Nonqualified deferred compensation (§409A)</Text>
        <Text style={styles.boxAmount}>{fmtUSD(data.box14NonqualifiedDeferredComp ?? 0)}</Text>
      </View>
    </View>
  )
}

function Form1099MiscAllCopies({ data }: { data: Form1099MiscData }) {
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <View style={styles.copyHeader}>
          <Text>FORM 1099-MISC — COPY A (For IRS Service Center — file via IRIS / FIRE or red-ink form)</Text>
        </View>
        <FormBody data={data} maskRecipientTin={false} />
        <Text style={styles.notice}>
          NOTICE: TaxLens facsimile. Paper Copy A must be filed on official red-ink IRS forms or
          electronically via IRS IRIS / FIRE (T.D. 9972 mandates e-file at 10+ returns).
        </Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View style={styles.copyHeader}>
          <Text>FORM 1099-MISC — COPY B (For Recipient)</Text>
        </View>
        <FormBody data={data} maskRecipientTin={true} />
        <Text style={styles.notice}>
          You received this 1099-MISC because you were paid in {data.taxYear}. Report the income on
          the appropriate line of your return (rents → Schedule E; royalties → Schedule E; other
          income → Schedule 1 line 8).
        </Text>
      </Page>

      <Page size="LETTER" style={styles.page}>
        <View style={styles.copyHeader}>
          <Text>FORM 1099-MISC — COPY C (For Payer file)</Text>
        </View>
        <FormBody data={data} maskRecipientTin={false} />
        <Text style={styles.notice}>
          Retain in payer records 4 years per Reg §31.6051-2.
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

export async function buildForm1099MiscPdf(data: Form1099MiscData): Promise<Buffer> {
  const stream = await pdf(<Form1099MiscAllCopies data={data} />).toBuffer()
  return pdfToBuffer(stream as unknown as AsyncIterable<Buffer | string>)
}
