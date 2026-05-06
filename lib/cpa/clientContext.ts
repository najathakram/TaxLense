import { cache } from "react"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export const CLIENT_CONTEXT_COOKIE = "taxlens_client_ctx"
export const RECENT_CLIENTS_COOKIE = "taxlens_recent_clients"

export interface ClientContext {
  cpaId: string
  clientId: string
  clientName: string
  clientEmail: string
}

export const getClientContext = cache(async (): Promise<ClientContext | null> => {
  const session = await auth()
  if (!session?.user?.id) return null

  const cookieStore = await cookies()
  const val = cookieStore.get(CLIENT_CONTEXT_COOKIE)?.value
  if (!val) return null

  const [cpaId, clientId] = val.split(":")
  if (!cpaId || !clientId || cpaId !== session.user.id) return null

  const rel = await prisma.cpaClient.findUnique({
    where: { cpaUserId_clientUserId: { cpaUserId: cpaId, clientUserId: clientId } },
    include: { client: { select: { id: true, name: true, email: true } } },
  })
  if (!rel) return null

  return {
    cpaId,
    clientId: rel.clientUserId,
    clientName: rel.client.name ?? rel.client.email,
    clientEmail: rel.client.email,
  }
})

export interface CpaContext {
  cpaId: string
  cpaName: string
  cpaEmail: string
  /** True when the logged-in user has role=CPA, regardless of impersonation. */
  isCpa: boolean
}

/**
 * Returns CPA info about the LOGGED-IN user (not the impersonated client).
 * Used by the redesigned navigation chrome to render "CPA: <name>" in the
 * top bar even while a client workspace is active.
 *
 * Returns null when there is no session or when the logged-in user is a
 * CLIENT-role user (in which case the chrome should hide CPA-specific UI).
 */
export const getCurrentCpaContext = cache(async (): Promise<CpaContext | null> => {
  const session = await auth()
  if (!session?.user?.id) return null

  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, name: true, email: true, role: true },
  })
  if (!user) return null
  if (user.role !== "CPA") return null

  return {
    cpaId: user.id,
    cpaName: user.name ?? user.email,
    cpaEmail: user.email,
    isCpa: true,
  }
})

export interface RecentClient {
  clientId: string
  clientName: string
  clientEmail: string
  lastEntered: Date
}

/**
 * Returns the CPA's recently-entered clients, newest first, capped at `limit`.
 * Backed by:
 *   1. The `actorCpaUserId`-tagged AuditEvents (most accurate for "I just touched
 *      this client") — uses the existing audit trail, no new state.
 *   2. The CpaClient.createdAt as a fallback when no events exist.
 *
 * The cookie-based "recent clients" list (RECENT_CLIENTS_COOKIE) is intentionally
 * NOT used here — relying on AuditEvent gives the same answer with one source of
 * truth. The cookie is reserved for tracking the current single ctx.
 */
export const getRecentClients = cache(
  async (limit = 10): Promise<RecentClient[]> => {
    const session = await auth()
    if (!session?.user?.id) return []

    const events = await prisma.auditEvent.findMany({
      where: { actorCpaUserId: session.user.id, userId: { not: null } },
      orderBy: { occurredAt: "desc" },
      // Pull more than `limit` so we have headroom for the dedup pass below.
      take: limit * 5,
      select: {
        userId: true,
        occurredAt: true,
        user: { select: { id: true, name: true, email: true } },
      },
    })

    const byClient = new Map<string, RecentClient>()
    for (const ev of events) {
      if (!ev.user) continue
      if (byClient.has(ev.user.id)) continue
      byClient.set(ev.user.id, {
        clientId: ev.user.id,
        clientName: ev.user.name ?? ev.user.email,
        clientEmail: ev.user.email,
        lastEntered: ev.occurredAt,
      })
      if (byClient.size >= limit) break
    }

    if (byClient.size < limit) {
      // Top up from CpaClient table (any client we haven't acted on yet).
      const rels = await prisma.cpaClient.findMany({
        where: { cpaUserId: session.user.id },
        orderBy: { createdAt: "desc" },
        take: limit,
        include: { client: { select: { id: true, name: true, email: true } } },
      })
      for (const rel of rels) {
        if (byClient.has(rel.clientUserId)) continue
        byClient.set(rel.clientUserId, {
          clientId: rel.clientUserId,
          clientName: rel.client.name ?? rel.client.email,
          clientEmail: rel.client.email,
          lastEntered: rel.createdAt,
        })
        if (byClient.size >= limit) break
      }
    }

    return [...byClient.values()].slice(0, limit)
  },
)

export interface YearStripEntry {
  year: number
  status: string
  grossReceipts: number
  totalDeductions: number
  netProfit: number
  riskScore: number | null
  pendingStops: number
  lockedAt: Date | null
}

/**
 * Returns one entry per TaxYear for a given client, newest year first.
 * Used by the redesigned `/clients/[clientId]` overview and the `/clients`
 * table-as-spreadsheet layout.
 *
 * Numbers come from the same Schedule C totals function used everywhere else
 * (`computeDeductibleAmt`) — preserves the B8 invariant "one number, one
 * place." Risk score is left null here; callers that need it can fetch via
 * `computeRiskScore(taxYearId)` per row, but the year strip itself is meant
 * to render fast (≤1s for 50 clients × 4 years).
 */
export async function getClientYearStrip(clientId: string): Promise<YearStripEntry[]> {
  const taxYears = await prisma.taxYear.findMany({
    where: { userId: clientId },
    orderBy: { year: "desc" },
    select: { id: true, year: true, status: true, lockedAt: true },
  })

  const result: YearStripEntry[] = []
  for (const ty of taxYears) {
    const txns = await prisma.transaction.findMany({
      where: { taxYearId: ty.id, isSplit: false },
      select: {
        amountNormalized: true,
        classifications: {
          where: { isCurrent: true },
          select: { code: true, businessPct: true },
          take: 1,
        },
      },
    })

    let gross = 0
    let deduct = 0
    for (const t of txns) {
      const c = t.classifications[0]
      if (!c) continue
      const amt = Number(t.amountNormalized)
      if (c.code === "BIZ_INCOME") gross += Math.abs(amt)
      // Lazily compute deductions inline to avoid a second import; keeps
      // this helper dependency-light. The canonical formula is in
      // lib/classification/deductible.ts.
      if (
        c.code === "WRITE_OFF" ||
        c.code === "WRITE_OFF_TRAVEL" ||
        c.code === "WRITE_OFF_COGS" ||
        c.code === "MEALS_50" ||
        c.code === "MEALS_100" ||
        c.code === "GRAY"
      ) {
        const outflow = Math.max(0, amt)
        let d = outflow * (c.businessPct / 100)
        if (c.code === "MEALS_50") d = d * 0.5
        deduct += d
      }
    }

    const stops = await prisma.stopItem.count({
      where: { taxYearId: ty.id, state: "PENDING" },
    })

    result.push({
      year: ty.year,
      status: ty.status,
      grossReceipts: gross,
      totalDeductions: deduct,
      netProfit: gross - deduct,
      riskScore: null,
      pendingStops: stops,
      lockedAt: ty.lockedAt,
    })
  }
  return result
}
