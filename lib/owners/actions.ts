"use server"

/**
 * Owner CRUD — server actions for managing K-1 recipients on a TaxYear's
 * BusinessProfile. Used by the per-client Owners panel (Phase 3 follow-up).
 *
 * Invariants:
 *   - ownership values sum to 100 across owners of the same profile (we
 *     warn but allow temporary mid-entry deviations; the K-1 builder
 *     surfaces a [VERIFY] when the sum is off).
 *   - SSN full digits never accepted; only ssnLast4.
 *   - Every mutation writes an AuditEvent so the CPA's per-shareholder
 *     basis tracking is reproducible.
 */

import { z } from "zod"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

const ownerKindSchema = z.enum([
  "OFFICER",
  "SHAREHOLDER",
  "GENERAL_PARTNER",
  "LIMITED_PARTNER",
  "MEMBER",
])

const ownerSchema = z.object({
  profileId: z.string().min(1),
  kind: ownerKindSchema,
  name: z.string().trim().min(1).max(120),
  ssnLast4: z.string().regex(/^\d{4}$/).optional().nullable(),
  ein: z.string().regex(/^\d{9}$/).optional().nullable(),
  ownershipPct: z.number().min(0).max(100),
  w2Wages: z.number().min(0).optional().nullable(),
  guaranteedPayments: z.number().min(0).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
})

export interface OwnerFormInput extends z.infer<typeof ownerSchema> {}

export type OwnerActionResult = { ok: true; id: string } | { ok: false; error: string }

async function assertProfileOwnership(profileId: string, userId: string) {
  const profile = await prisma.businessProfile.findUnique({
    where: { id: profileId },
    select: { userId: true },
  })
  if (!profile) throw new Error("Profile not found")
  if (profile.userId !== userId) throw new Error("Not authorized")
}

export async function addOwner(raw: unknown): Promise<OwnerActionResult> {
  const userId = await getCurrentUserId()
  const parsed = ownerSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }
  }
  await assertProfileOwnership(parsed.data.profileId, userId)

  const owner = await prisma.owner.create({
    data: {
      profileId: parsed.data.profileId,
      kind: parsed.data.kind,
      name: parsed.data.name,
      ssnLast4: parsed.data.ssnLast4 ?? null,
      ein: parsed.data.ein ?? null,
      ownershipPct: parsed.data.ownershipPct,
      w2Wages: parsed.data.w2Wages ?? null,
      guaranteedPayments: parsed.data.guaranteedPayments ?? null,
      notes: parsed.data.notes ?? null,
    },
  })

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "USER",
      eventType: "OWNER_ADDED",
      entityType: "Owner",
      entityId: owner.id,
      afterState: {
        kind: owner.kind,
        name: owner.name,
        ownershipPct: Number(owner.ownershipPct.toString()),
      },
    },
  })

  revalidatePath("/profile")
  return { ok: true, id: owner.id }
}

export async function updateOwner(ownerId: string, raw: unknown): Promise<OwnerActionResult> {
  const userId = await getCurrentUserId()
  const parsed = ownerSchema.partial().safeParse(raw)
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Validation error" }
  }
  const existing = await prisma.owner.findUnique({
    where: { id: ownerId },
    include: { profile: { select: { userId: true } } },
  })
  if (!existing) return { ok: false, error: "Owner not found" }
  if (existing.profile.userId !== userId) return { ok: false, error: "Not authorized" }

  const before = {
    kind: existing.kind,
    name: existing.name,
    ownershipPct: Number(existing.ownershipPct.toString()),
    w2Wages: existing.w2Wages ? Number(existing.w2Wages.toString()) : null,
    guaranteedPayments: existing.guaranteedPayments ? Number(existing.guaranteedPayments.toString()) : null,
  }

  const updated = await prisma.owner.update({
    where: { id: ownerId },
    data: {
      ...(parsed.data.kind !== undefined && { kind: parsed.data.kind }),
      ...(parsed.data.name !== undefined && { name: parsed.data.name }),
      ...(parsed.data.ssnLast4 !== undefined && { ssnLast4: parsed.data.ssnLast4 }),
      ...(parsed.data.ein !== undefined && { ein: parsed.data.ein }),
      ...(parsed.data.ownershipPct !== undefined && { ownershipPct: parsed.data.ownershipPct }),
      ...(parsed.data.w2Wages !== undefined && { w2Wages: parsed.data.w2Wages }),
      ...(parsed.data.guaranteedPayments !== undefined && { guaranteedPayments: parsed.data.guaranteedPayments }),
      ...(parsed.data.notes !== undefined && { notes: parsed.data.notes }),
    },
  })

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "USER",
      eventType: "OWNER_UPDATED",
      entityType: "Owner",
      entityId: updated.id,
      beforeState: before,
      afterState: {
        kind: updated.kind,
        name: updated.name,
        ownershipPct: Number(updated.ownershipPct.toString()),
        w2Wages: updated.w2Wages ? Number(updated.w2Wages.toString()) : null,
        guaranteedPayments: updated.guaranteedPayments ? Number(updated.guaranteedPayments.toString()) : null,
      },
    },
  })

  revalidatePath("/profile")
  return { ok: true, id: updated.id }
}

export async function removeOwner(ownerId: string): Promise<OwnerActionResult> {
  const userId = await getCurrentUserId()
  const existing = await prisma.owner.findUnique({
    where: { id: ownerId },
    include: { profile: { select: { userId: true } } },
  })
  if (!existing) return { ok: false, error: "Owner not found" }
  if (existing.profile.userId !== userId) return { ok: false, error: "Not authorized" }

  await prisma.owner.delete({ where: { id: ownerId } })
  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "USER",
      eventType: "OWNER_REMOVED",
      entityType: "Owner",
      entityId: ownerId,
      beforeState: {
        kind: existing.kind,
        name: existing.name,
        ownershipPct: Number(existing.ownershipPct.toString()),
      },
    },
  })

  revalidatePath("/profile")
  return { ok: true, id: ownerId }
}

/**
 * Returns the current owners list + the sum of ownership percentages.
 * The form spec expects the sum to equal 100; the UI surfaces the delta
 * as a warning. Numbers are floats (Decimal serialized) so the consumer
 * doesn't need to import the Prisma client types.
 */
export async function listOwnersForProfile(profileId: string): Promise<{
  owners: Array<{
    id: string
    kind: string
    name: string
    ssnLast4: string | null
    ein: string | null
    ownershipPct: number
    w2Wages: number | null
    guaranteedPayments: number | null
    notes: string | null
  }>
  ownershipSum: number
}> {
  const userId = await getCurrentUserId()
  await assertProfileOwnership(profileId, userId)
  const rows = await prisma.owner.findMany({
    where: { profileId },
    orderBy: { ownershipPct: "desc" },
  })
  const owners = rows.map((o) => ({
    id: o.id,
    kind: o.kind,
    name: o.name,
    ssnLast4: o.ssnLast4,
    ein: o.ein,
    ownershipPct: Number(o.ownershipPct.toString()),
    w2Wages: o.w2Wages ? Number(o.w2Wages.toString()) : null,
    guaranteedPayments: o.guaranteedPayments ? Number(o.guaranteedPayments.toString()) : null,
    notes: o.notes,
  }))
  const ownershipSum = owners.reduce((a, b) => a + b.ownershipPct, 0)
  return { owners, ownershipSum }
}
