"use server"

/**
 * TaxLens — Onboarding wizard server actions
 * Spec §4.1 (Phase 0 Profile Capture) + §8 (Universal Questions)
 *
 * Each saveStepN validates server-side with Zod, upserts the relevant
 * portion of BusinessProfile, and advances draftStep.
 * finalizeOnboarding transitions TaxYear.status CREATED → INGESTION.
 */

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import type { ActionResult, TripFormData, KnownEntityFormData, IncomeSourceFormData } from "./types"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function getActiveProfile(userId: string) {
  return prisma.businessProfile.findFirst({
    where: { userId, taxYear: { status: "CREATED" } },
    include: { taxYear: true },
    orderBy: { createdAt: "desc" },
  })
}

async function advanceDraftStep(profileId: string, step: number) {
  await prisma.businessProfile.update({
    where: { id: profileId },
    data: {
      draftStep: { set: step },
    },
  })
}

// ---------------------------------------------------------------------------
// Step 1 — Basics (year, entity type, state, accounting method, first year)
// ---------------------------------------------------------------------------

const step1Schema = z.object({
  year: z.number().int().min(2020).max(2030),
  entityType: z.enum(["SOLE_PROP", "LLC_SINGLE"]),
  primaryState: z.string().min(2).max(2),
  accountingMethod: z.enum(["CASH", "ACCRUAL"]),
  firstYear: z.boolean(),
})

export async function saveStep1(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = step1Schema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }
  const { year, entityType, primaryState, accountingMethod, firstYear } = parsed.data

  // Find the latest active rule version
  const ruleVersion = await prisma.ruleVersion.findFirst({
    where: { supersededById: null },
    orderBy: { effectiveDate: "desc" },
  })

  // Upsert TaxYear for the selected year
  const taxYear = await prisma.taxYear.upsert({
    where: { userId_year: { userId, year } },
    create: { userId, year, status: "CREATED", ruleVersionId: ruleVersion?.id ?? null },
    update: {},
  })

  // Upsert BusinessProfile with step 1 fields; nullable fields filled in later steps
  await prisma.businessProfile.upsert({
    where: { taxYearId: taxYear.id },
    create: {
      userId,
      taxYearId: taxYear.id,
      entityType,
      primaryState,
      accountingMethod,
      firstYear,
      draftStep: 2,
      homeOfficeConfig: { has: false },
      vehicleConfig: { has: false },
    },
    update: {
      entityType,
      primaryState,
      accountingMethod,
      firstYear,
      draftStep: 2,
    },
  })

  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 2 — Business description + NAICS
// ---------------------------------------------------------------------------

const step2Schema = z.object({
  businessDescription: z.string().min(5, "Please describe your business (at least 5 characters)").max(500),
  naicsCode: z.string().regex(/^\d{6}$/, "NAICS code must be exactly 6 digits"),
})

export async function saveStep2(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = step2Schema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }
  const { businessDescription, naicsCode } = parsed.data

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found. Please complete Step 1 first." }

  await prisma.businessProfile.update({
    where: { id: profile.id },
    data: {
      businessDescription,
      naicsCode,
      draftStep: Math.max(profile.draftStep, 3),
    },
  })

  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 3 — Revenue streams + gross receipts estimate
// ---------------------------------------------------------------------------

const step3Schema = z.object({
  revenueStreams: z.array(z.string()).min(1, "Select at least one revenue stream"),
  grossReceiptsEstimate: z.number().min(0, "Must be 0 or greater"),
})

export async function saveStep3(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = step3Schema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }
  const { revenueStreams, grossReceiptsEstimate } = parsed.data

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found." }

  await prisma.businessProfile.update({
    where: { id: profile.id },
    data: {
      revenueStreams,
      grossReceiptsEstimate: grossReceiptsEstimate.toString(),
      draftStep: Math.max(profile.draftStep, 4),
    },
  })

  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 4 — Home office
// ---------------------------------------------------------------------------

const homeOfficeSchema = z.object({
  has: z.boolean(),
  dedicated: z.boolean().optional(),
  officeSqft: z.number().int().positive().optional(),
  homeSqft: z.number().int().positive().optional(),
}).refine(
  (d) => !d.has || (d.officeSqft !== undefined && d.homeSqft !== undefined),
  { message: "Office and home square footage required when home office is selected" }
)

export async function saveStep4(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = homeOfficeSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found." }

  await prisma.businessProfile.update({
    where: { id: profile.id },
    data: {
      homeOfficeConfig: parsed.data,
      draftStep: Math.max(profile.draftStep, 5),
    },
  })

  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 5 — Vehicle
// ---------------------------------------------------------------------------

const vehicleSchema = z.object({
  has: z.boolean(),
  bizPct: z.number().int().min(0).max(100, "Business use cannot exceed 100%").optional(),
}).refine(
  (d) => !d.has || d.bizPct !== undefined,
  { message: "Business use percentage required when vehicle is selected" }
)

export async function saveStep5(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = vehicleSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found." }

  await prisma.businessProfile.update({
    where: { id: profile.id },
    data: {
      vehicleConfig: parsed.data,
      draftStep: Math.max(profile.draftStep, 6),
    },
  })

  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 6 — Inventory
// ---------------------------------------------------------------------------

const inventorySchema = z.object({
  has: z.boolean(),
  physical: z.boolean().optional(),
  dropship: z.boolean().optional(),
}).nullable()

export async function saveStep6(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = inventorySchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found." }

  await prisma.businessProfile.update({
    where: { id: profile.id },
    data: {
      inventoryConfig: parsed.data ?? undefined,
      draftStep: Math.max(profile.draftStep, 7),
    },
  })

  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 7 — Trips (replace full list)
// ---------------------------------------------------------------------------

const tripSchema = z.object({
  name: z.string().min(1, "Trip name required"),
  destination: z.string().min(1, "Destination required"),
  startDate: z.string().min(1, "Start date required"),
  endDate: z.string().min(1, "End date required"),
  purpose: z.string().min(5, "Describe the business purpose (at least 5 characters)"),
  deliverableDescription: z.string().optional(),
  isConfirmed: z.boolean(),
}).refine(
  (d) => new Date(d.endDate) >= new Date(d.startDate),
  { message: "End date must be on or after start date", path: ["endDate"] }
)

const step7Schema = z.object({
  trips: z.array(tripSchema),
})

export async function saveStep7(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = step7Schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? "Validation error" }
  }

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found." }

  // Replace trips list (delete + recreate)
  await prisma.trip.deleteMany({ where: { profileId: profile.id } })
  if (parsed.data.trips.length > 0) {
    await prisma.trip.createMany({
      data: parsed.data.trips.map((t: TripFormData) => ({
        profileId: profile.id,
        name: t.name,
        destination: t.destination,
        startDate: new Date(t.startDate),
        endDate: new Date(t.endDate),
        purpose: t.purpose,
        deliverableDescription: t.deliverableDescription ?? null,
        isConfirmed: t.isConfirmed,
      })),
    })
  }

  await advanceDraftStep(profile.id, Math.max(profile.draftStep, 8))
  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 8 — Known entities (replace full list)
// ---------------------------------------------------------------------------

const knownEntitySchema = z.object({
  kind: z.enum(["PERSON_PERSONAL", "PERSON_CONTRACTOR", "PERSON_CLIENT", "PATTERN_EXCLUDED", "PATTERN_INCOME"]),
  displayName: z.string().min(1, "Display name required"),
  matchKeywords: z.array(z.string().min(1)).min(1, "At least one match keyword required"),
  defaultCode: z.string().nullable().optional(),
  notes: z.string().optional(),
})

const step8Schema = z.object({
  knownEntities: z.array(knownEntitySchema),
})

export async function saveStep8(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = step8Schema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { ok: false, error: issue?.message ?? "Validation error" }
  }

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found." }

  // Replace known entities list (delete + recreate)
  await prisma.knownEntity.deleteMany({ where: { profileId: profile.id } })
  if (parsed.data.knownEntities.length > 0) {
    await prisma.knownEntity.createMany({
      data: parsed.data.knownEntities.map((e: KnownEntityFormData) => ({
        profileId: profile.id,
        kind: e.kind,
        displayName: e.displayName,
        matchKeywords: e.matchKeywords,
        defaultCode: (e.defaultCode as Parameters<typeof prisma.knownEntity.create>[0]["data"]["defaultCode"]) ?? null,
        notes: e.notes ?? null,
      })),
    })
  }

  await advanceDraftStep(profile.id, Math.max(profile.draftStep, 9))
  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Step 9 — Expected income sources
// ---------------------------------------------------------------------------

const incomeSourceSchema = z.object({
  platform: z.string().min(1, "Platform name required"),
  expectedTotal: z.number().min(0, "Expected total must be 0 or greater"),
  categories: z.array(z.string()),
})

const step9Schema = z.object({
  incomeSources: z.array(incomeSourceSchema),
})

export async function saveStep9(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = step9Schema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found." }

  await prisma.businessProfile.update({
    where: { id: profile.id },
    data: {
      incomeSources: parsed.data.incomeSources satisfies IncomeSourceFormData[],
      draftStep: Math.max(profile.draftStep, 10),
    },
  })

  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Finalize — advances TaxYear.status CREATED → INGESTION
// ---------------------------------------------------------------------------

export async function finalizeOnboarding(): Promise<ActionResult> {
  const userId = await getCurrentUserId()

  const profile = await getActiveProfile(userId)
  if (!profile) return { ok: false, error: "Profile not found." }

  // Validate required fields are complete
  if (!profile.naicsCode) return { ok: false, error: "NAICS code is required. Please complete Step 2." }
  if (!profile.businessDescription) return { ok: false, error: "Business description is required. Please complete Step 2." }

  await prisma.taxYear.update({
    where: { id: profile.taxYear.id },
    data: { status: "INGESTION" },
  })

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "USER",
      eventType: "ONBOARDING_COMPLETE",
      entityType: "BusinessProfile",
      entityId: profile.id,
      afterState: { taxYearStatus: "INGESTION", year: profile.taxYear.year },
    },
  })

  revalidatePath("/dashboard")
  revalidatePath("/onboarding")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Profile edit — called from /profile page; saves any step + writes AuditEvent
// ---------------------------------------------------------------------------

export async function saveProfileEdit(step: number, raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()

  // Delegate to the appropriate step save
  let result: ActionResult
  switch (step) {
    case 1: result = await saveStep1(raw); break
    case 2: result = await saveStep2(raw); break
    case 3: result = await saveStep3(raw); break
    case 4: result = await saveStep4(raw); break
    case 5: result = await saveStep5(raw); break
    case 6: result = await saveStep6(raw); break
    case 7: result = await saveStep7(raw); break
    case 8: result = await saveStep8(raw); break
    case 9: result = await saveStep9(raw); break
    default: return { ok: false, error: "Invalid step" }
  }

  if (result.ok) {
    const profile = await getActiveProfile(userId)
    if (profile) {
      await prisma.auditEvent.create({
        data: {
          userId,
          actorType: "USER",
          eventType: "PROFILE_EDITED",
          entityType: "BusinessProfile",
          entityId: profile.id,
          afterState: { step, updatedAt: new Date().toISOString() },
        },
      })
    }
    revalidatePath("/profile")
  }

  return result
}

// ---------------------------------------------------------------------------
// Edit legal name — sole field on User row that the wizard didn't cover.
// Used by the redesigned profile screen so a CPA can fix a misspelled client
// name without an SQL operator. Honors getCurrentUserId so it writes to the
// impersonated client when the CPA has entered the client session.
// ---------------------------------------------------------------------------

const legalNameSchema = z.object({ name: z.string().trim().min(1).max(120) })

export async function saveLegalName(raw: unknown): Promise<ActionResult> {
  const userId = await getCurrentUserId()
  const parsed = legalNameSchema.safeParse(raw)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }

  const before = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } })
  if (!before) return { ok: false, error: "User not found" }
  if (before.name === parsed.data.name) return { ok: true }

  await prisma.user.update({
    where: { id: userId },
    data: { name: parsed.data.name },
  })
  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "USER",
      eventType: "LEGAL_NAME_EDITED",
      entityType: "User",
      entityId: userId,
      beforeState: { name: before.name },
      afterState: { name: parsed.data.name },
    },
  })

  revalidatePath("/profile")
  return { ok: true }
}
