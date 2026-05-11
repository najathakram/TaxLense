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

  await prisma.$transaction(async (tx) => {
    const created = await tx.taxYear.create({
      data: { userId, year, status: "CREATED" },
    })
    if (priorProfile) {
      await tx.businessProfile.create({
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
    }
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "TAXYEAR_CREATED",
        entityType: "TaxYear",
        entityId: created.id,
        afterState: { year, profileCarriedFromYear: priorWithProfile?.year ?? null },
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
