/**
 * Audit-event helper that automatically captures the CPA actor when one is
 * impersonating a client.
 *
 * Why this exists: AuditEvent.userId stores the *taxpayer-owner* of the
 * changed data. When a CPA is acting on behalf of that taxpayer, we ALSO want
 * the CPA's id recorded — that's what `actorCpaUserId` is for. Without this
 * helper every AuditEvent.create call would need to fetch the cookie context
 * by hand.
 *
 * Usage: replace `prisma.auditEvent.create({ data: {...} })` with
 * `writeAuditEvent({...})`. The function reads the current request's session
 * + cookie context and adds `actorCpaUserId` automatically.
 *
 * Backwards-compatible: every field passed in is preserved verbatim.
 */
import { prisma } from "@/lib/db"
import { getClientContext } from "@/lib/cpa/clientContext"
import type { Prisma, ActorType } from "@/app/generated/prisma/client"

export interface AuditEventInput {
  userId?: string | null
  actorType: ActorType
  eventType: string
  entityType: string
  entityId?: string | null
  beforeState?: Prisma.InputJsonValue
  afterState?: Prisma.InputJsonValue
  rationale?: string | null
  /** Optional explicit override — caller knows the CPA actor already. */
  actorCpaUserId?: string | null
}

export async function writeAuditEvent(input: AuditEventInput) {
  // If the caller supplied an explicit CPA actor, trust it.
  // Otherwise, derive from the cookie-based client context.
  let actorCpaUserId = input.actorCpaUserId ?? null
  if (actorCpaUserId === null) {
    const ctx = await getClientContext()
    if (ctx) actorCpaUserId = ctx.cpaId
  }

  return prisma.auditEvent.create({
    data: {
      userId: input.userId ?? null,
      actorCpaUserId,
      actorType: input.actorType,
      eventType: input.eventType,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      ...(input.beforeState !== undefined ? { beforeState: input.beforeState } : {}),
      ...(input.afterState !== undefined ? { afterState: input.afterState } : {}),
      rationale: input.rationale ?? null,
    },
  })
}
