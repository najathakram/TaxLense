/**
 * GET /api/years/[year]/documents/[kind]/pdf?inline=1
 *
 * Streams the PDF for a specific document slug. inline=1 → renders in
 * the in-app viewer iframe (Content-Disposition: inline). inline=0 →
 * downloads. Always writes a Report row + AuditEvent for audit.
 */

import { NextRequest } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { DOC_REGISTRY, type DocKindSlug } from "@/lib/reports/documentRegistry"
import { computeLedgerHash } from "@/lib/lock/hash"

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ year: string; kind: string }> },
) {
  const { year: yearParam, kind } = await params
  let userId: string
  try {
    userId = await getCurrentUserId()
  } catch {
    return new Response("Unauthorized", { status: 401 })
  }
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) return new Response("Invalid year", { status: 400 })

  const spec = DOC_REGISTRY[kind as DocKindSlug]
  if (!spec) return new Response(`Unknown document slug: ${kind}`, { status: 400 })

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) return new Response("Tax year not found", { status: 404 })

  if (spec.requiresLock && taxYear.status !== "LOCKED") {
    return new Response(`${spec.shortName} requires the year to be LOCKED`, { status: 422 })
  }

  let buf: Buffer
  try {
    const builder = await spec.builder()
    buf = await builder(taxYear.id)
  } catch (e) {
    console.error(`[doc-pdf] ${spec.slug} build failed:`, e)
    return new Response(
      `Document generation failed: ${e instanceof Error ? e.message : String(e)}`,
      { status: 500 },
    )
  }

  // Stamp Report row + AuditEvent so stale-detection works
  const currentHash = await computeLedgerHash(taxYear.id)
  await prisma.$transaction(async (tx) => {
    await tx.report.updateMany({
      where: { taxYearId: taxYear.id, kind: "TAX_PACKAGE", filePath: { contains: spec.slug }, isCurrent: true },
      data: { isCurrent: false },
    })
    await tx.report.create({
      data: {
        taxYearId: taxYear.id,
        kind: "TAX_PACKAGE",
        filePath: `taxlens-${year}-${spec.slug}.pdf`,
        transactionSnapshotHash: currentHash,
        isCurrent: true,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "DOC_VIEWED",
        entityType: "TaxYear",
        entityId: taxYear.id,
        afterState: { slug: spec.slug, year, bytes: buf.length, ledgerHash: currentHash },
      },
    })
  })

  const inline = new URL(req.url).searchParams.get("inline") === "1"
  const filename = `taxlens-${year}-${spec.slug}.pdf`
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${filename}"`,
      "Content-Length": String(buf.length),
    },
  })
}
