import { NextRequest } from "next/server"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { buildMasterLedger } from "@/lib/reports/masterLedger"
import { buildFinancialStatements } from "@/lib/reports/financialStatements"
import { buildAuditPacket } from "@/lib/reports/auditPacket"

type KindSlug = "master-ledger" | "financial-statements" | "audit-packet"

const SLUG_TO_KIND: Record<KindSlug, { kind: "MASTER_LEDGER" | "FINANCIAL_STATEMENTS" | "AUDIT_PACKET"; ext: string; contentType: string; label: string }> = {
  "master-ledger": {
    kind: "MASTER_LEDGER",
    ext: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "master-ledger",
  },
  "financial-statements": {
    kind: "FINANCIAL_STATEMENTS",
    ext: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    label: "financial-statements",
  },
  "audit-packet": {
    kind: "AUDIT_PACKET",
    ext: "zip",
    contentType: "application/zip",
    label: "audit-packet",
  },
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ year: string; kind: string }> }
) {
  const { year: yearParam, kind: kindParam } = await params

  // Auth
  let session: Awaited<ReturnType<typeof requireAuth>>
  try {
    session = await requireAuth()
  } catch {
    return new Response("Unauthorized", { status: 401 })
  }
  const userId = session.user!.id!

  // Validate year
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) return new Response("Invalid year", { status: 400 })

  // Validate kind slug
  const meta = SLUG_TO_KIND[kindParam as KindSlug]
  if (!meta) {
    return new Response(`Unknown kind: ${kindParam}. Valid: master-ledger, financial-statements, audit-packet`, { status: 400 })
  }

  // Resolve tax year — must belong to user
  const taxYear = await prisma.taxYear.findUnique({ where: { userId_year: { userId, year } } })
  if (!taxYear) return new Response("Tax year not found", { status: 404 })
  if (taxYear.status !== "LOCKED") return new Response("Tax year must be LOCKED to generate reports", { status: 422 })

  // Generate
  let buf: Buffer
  try {
    switch (meta.kind) {
      case "MASTER_LEDGER":
        buf = await buildMasterLedger(taxYear.id)
        break
      case "FINANCIAL_STATEMENTS":
        buf = await buildFinancialStatements(taxYear.id)
        break
      case "AUDIT_PACKET":
        buf = await buildAuditPacket(taxYear.id)
        break
    }
  } catch (e) {
    console.error(`[download] ${meta.kind} generation failed:`, e)
    return new Response("Report generation failed", { status: 500 })
  }

  // Record report row — mark prior as not current
  await prisma.$transaction(async (tx) => {
    await tx.report.updateMany({
      where: { taxYearId: taxYear.id, kind: meta.kind, isCurrent: true },
      data: { isCurrent: false },
    })
    await tx.report.create({
      data: {
        taxYearId: taxYear.id,
        kind: meta.kind,
        filePath: `taxlens-${year}-${meta.label}.${meta.ext}`,
        transactionSnapshotHash: taxYear.lockedSnapshotHash,
        isCurrent: true,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "REPORT_GENERATED",
        entityType: "TaxYear",
        entityId: taxYear.id,
        afterState: { kind: meta.kind, year, bytes: buf.length },
      },
    })
  })

  const filename = `taxlens-${year}-${meta.label}.${meta.ext}`
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": meta.contentType,
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
    },
  })
}
