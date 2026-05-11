/**
 * POST /api/years/[year]/dump?entity=<EntityType>
 *
 * Final Document Dump endpoint — gated behind:
 *   - Auth (CPA or owner)
 *   - TaxYear status === LOCKED
 *   - All blocking lock-assertions pass
 *
 * Streams a ZIP keyed to the chosen entity type. The entity is read from
 * the `?entity=` query (defaulting to the BusinessProfile entity if absent)
 * so the Finalize panel can preview a different entity without editing
 * the profile.
 *
 * Records one Report row (kind=TAX_PACKAGE, isCurrent=true) and one
 * AuditEvent (FINAL_DUMP_GENERATED) per generation. The override flag is
 * persisted in afterState.entityOverride so the audit trail shows the
 * deviation from BusinessProfile.entityType.
 */

import { NextRequest } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { buildTaxPackage } from "@/lib/reports/taxPackage"
import { runLockAssertions } from "@/lib/validation/assertions"

const SUPPORTED_ENTITIES = new Set<string>([
  "SOLE_PROP",
  "LLC_SINGLE",
  "S_CORP",
  "LLC_MULTI",
  "C_CORP",
  "PARTNERSHIP",
])

export async function POST(
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
  const entityParam = url.searchParams.get("entity")
  if (entityParam && !SUPPORTED_ENTITIES.has(entityParam)) {
    return new Response(`Unsupported entity: ${entityParam}`, { status: 400 })
  }

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, status: true, lockedSnapshotHash: true },
  })
  if (!taxYear) return new Response("Tax year not found", { status: 404 })
  if (taxYear.status !== "LOCKED") {
    return new Response("Tax year must be LOCKED before dump generation", { status: 422 })
  }

  // Pre-flight: assertions must pass. Without this an unlocked-then-edited
  // year could regenerate against in-flux data and ship a misleading
  // Schedule C / position memo. The lock itself is gated by assertions, but
  // a CPA who unlocks-and-re-edits could break the invariant.
  const assertions = await runLockAssertions(taxYear.id)
  if (assertions.blockingFailures.length > 0) {
    return new Response(
      `Cannot generate dump: ${assertions.blockingFailures.length} blocking assertion${assertions.blockingFailures.length === 1 ? "" : "s"} failing — re-run after resolving`,
      { status: 422 },
    )
  }

  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId: taxYear.id },
    select: { entityType: true },
  })
  const profileEntity = (profile?.entityType ?? "SOLE_PROP") as string
  const effectiveEntity = entityParam ?? profileEntity
  const entityOverride = entityParam !== null && entityParam !== profileEntity

  let buf: Buffer
  try {
    buf = await buildTaxPackage(taxYear.id, { entityOverride: effectiveEntity })
  } catch (e) {
    console.error("[dump] generation failed:", e)
    return new Response(
      "Dump generation failed: " + (e instanceof Error ? e.message : String(e)),
      { status: 500 },
    )
  }

  // Persist Report row + AuditEvent. Overwrite the prior TAX_PACKAGE row so
  // the Documents page surfaces only the latest dump.
  await prisma.$transaction(async (tx) => {
    await tx.report.updateMany({
      where: { taxYearId: taxYear.id, kind: "TAX_PACKAGE", isCurrent: true },
      data: { isCurrent: false },
    })
    await tx.report.create({
      data: {
        taxYearId: taxYear.id,
        kind: "TAX_PACKAGE",
        filePath: `taxlens-${year}-final-dump-${effectiveEntity}.zip`,
        transactionSnapshotHash: taxYear.lockedSnapshotHash,
        isCurrent: true,
      },
    })
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "FINAL_DUMP_GENERATED",
        entityType: "TaxYear",
        entityId: taxYear.id,
        afterState: {
          year,
          entityType: effectiveEntity,
          entityOverride,
          profileEntity,
          bytes: buf.length,
          ledgerHash: taxYear.lockedSnapshotHash,
        },
      },
    })
  })

  const filename = `taxlens-${year}-${effectiveEntity}-${Date.now()}.zip`
  return new Response(new Uint8Array(buf), {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Length": String(buf.length),
    },
  })
}
