/**
 * GET /api/years/[year]/1099s/1096
 *
 * Streams Form 1096 transmittal PDF (paper-filing only). Aggregates all
 * Form1099Filing rows into one cover sheet with totals.
 */

import { NextRequest } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { buildForm1096Pdf, type Form1096Data } from "@/lib/reports/pdf/form1099nec"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ year: string }> },
) {
  const { year: yearParam } = await params
  let userId: string
  try {
    userId = await getCurrentUserId()
  } catch {
    return new Response("Unauthorized", { status: 401 })
  }
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) return new Response("Invalid year", { status: 400 })

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: {
      user: { select: { name: true, email: true } },
      businessProfile: { select: { primaryState: true } },
    },
  })
  if (!taxYear) return new Response("Tax year not found", { status: 404 })

  const filings = await prisma.form1099Filing.findMany({
    where: { taxYearId: taxYear.id },
  })
  if (filings.length === 0) return new Response("No 1099 filings to transmit", { status: 422 })

  const total = filings.reduce(
    (s, f) => s + Number(f.box1NonemployeeComp?.toString() ?? "0"),
    0,
  )
  const fedWithheld = filings.reduce(
    (s, f) => s + Number(f.box4FederalTaxWithheld?.toString() ?? "0"),
    0,
  )

  const data: Form1096Data = {
    taxYear: year,
    payer: {
      name: taxYear.user.name ?? taxYear.user.email,
      address1: "[VERIFY]",
      city: "[VERIFY]",
      state: taxYear.businessProfile?.primaryState ?? "[VERIFY]",
      postal: "[VERIFY]",
      tin: "[VERIFY]",
    },
    contactPerson: {
      name: taxYear.user.name ?? taxYear.user.email,
      phone: "[VERIFY]",
      email: taxYear.user.email,
      faxOrEmail: "",
    },
    totalNumberOfForms: filings.length,
    totalFederalTaxWithheld: fedWithheld,
    totalReportedAmount: total,
    formType: "1099-NEC",
  }

  const buf = await buildForm1096Pdf(data)
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Form_1096_${year}.pdf"`,
      "Content-Length": String(buf.length),
    },
  })
}
