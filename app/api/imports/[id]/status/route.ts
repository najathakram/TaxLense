import { type NextRequest, NextResponse } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const userId = await getCurrentUserId()

  const imp = await prisma.statementImport.findFirst({
    where: { id, account: { userId } },
    select: {
      parseStatus: true,
      parseError: true,
      transactionCount: true,
      institution: true,
      periodStart: true,
      periodEnd: true,
      sessionId: true,
    },
  })

  if (!imp) return NextResponse.json({ error: "Not found" }, { status: 404 })

  let apiCallsUsed = 0
  let apiCallLimit = 150
  if (imp.sessionId) {
    const sess = await prisma.importSession.findUnique({
      where: { id: imp.sessionId },
      select: { totalApiCalls: true, apiCallLimit: true },
    })
    if (sess) {
      apiCallsUsed = sess.totalApiCalls
      apiCallLimit = sess.apiCallLimit
    }
  }

  return NextResponse.json({
    parseStatus: imp.parseStatus,
    parseError: imp.parseError,
    transactionCount: imp.transactionCount,
    institution: imp.institution,
    periodStart: imp.periodStart?.toISOString() ?? null,
    periodEnd: imp.periodEnd?.toISOString() ?? null,
    sessionId: imp.sessionId,
    apiCallsUsed,
    apiCallLimit,
  })
}
