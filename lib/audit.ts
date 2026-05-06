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
import { getAdminCpaContext } from "@/lib/admin/adminContext"
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
  /** Optional explicit override — caller knows the platform admin actor already. */
  actorAdminUserId?: string | null
}

export async function writeAuditEvent(input: AuditEventInput) {
  // CPA actor: explicit override > admin-impersonating-CPA cookie > CPA-impersonating-client cookie.
  // Admin actor: explicit override > admin-impersonating-CPA cookie.
  // Both can be set on the same event (admin → CPA → client chain).
  let actorCpaUserId = input.actorCpaUserId ?? null
  let actorAdminUserId = input.actorAdminUserId ?? null

  if (actorAdminUserId === null || actorCpaUserId === null) {
    const adminCtx = await getAdminCpaContext()
    if (adminCtx) {
      if (actorAdminUserId === null) actorAdminUserId = adminCtx.adminId
      if (actorCpaUserId === null) actorCpaUserId = adminCtx.cpaId
    }
  }

  if (actorCpaUserId === null) {
    const clientCtx = await getClientContext()
    if (clientCtx) actorCpaUserId = clientCtx.cpaId
  }

  return prisma.auditEvent.create({
    data: {
      userId: input.userId ?? null,
      actorCpaUserId,
      actorAdminUserId,
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
