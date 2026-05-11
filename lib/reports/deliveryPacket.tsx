/**
 * Delivery packet — the client-facing handoff bundle.
 *
 * One ZIP with:
 *   - cover_memo.pdf        — plain-English summary (1 page) for the taxpayer
 *   - tax_return.pdf        — locked Schedule C / 1120-S / 1065 / 1120
 *   - schedule_se.pdf       — sole prop only
 *   - form_8995.pdf         — sole prop QBI only
 *   - form_8829.pdf         — if home office (ACTUAL method)
 *   - 1099_recipient_copies.pdf — Copy B for each 1099 recipient
 *   - form_8879.pdf         — IRS e-file authorization (if generated)
 *   - engagement_letter.pdf — if signed
 *   - payment_instructions.pdf — if balance due
 *
 * Different from the dump (which is the CPA's full audit packet) — this
 * is the polished bundle the CPA emails to the taxpayer for review.
 */

import archiver from "archiver"
import { PassThrough, Readable } from "node:stream"
import React from "react"
import { Document, Page, Text, View, StyleSheet, pdf } from "@react-pdf/renderer"
import { prisma } from "@/lib/db"
import { buildScheduleCWorksheetPdf, buildForm8829Pdf } from "./pdf/documents"
import {
  buildForm1120SPdf,
  buildForm1065Pdf,
  buildForm1120Pdf,
  buildScheduleK1PdfPerOwner,
  slugifyOwnerName,
} from "./pdf/entityForms"
import { buildScheduleSePdf, buildForm8995Pdf } from "./pdf/schedules"
import { buildEngagementLetterPdf, buildForm8879Pdf } from "./pdf/engagement"
import { buildForm1099NecPdf, type Form1099NecData } from "./pdf/form1099nec"
import { inYearWindow } from "@/lib/queries/yearWindow"

const styles = StyleSheet.create({
  page: { padding: 48, fontSize: 11, fontFamily: "Helvetica", color: "#111" },
  header: { fontSize: 18, fontFamily: "Helvetica-Bold", marginBottom: 6 },
  sub: { fontSize: 10, color: "#555", marginBottom: 16 },
  h2: { fontSize: 13, fontFamily: "Helvetica-Bold", marginTop: 16, marginBottom: 6 },
  p: { lineHeight: 1.5, marginBottom: 8 },
  amount: { fontFamily: "Helvetica-Bold" },
  callout: {
    border: "1 solid #0a1f44",
    backgroundColor: "#f0f5ff",
    padding: 10,
    marginVertical: 10,
  },
  small: { fontSize: 9, color: "#555" },
})

interface CoverMemoData {
  year: number
  clientName: string
  cpaName: string
  netIncome: number
  estimatedTax: number
  refundOrDue: number
  formName: string
  has1099s: number
  hasHomeOffice: boolean
  has8879: boolean
}

function fmtUSD(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
}

function CoverMemoDoc({ data }: { data: CoverMemoData }) {
  const oweOrRefund = data.refundOrDue >= 0 ? "refund" : "balance due"
  return (
    <Document>
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.header}>Tax Return Summary — {data.year}</Text>
        <Text style={styles.sub}>
          Prepared for {data.clientName} by {data.cpaName} · {new Date().toISOString().slice(0, 10)}
        </Text>

        <Text style={styles.p}>
          Dear {data.clientName.split(" ")[0]},
        </Text>
        <Text style={styles.p}>
          Your {data.year} federal tax return is ready for your review. The bottom-line numbers:
        </Text>

        <View style={styles.callout}>
          <Text style={styles.p}>
            Net business income: <Text style={styles.amount}>{fmtUSD(data.netIncome)}</Text>
          </Text>
          <Text style={styles.p}>
            Estimated total tax: <Text style={styles.amount}>{fmtUSD(data.estimatedTax)}</Text>
          </Text>
          <Text style={styles.p}>
            Estimated {oweOrRefund}:{" "}
            <Text style={styles.amount}>{fmtUSD(Math.abs(data.refundOrDue))}</Text>
          </Text>
        </View>

        <Text style={styles.h2}>What&apos;s in this packet</Text>
        <Text style={styles.p}>
          • <Text style={styles.amount}>{data.formName}</Text> — your primary tax return.
        </Text>
        {data.hasHomeOffice && (
          <Text style={styles.p}>
            • Form 8829 — home office deduction supporting calculation.
          </Text>
        )}
        {data.has1099s > 0 && (
          <Text style={styles.p}>
            • {data.has1099s} Form 1099-NEC recipient copies (Copy B) — give one to each
            contractor by January 31.
          </Text>
        )}
        {data.has8879 && (
          <Text style={styles.p}>
            • Form 8879 — IRS e-file authorization. Please sign and return so we can transmit
            your return.
          </Text>
        )}

        <Text style={styles.h2}>What you need to do</Text>
        <Text style={styles.p}>
          1. Review the return for any factual errors (name, address, SSN, account numbers).
        </Text>
        <Text style={styles.p}>
          2. Sign Form 8879 (if included). Your 5-digit PIN is on the form.
        </Text>
        {data.refundOrDue < 0 && (
          <Text style={styles.p}>
            3. Pay your balance of {fmtUSD(Math.abs(data.refundOrDue))} via IRS Direct Pay
            (irs.gov/payments) by April 15. We can also set up an installment agreement on
            request.
          </Text>
        )}
        {data.refundOrDue >= 0 && (
          <Text style={styles.p}>
            3. Refunds typically arrive within 21 days of e-file acceptance.
          </Text>
        )}

        <Text style={styles.h2}>Questions?</Text>
        <Text style={styles.p}>
          Reply to the email this packet was attached to, or schedule a review call.
        </Text>

        <Text style={styles.small}>
          This summary is informational. The official return is your authoritative record.
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

function bufferToStream(buf: Buffer): Readable {
  const pt = new PassThrough()
  pt.end(buf)
  return pt
}

export interface BuildDeliveryPacketOptions {
  /** Override entity (rarely used; defaults to BusinessProfile.entityType) */
  entityOverride?: string
}

export async function buildDeliveryPacket(
  taxYearId: string,
  options: BuildDeliveryPacketOptions = {},
): Promise<Buffer> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: {
      user: { select: { name: true, email: true } },
      businessProfile: { select: { entityType: true, homeOfficeConfig: true } },
      engagementLetter: true,
      form8879: true,
    },
  })
  if (ty.status !== "LOCKED") {
    throw new Error("Delivery packet requires the year to be LOCKED")
  }

  const entityType = options.entityOverride ?? ty.businessProfile?.entityType ?? "SOLE_PROP"
  const homeOffice = (ty.businessProfile?.homeOfficeConfig ?? {}) as { has?: boolean; method?: string }
  const hasHomeOffice = !!homeOffice.has && homeOffice.method === "ACTUAL"

  // Compute income / tax estimate for cover memo
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, ...inYearWindow(ty.year) },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  let receipts = 0
  let deductions = 0
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const amt = Math.abs(Number(t.amountNormalized.toString()))
    if (c.code === "BIZ_INCOME") receipts += amt
    else if (
      ["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100"].includes(c.code)
    ) {
      const mult = c.code === "MEALS_50" ? 0.5 : 1
      deductions += amt * (c.businessPct / 100) * mult
    }
  }
  const netIncome = receipts - deductions
  const estimatedTax = Math.max(0, netIncome) * 0.25
  const refundOrDue = -estimatedTax // assume no withholding seen

  // Pull approved 1099 filings to include Copy B
  const filings = await prisma.form1099Filing.findMany({ where: { taxYearId } })

  const formNameMap: Record<string, string> = {
    SOLE_PROP: "Schedule C (Form 1040)",
    LLC_SINGLE: "Schedule C (Form 1040, disregarded)",
    S_CORP: "Form 1120-S",
    LLC_MULTI: "Form 1065",
    PARTNERSHIP: "Form 1065",
    C_CORP: "Form 1120",
  }

  const cover = await pdf(
    <CoverMemoDoc
      data={{
        year: ty.year,
        clientName: ty.user.name ?? ty.user.email,
        cpaName: ty.user.name ?? "Your CPA",
        netIncome,
        estimatedTax,
        refundOrDue,
        formName: formNameMap[entityType] ?? "Schedule C",
        has1099s: filings.length,
        hasHomeOffice,
        has8879: !!ty.form8879,
      }}
    />,
  ).toBuffer()
  const coverBuf = await pdfToBuffer(cover as unknown as AsyncIterable<Buffer | string>)

  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver("zip", { zlib: { level: 6 } })
    const passthrough = new PassThrough()
    const chunks: Buffer[] = []
    passthrough.on("data", (c: Buffer) => chunks.push(c))
    passthrough.on("end", () => resolve(Buffer.concat(chunks)))
    passthrough.on("error", reject)
    archive.on("error", reject)
    archive.pipe(passthrough)

    void (async () => {
      try {
        archive.append(bufferToStream(coverBuf), { name: "01_cover_memo.pdf" })

        // Primary tax return per entity type
        if (entityType === "SOLE_PROP" || entityType === "LLC_SINGLE") {
          archive.append(bufferToStream(await buildScheduleCWorksheetPdf(taxYearId)), {
            name: "02_schedule_c.pdf",
          })
          archive.append(bufferToStream(await buildScheduleSePdf(taxYearId)), {
            name: "03_schedule_se.pdf",
          })
          archive.append(bufferToStream(await buildForm8995Pdf(taxYearId)), {
            name: "04_form_8995_qbi.pdf",
          })
          if (hasHomeOffice) {
            archive.append(bufferToStream(await buildForm8829Pdf(taxYearId)), {
              name: "05_form_8829.pdf",
            })
          }
        } else if (entityType === "S_CORP") {
          archive.append(bufferToStream(await buildForm1120SPdf(taxYearId)), {
            name: "02_form_1120s.pdf",
          })
          const k1s = await buildScheduleK1PdfPerOwner(taxYearId, "1120-S")
          k1s.forEach((k1, i) => {
            const idx = String.fromCharCode(0x61 + i)
            const slug = slugifyOwnerName(k1.owner.name) || `owner_${i + 1}`
            archive.append(bufferToStream(k1.buffer), { name: `03${idx}_k1_${slug}.pdf` })
          })
        } else if (entityType === "LLC_MULTI" || entityType === "PARTNERSHIP") {
          archive.append(bufferToStream(await buildForm1065Pdf(taxYearId)), {
            name: "02_form_1065.pdf",
          })
          const k1s = await buildScheduleK1PdfPerOwner(taxYearId, "1065")
          k1s.forEach((k1, i) => {
            const idx = String.fromCharCode(0x61 + i)
            const slug = slugifyOwnerName(k1.owner.name) || `partner_${i + 1}`
            archive.append(bufferToStream(k1.buffer), { name: `03${idx}_k1_${slug}.pdf` })
          })
        } else if (entityType === "C_CORP") {
          archive.append(bufferToStream(await buildForm1120Pdf(taxYearId)), {
            name: "02_form_1120.pdf",
          })
        }

        // 1099-NEC Copy B per recipient (client owes one to each contractor)
        for (let i = 0; i < filings.length; i++) {
          const f = filings[i]!
          const addr = (f.recipientAddress as Record<string, string> | null) ?? {}
          const data: Form1099NecData = {
            taxYear: ty.year,
            payer: {
              name: ty.user.name ?? ty.user.email,
              address1: "[VERIFY]",
              city: "[VERIFY]",
              state: "[VERIFY]",
              postal: "[VERIFY]",
              tin: "[VERIFY]",
            },
            recipient: {
              name: f.recipientName,
              address1: addr.line1 ?? "[VERIFY]",
              city: addr.city ?? "[VERIFY]",
              state: addr.state ?? "[VERIFY]",
              postal: addr.postal ?? "[VERIFY]",
              tin: f.recipientTin ?? "[VERIFY]",
            },
            box1NonemployeeComp: Number(f.box1NonemployeeComp?.toString() ?? "0"),
          }
          archive.append(bufferToStream(await buildForm1099NecPdf(data)), {
            name: `06_1099_nec_${slugifyOwnerName(f.recipientName) || `recipient_${i + 1}`}.pdf`,
          })
        }

        // 8879 + engagement
        if (ty.form8879) {
          archive.append(bufferToStream(await buildForm8879Pdf(taxYearId)), {
            name: "07_form_8879.pdf",
          })
        }
        if (ty.engagementLetter) {
          archive.append(bufferToStream(await buildEngagementLetterPdf(taxYearId)), {
            name: "08_engagement_letter.pdf",
          })
        }

        const readme = `# ${ty.user.name ?? ty.user.email} — Tax Year ${ty.year} Delivery Packet

Generated: ${new Date().toISOString()}
Locked snapshot: ${ty.lockedSnapshotHash ?? "[unlocked]"}

This packet contains your tax return and supporting documents for review,
signature, and recipient delivery (1099 Copy B). See 01_cover_memo.pdf for
a plain-English summary and next-steps checklist.
`
        archive.append(readme, { name: "README.md" })

        await archive.finalize()
      } catch (e) {
        reject(e)
      }
    })()
  })
}
