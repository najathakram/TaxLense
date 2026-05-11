"use server"

/**
 * Create a new TaxYear for the active client/user (B-14).
 *
 * Pre-fix: dashboard "+ New tax year" linked to /onboarding which dropped
 * returning users mid-wizard. Now there's a dedicated route that takes a
 * year, creates a TaxYear if it doesn't already exist, and routes to
 * /years/{year}/upload so the user can start ingesting statements.
 *
 * Profile carryover: if the active user has a BusinessProfile from the most
 * recent prior year, we clone its non-year-specific fields into the new
 * year so the user doesn't have to re-walk the wizard. Trips and known
 * entities are NOT carried (year-specific by definition).
 */

import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { revalidatePath } from "next/cache"
import { getCurrentUserId } from "@/lib/auth"
import {
  computeCarryforwardFromYear,
  persistCarryforwardTo,
} from "@/lib/carryforward/compute"

export interface CreateTaxYearResult {
  ok: boolean
  error?: string
  year?: number
}

export async function createTaxYear(yearStr: string): Promise<CreateTaxYearResult> {
  const userId = await getCurrentUserId()
  const year = parseInt(yearStr, 10)
  if (!Number.isInteger(year)) return { ok: false, error: "Year must be a whole number" }
  const currentYear = new Date().getUTCFullYear()
  if (year < currentYear - 6 || year > currentYear + 1) {
    return { ok: false, error: `Year must be between ${currentYear - 6} and ${currentYear + 1}` }
  }

  // Idempotent: if the year already exists, just route there.
  const existing = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true },
  })
  if (existing) {
    revalidatePath("/dashboard")
    redirect(`/years/${year}/upload`)
  }

  // Carry the most recent prior profile forward (B-14: continuity).
  const priorWithProfile = await prisma.taxYear.findFirst({
    where: { userId, year: { lt: year } },
    orderBy: { year: "desc" },
    include: { businessProfile: true },
  })
  const priorProfile = priorWithProfile?.businessProfile ?? null

  // Pull owners + known entities to roll forward (Phase 5.1 leftover-fix).
  // MerchantRules are intentionally NOT rolled forward — they're year-specific
  // by design (the CPA agent re-derives them each year); auto-copying would
  // lock in stale codings.
  let priorOwners: Awaited<ReturnType<typeof prisma.owner.findMany>> = []
  let priorKnownEntities: Awaited<ReturnType<typeof prisma.knownEntity.findMany>> = []
  if (priorProfile) {
    priorOwners = await prisma.owner.findMany({ where: { profileId: priorProfile.id, isActive: true } })
    priorKnownEntities = await prisma.knownEntity.findMany({
      where: { profileId: priorProfile.id },
    }).catch(() => [])
  }

  await prisma.$transaction(async (tx) => {
    const created = await tx.taxYear.create({
      data: { userId, year, status: "CREATED" },
    })
    let newProfileId: string | null = null
    if (priorProfile) {
      const newProfile = await tx.businessProfile.create({
        data: {
          userId,
          taxYearId: created.id,
          entityType: priorProfile.entityType,
          naicsCode: priorProfile.naicsCode,
          businessDescription: priorProfile.businessDescription,
          primaryState: priorProfile.primaryState,
          accountingMethod: priorProfile.accountingMethod,
          firstYear: false, // can never be first-year if a prior year exists
          revenueStreams: priorProfile.revenueStreams,
          grossReceiptsEstimate: priorProfile.grossReceiptsEstimate,
          homeOfficeConfig: (priorProfile.homeOfficeConfig ?? { has: false }) as never,
          vehicleConfig: (priorProfile.vehicleConfig ?? { has: false }) as never,
          inventoryConfig: priorProfile.inventoryConfig ?? undefined,
          incomeSources: priorProfile.incomeSources ?? undefined,
          // draftStep stays at the default (1) so the user can re-walk if
          // anything changed (e.g. moved states); they won't be forced to.
        },
      })
      newProfileId = newProfile.id

      // Roll forward Owners — same names/SSN/EIN/ownership %. Year-specific
      // values (capitalContribution, distributions, w2Wages) reset to null
      // since they're per-year cash flows.
      for (const o of priorOwners) {
        await tx.owner.create({
          data: {
            profileId: newProfile.id,
            kind: o.kind,
            name: o.name,
            email: o.email,
            ssnLast4: o.ssnLast4,
            ein: o.ein,
            ownershipPct: o.ownershipPct,
            addressLine1: o.addressLine1,
            addressLine2: o.addressLine2,
            city: o.city,
            stateRegion: o.stateRegion,
            postalCode: o.postalCode,
            countryCode: o.countryCode,
            // Year-start basis carries forward from prior year-end (via
            // PriorYearContext.shareholderBasis / .partnerCapital), so we
            // don't copy the prior-year values here — those were the prior
            // year's roll-forward state.
            stockBasis: null,
            debtBasis: null,
            partnerCapitalStart: null,
            isActive: true,
          },
        })
      }

      // Roll forward KnownEntities — names/keywords for known clients,
      // contractors, exclusion patterns. Durable client information.
      for (const k of priorKnownEntities) {
        await tx.knownEntity.create({
          data: {
            profileId: newProfile.id,
            kind: k.kind,
            displayName: k.displayName,
            matchKeywords: k.matchKeywords,
            defaultCode: k.defaultCode,
            notes: k.notes,
          },
        })
      }
    }
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "TAXYEAR_CREATED",
        entityType: "TaxYear",
        entityId: created.id,
        afterState: {
          year,
          profileCarriedFromYear: priorWithProfile?.year ?? null,
          ownersCarried: priorOwners.length,
          knownEntitiesCarried: priorKnownEntities.length,
          newProfileId,
        },
      },
    })
  })

  // Phase G: if the immediately-prior year is LOCKED, pull its carryforward
  // into the new year's PriorYearContext so NOL / depreciation / basis /
  // capital balances flow through automatically. Best-effort.
  if (priorWithProfile?.status === "LOCKED") {
    try {
      const created = await prisma.taxYear.findUniqueOrThrow({
        where: { userId_year: { userId, year } },
      })
      const computed = await computeCarryforwardFromYear(priorWithProfile.id)
      await persistCarryforwardTo(created.id, priorWithProfile.id, computed)
    } catch (e) {
      console.error("[createTaxYear] carryforward population failed:", e)
    }
  }

  revalidatePath("/dashboard")
  redirect(`/years/${year}/upload`)
}
