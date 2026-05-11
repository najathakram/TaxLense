"use server"

/**
 * Owner CRUD server actions — per-shareholder / per-partner records that
 * drive K-1 generation, Form 8879 signature delivery, and (eventually)
 * 1099-NEC issuance to owners who also receive contractor pay.
 *
 * Allocation invariant: across all rows for the same (profileId, kind),
 * sum of ownershipPct must equal 100. Application-enforced (Prisma can't
 * do per-group constraints).
 */

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { Prisma } from "@/app/generated/prisma/client"

const OWNER_KINDS = [
  "PROPRIETOR",
  "OFFICER",
  "SHAREHOLDER",
  "GENERAL_PARTNER",
  "LIMITED_PARTNER",
  "MEMBER",
] as const

const SaveOwnerSchema = z.object({
  year: z.number().int().min(2000).max(2100),
  id: z.string().optional(), // present = update; absent = create
  kind: z.enum(OWNER_KINDS),
  name: z.string().min(2).max(120),
  email: z.string().email().optional().nullable(),
  ssnLast4: z
    .string()
    .regex(/^\d{4}$/, "SSN last 4 must be 4 digits")
    .optional()
    .nullable(),
  ein: z
    .string()
    .regex(/^\d{2}-?\d{7}$/, "EIN must be 2-7 digit format")
    .optional()
    .nullable(),
  ownershipPct: z.number().min(0).max(100),
  w2Wages: z.number().min(0).optional().nullable(),
  guaranteedPayments: z.number().min(0).optional().nullable(),
  capitalContribution: z.number().min(0).optional().nullable(),
  distributions: z.number().min(0).optional().nullable(),
  stockBasis: z.number().min(0).optional().nullable(),
  debtBasis: z.number().min(0).optional().nullable(),
  partnerCapitalStart: z.number().optional().nullable(),
  bookTaxDelta: z.number().optional().nullable(),
  addressLine1: z.string().max(120).optional().nullable(),
  addressLine2: z.string().max(120).optional().nullable(),
  city: z.string().max(80).optional().nullable(),
  stateRegion: z.string().max(40).optional().nullable(),
  postalCode: z.string().max(20).optional().nullable(),
  countryCode: z.string().length(2).optional(),
  notes: z.string().max(2000).optional().nullable(),
})

export type SaveOwnerResult = { ok: true; ownerId: string } | { ok: false; error: string }

export async function saveOwner(
  input: z.infer<typeof SaveOwnerSchema>,
): Promise<SaveOwnerResult> {
  const userId = await getCurrentUserId()
  const parsed = SaveOwnerSchema.safeParse(input)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  }
  const data = parsed.data

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year: data.year } },
    include: { businessProfile: true },
  })
  if (!taxYear) return { ok: false, error: "Tax year not found" }
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }
  if (!taxYear.businessProfile) {
    return { ok: false, error: "Business profile required before adding owners" }
  }

  const profileId = taxYear.businessProfile.id
  const writeData = {
    profileId,
    kind: data.kind,
    name: data.name.trim(),
    email: data.email ?? null,
    ssnLast4: data.ssnLast4 ?? null,
    ein: data.ein ?? null,
    ownershipPct: new Prisma.Decimal(data.ownershipPct),
    w2Wages: data.w2Wages != null ? new Prisma.Decimal(data.w2Wages) : null,
    guaranteedPayments:
      data.guaranteedPayments != null ? new Prisma.Decimal(data.guaranteedPayments) : null,
    capitalContribution:
      data.capitalContribution != null ? new Prisma.Decimal(data.capitalContribution) : null,
    distributions:
      data.distributions != null ? new Prisma.Decimal(data.distributions) : null,
    stockBasis: data.stockBasis != null ? new Prisma.Decimal(data.stockBasis) : null,
    debtBasis: data.debtBasis != null ? new Prisma.Decimal(data.debtBasis) : null,
    partnerCapitalStart:
      data.partnerCapitalStart != null ? new Prisma.Decimal(data.partnerCapitalStart) : null,
    bookTaxDelta: data.bookTaxDelta != null ? new Prisma.Decimal(data.bookTaxDelta) : null,
    addressLine1: data.addressLine1 ?? null,
    addressLine2: data.addressLine2 ?? null,
    city: data.city ?? null,
    stateRegion: data.stateRegion ?? null,
    postalCode: data.postalCode ?? null,
    countryCode: data.countryCode ?? "US",
    notes: data.notes ?? null,
  }

  let ownerId: string
  await prisma.$transaction(async (tx) => {
    if (data.id) {
      await tx.owner.update({ where: { id: data.id, profileId }, data: writeData })
      ownerId = data.id
    } else {
      const created = await tx.owner.create({ data: writeData })
      ownerId = created.id
    }
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: data.id ? "OWNER_UPDATED" : "OWNER_CREATED",
        entityType: "Owner",
        entityId: ownerId,
        afterState: { name: data.name, kind: data.kind, ownershipPct: data.ownershipPct },
      },
    })
  })

  revalidatePath(`/years/${data.year}/owners`)
  revalidatePath(`/years/${data.year}/finalize`)
  return { ok: true, ownerId: ownerId! }
}

export async function deleteOwner(
  year: number,
  ownerId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: { businessProfile: true },
  })
  if (!taxYear) return { ok: false, error: "Tax year not found" }
  if (taxYear.status === "LOCKED") return { ok: false, error: "Tax year is locked" }
  if (!taxYear.businessProfile) return { ok: false, error: "No business profile" }

  await prisma.$transaction(async (tx) => {
    const owner = await tx.owner.findUnique({ where: { id: ownerId } })
    if (!owner || owner.profileId !== taxYear.businessProfile!.id) {
      throw new Error("Owner not found or not in this profile")
    }
    await tx.owner.delete({ where: { id: ownerId } })
    await tx.auditEvent.create({
      data: {
        userId: taxYear.userId,
        actorType: "USER",
        eventType: "OWNER_DELETED",
        entityType: "Owner",
        entityId: ownerId,
        beforeState: { name: owner.name, kind: owner.kind, ownershipPct: owner.ownershipPct.toString() },
      },
    })
  })

  revalidatePath(`/years/${year}/owners`)
  revalidatePath(`/years/${year}/finalize`)
  return { ok: true }
}

/** Sum ownership % across all owners of the same kind. Used by the dump
 *  panel + K-1 builder to enforce 100% allocation. */
export async function ownershipSummary(taxYearId: string): Promise<{
  byKind: Record<string, { count: number; sumPct: number }>
  errors: string[]
}> {
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { id: true, entityType: true },
  })
  if (!profile) return { byKind: {}, errors: ["No business profile"] }

  const owners = await prisma.owner.findMany({
    where: { profileId: profile.id, isActive: true },
    select: { kind: true, ownershipPct: true },
  })
  const byKind: Record<string, { count: number; sumPct: number }> = {}
  for (const o of owners) {
    const k = o.kind
    if (!byKind[k]) byKind[k] = { count: 0, sumPct: 0 }
    byKind[k].count++
    byKind[k].sumPct += Number(o.ownershipPct.toString())
  }

  const errors: string[] = []
  // Per-entity allocation rules. Tolerance ±0.01 to absorb rounding.
  const requiresK1Roles: Record<string, string[]> = {
    S_CORP: ["SHAREHOLDER", "OFFICER"],
    LLC_MULTI: ["MEMBER", "GENERAL_PARTNER", "LIMITED_PARTNER"],
    PARTNERSHIP: ["GENERAL_PARTNER", "LIMITED_PARTNER", "MEMBER"],
  }
  const required = requiresK1Roles[profile.entityType]
  if (required) {
    const sum = required.reduce((s, k) => s + (byKind[k]?.sumPct ?? 0), 0)
    if (Math.abs(sum - 100) > 0.01) {
      errors.push(`Allocation across ${required.join(" / ")} is ${sum.toFixed(2)}% (must equal 100.00%)`)
    }
    const totalCount = required.reduce((c, k) => c + (byKind[k]?.count ?? 0), 0)
    if (profile.entityType === "S_CORP" && totalCount === 0) {
      errors.push("S-Corp requires at least one shareholder")
    }
    if ((profile.entityType === "LLC_MULTI" || profile.entityType === "PARTNERSHIP") && totalCount < 2) {
      errors.push("Partnership / LLC-multi requires at least 2 partners")
    }
  }

  return { byKind, errors }
}
