import { NextResponse } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { buildFirmOverview } from "@/lib/analytics/build"

export async function GET() {
  const userId = await getCurrentUserId()
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } })
  if (me?.role !== "CPA") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }
  const data = await buildFirmOverview(userId)
  return NextResponse.json({ clients: data })
}
