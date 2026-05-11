/**
 * Server-side helper: load all the data the deliverable registry needs to
 * compute the dump panel for a given tax year.
 *
 * One DB read per panel render — the buildDeliverableList output is fully
 * derivable from this context, so the panel can re-evaluate reactively
 * (entity dropdown change) without another round-trip.
 */

import { prisma } from "@/lib/db"
import {
  type LedgerSummary,
  type OwnerSummary,
  type EntityType,
} from "@/lib/forms/deliverables"
import { runLockAssertions } from "@/lib/validation/assertions"
import { computeDeductibleAmt } from "@/lib/classification/deductible"
import { inYearWindow } from "@/lib/queries/yearWindow"

export interface LoadedDeliverableContext {
  taxYearId: string
  taxYear: number
  /** Profile-recorded entity — used as the dropdown default. */
  defaultEntityType: EntityType
  state: string
  ledger: LedgerSummary
  owners: OwnerSummary
  assertionsPass: boolean
  /** Pre-rendered status text for the panel header. */
  assertionStatusText: string
}

export async function loadDeliverableContext(
  taxYearId: string,
): Promise<LoadedDeliverableContext> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { id: true, year: true },
  })
  const yearWindow = inYearWindow(ty.year)

  const [profile, txns, assertions] = await Promise.all([
    prisma.businessProfile.findUnique({
      where: { taxYearId },
      select: {
        entityType: true,
        primaryState: true,
        homeOfficeConfig: true,
      },
    }),
    prisma.transaction.findMany({
      where: { taxYearId, isSplit: false, isStale: false, ...yearWindow },
      include: { classifications: { where: { isCurrent: true }, take: 1 } },
    }),
    runLockAssertions(taxYearId),
  ])

  let grossReceipts = 0
  let totalDeductions = 0
  let hasCOGS = false
  let hasDepreciation = false
  // Aggregate contractor candidates by counterparty (Line 11 Contract Labor)
  const contractorTotals = new Map<string, number>()
  let has1099MiscCandidate = false

  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const amt = Number(t.amountNormalized.toString())

    if (c.code === "BIZ_INCOME") {
      grossReceipts += Math.abs(amt)
    } else if (
      c.code === "WRITE_OFF" ||
      c.code === "WRITE_OFF_TRAVEL" ||
      c.code === "WRITE_OFF_COGS" ||
      c.code === "MEALS_50" ||
      c.code === "MEALS_100" ||
      c.code === "GRAY"
    ) {
      totalDeductions += computeDeductibleAmt(Math.abs(amt), c.code, c.businessPct)
    }

    if (c.scheduleCLine?.toLowerCase().includes("part iii cogs")) hasCOGS = true
    if (c.scheduleCLine?.toLowerCase().includes("depreciation") || c.scheduleCLine?.includes("Line 13")) {
      hasDepreciation = true
    }

    // Contract Labor → 1099-NEC candidate
    if (c.scheduleCLine?.toLowerCase().includes("line 11") || c.scheduleCLine?.toLowerCase().includes("contract labor")) {
      // Best-effort counterparty extraction — uses raw merchant; the
      // dedicated counterparty extractor (lib/pairing/p2pRoundTrip.ts)
      // could be reused here but keep this lightweight.
      const key = t.merchantRaw.trim().slice(0, 80) || "(unknown payee)"
      contractorTotals.set(key, (contractorTotals.get(key) ?? 0) + Math.abs(amt))
    }

    // 1099-MISC: rents, royalties (Line 20a-b)
    if (
      c.scheduleCLine?.toLowerCase().includes("line 20") ||
      c.scheduleCLine?.toLowerCase().includes("rent") ||
      c.scheduleCLine?.toLowerCase().includes("royalt")
    ) {
      if (Math.abs(amt) >= 600) has1099MiscCandidate = true
    }
  }

  const netProfit = grossReceipts - totalDeductions

  // Net SE earnings — Schedule SE Line 2 = Schedule C Line 31 × 92.35%
  const netSeEarnings = Math.max(0, netProfit * 0.9235)

  const homeOffice = (profile?.homeOfficeConfig ?? {}) as {
    has?: boolean
    method?: string
  }

  // Owners — the schema doesn't yet have a dedicated Owner model. Until P3
  // ships per-shareholder records, we default to "1 owner, the taxpayer".
  // For SOLE_PROP / LLC_SINGLE this is structurally correct; for S_CORP /
  // LLC_MULTI the panel surfaces a blocker pointing to the Shareholder
  // setup work P3 will deliver.
  const owners: OwnerSummary = {
    count: 1,
    allOwnersComplete: true,
  }

  const contractorCandidates: LedgerSummary["contractorCandidates"] = Array.from(
    contractorTotals.entries(),
  ).map(([payee, total]) => ({
    payee,
    totalDollars: total,
    // Until W-9 capture lands (P5), assume TIN missing for any candidate.
    // The blocker on the dump panel is the explicit prompt for the CPA
    // to gather W-9s before generation.
    missingTin: true,
  }))

  const ledger: LedgerSummary = {
    grossReceipts,
    totalDeductions,
    netProfit,
    totalAssets: grossReceipts, // proxy until full B/S landed
    hasCOGS,
    hasDepreciation,
    hasHomeOffice: !!homeOffice.has,
    homeOfficeMethod: homeOffice.method === "ACTUAL"
      ? "ACTUAL"
      : homeOffice.method === "SIMPLIFIED"
        ? "SIMPLIFIED"
        : null,
    netSeEarnings,
    payrollRunCount: 0, // payroll integration deferred
    contractorCandidates,
    has1099MiscCandidate,
  }

  const assertionStatusText = assertions.blockingFailures.length === 0
    ? "Lock assertions: all passing"
    : `${assertions.blockingFailures.length} blocking assertion${assertions.blockingFailures.length === 1 ? "" : "s"} — resolve before lock`

  return {
    taxYearId: ty.id,
    taxYear: ty.year,
    defaultEntityType: (profile?.entityType ?? "SOLE_PROP") as EntityType,
    state: profile?.primaryState ?? "",
    ledger,
    owners,
    assertionsPass: assertions.blockingFailures.length === 0,
    assertionStatusText,
  }
}
