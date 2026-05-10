/**
 * GET /api/years/[year]/current-hash
 *
 * Returns the live ledger SHA-256 hash for this TaxYear, plus the persisted
 * `lockedSnapshotHash` (if locked) so the client can detect drift between
 * the locked snapshot and the current ledger state.
 *
 * Why this exists: the master-ledger XLSX, audit packet, and tax package
 * all stamp their footers with `lockedSnapshotHash`. If a CPA edits a
 * classification on a LOCKED year, the underlying data drifts but the
 * cached XLSX still claims the old hash — silent staleness. This endpoint
 * lets the Finalize page show a "ledger has drifted from snapshot" banner
 * before the CPA hands a stale Schedule C to a client.
 */

import { NextResponse } from "next/server"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { computeLedgerHash } from "@/lib/lock/hash"

interface Params {
  params: Promise<{ year: string }>
}

export async function GET(_req: Request, { params }: Params) {
  const { year: yearParam } = await params
  const year = parseInt(yearParam, 10)
  if (Number.isNaN(year)) {
    return NextResponse.json({ error: "invalid year" }, { status: 400 })
  }

  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, status: true, lockedAt: true, lockedSnapshotHash: true },
  })
  if (!taxYear) {
    return NextResponse.json({ error: "not found" }, { status: 404 })
  }

  const currentHash = await computeLedgerHash(taxYear.id)
  const drifted = !!(taxYear.lockedSnapshotHash && currentHash !== taxYear.lockedSnapshotHash)

  return NextResponse.json({
    taxYearId: taxYear.id,
    status: taxYear.status,
    lockedAt: taxYear.lockedAt?.toISOString() ?? null,
    lockedSnapshotHash: taxYear.lockedSnapshotHash,
    currentHash,
    drifted,
  })
}
