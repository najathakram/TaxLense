/**
 * GET /api/years/[year]/1099s/pdf?recipient=NAME
 *
 * Streams Form 1099-NEC PDF (Copy A + B + C stacked) for one recipient.
 */

import { NextRequest } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { buildForm1099NecPdf, type Form1099NecData } from "@/lib/reports/pdf/form1099nec"

export async function GET(
  req: NextRequest,
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

  const url = new URL(req.url)
  const recipient = url.searchParams.get("recipient")
  if (!recipient) return new Response("recipient query required", { status: 400 })

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: {
      user: { select: { name: true, email: true } },
      businessProfile: { select: { primaryState: true } },
    },
  })
  if (!taxYear) return new Response("Tax year not found", { status: 404 })

  const filing = await prisma.form1099Filing.findUnique({
    where: { taxYearId_recipientName: { taxYearId: taxYear.id, recipientName: recipient } },
  })
  if (!filing) return new Response("Filing not found", { status: 404 })

  // Pull payer details from the user / profile. EIN not yet on
  // BusinessProfile — placeholder until that field lands.
  const payerName = taxYear.user.name ?? taxYear.user.email
  const recipientAddress = (filing.recipientAddress as Record<string, string> | null) ?? {}

  const data: Form1099NecData = {
    taxYear: year,
    payer: {
      name: payerName,
      address1: "[VERIFY]",
      city: "[VERIFY]",
      state: taxYear.businessProfile?.primaryState ?? "[VERIFY]",
      postal: "[VERIFY]",
      tin: "[VERIFY]",
    },
    recipient: {
      name: filing.recipientName,
      address1: recipientAddress.line1 ?? "[VERIFY]",
      address2: recipientAddress.line2 || undefined,
      city: recipientAddress.city ?? "[VERIFY]",
      state: recipientAddress.state ?? "[VERIFY]",
      postal: recipientAddress.postal ?? "[VERIFY]",
      tin: filing.recipientTin ?? "[VERIFY]",
    },
    box1NonemployeeComp: Number(filing.box1NonemployeeComp?.toString() ?? "0"),
    box4FederalTaxWithheld: Number(filing.box4FederalTaxWithheld?.toString() ?? "0"),
  }

  const buf = await buildForm1099NecPdf(data)
  const safeName = recipient.replace(/[^A-Za-z0-9]+/g, "_").slice(0, 50)
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="1099-NEC_${year}_${safeName}.pdf"`,
      "Content-Length": String(buf.length),
    },
  })
}
