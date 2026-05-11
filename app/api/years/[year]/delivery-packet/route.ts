/**
 * GET /api/years/[year]/delivery-packet
 *
 * Streams the client-facing delivery packet ZIP (cover memo + tax return +
 * 1099 Copy B per recipient + 8879 + engagement letter). Gated on
 * TaxYear.status === LOCKED.
 */

import { NextRequest } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { buildDeliveryPacket } from "@/lib/reports/deliveryPacket"

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
  })
  if (!taxYear) return new Response("Tax year not found", { status: 404 })
  if (taxYear.status !== "LOCKED") {
    return new Response("Tax year must be LOCKED", { status: 422 })
  }

  let buf: Buffer
  try {
    buf = await buildDeliveryPacket(taxYear.id)
  } catch (e) {
    console.error("[delivery-packet] failed:", e)
    return new Response(
      `Delivery packet failed: ${e instanceof Error ? e.message : String(e)}`,
      { status: 500 },
    )
  }

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "USER",
      eventType: "DELIVERY_PACKET_GENERATED",
      entityType: "TaxYear",
      entityId: taxYear.id,
      afterState: { year, bytes: buf.length },
    },
  })

  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="taxlens-${year}-delivery.zip"`,
      "Content-Length": String(buf.length),
    },
  })
}
