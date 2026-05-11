/**
 * GET /api/years/[year]/1099s/iris-csv
 *
 * Streams the IRS IRIS-format CSV for batch upload of all Form1099Filing
 * rows. IRIS portal: irs.gov/iris (Information Returns Intake System).
 */

import { NextRequest } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { buildIris1099Csv } from "@/lib/reports/filings1099"

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

  const buf = await buildIris1099Csv(taxYear.id, {
    payerName: taxYear.user.name ?? taxYear.user.email,
    payerEin: "[VERIFY]",
    payerAddress: {
      line1: "[VERIFY]",
      city: "[VERIFY]",
      state: taxYear.businessProfile?.primaryState ?? "[VERIFY]",
      postal: "[VERIFY]",
    },
    taxYear: year,
  })

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="iris-1099nec-${year}.csv"`,
      "Content-Length": String(buf.length),
    },
  })
}
