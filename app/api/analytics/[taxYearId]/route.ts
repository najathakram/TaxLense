import { NextResponse } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { buildAnalytics } from "@/lib/analytics/build"

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ taxYearId: string }> },
) {
  const userId = await getCurrentUserId()
  const { taxYearId } = await params

  // Authorization: owner or CPA with a CpaClient relationship
  const taxYear = await prisma.taxYear.findUnique({
    where: { id: taxYearId },
    select: { userId: true },
  })
  if (!taxYear) return NextResponse.json({ error: "Not found" }, { status: 404 })

  if (taxYear.userId !== userId) {
    const rel = await prisma.cpaClient.findUnique({
      where: { cpaUserId_clientUserId: { cpaUserId: userId, clientUserId: taxYear.userId } },
    })
    if (!rel) return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  const data = await buildAnalytics(taxYearId)
  return NextResponse.json(data)
}
