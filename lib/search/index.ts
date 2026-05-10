"use server"

/**
 * Universal search (B-15) — wires the previously-decorative ⌘K bar.
 *
 * Three result types: clients (CPA-tier only), tax years, transactions.
 * Each search function returns up to `limit` matches; the modal renders
 * them grouped. Keep this fast and read-only — no AI calls.
 */

import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { getCurrentCpaContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"

export interface SearchResultClient {
  kind: "client"
  id: string
  name: string
  email: string
}

export interface SearchResultYear {
  kind: "year"
  taxYearId: string
  year: number
  ownerId: string
  ownerName: string
  status: string
}

export interface SearchResultTxn {
  kind: "txn"
  id: string
  taxYearId: string
  year: number
  ownerId: string
  postedDate: string
  merchantRaw: string
  merchantNormalized: string | null
  amountNormalized: number
  code: string | null
}

export type SearchResult = SearchResultClient | SearchResultYear | SearchResultTxn

export interface SearchResults {
  clients: SearchResultClient[]
  years: SearchResultYear[]
  transactions: SearchResultTxn[]
}

const LIMIT = 8

export async function search(rawQuery: string): Promise<SearchResults> {
  const q = rawQuery.trim()
  if (q.length < 2) return { clients: [], years: [], transactions: [] }

  const userId = await getCurrentUserId()
  const cpaCtx = await getCurrentCpaContext()
  const adminCpaCtx = await getAdminCpaContext()
  const cpaUserId = adminCpaCtx?.cpaId ?? cpaCtx?.cpaId ?? null

  // Search scope:
  //   - CLIENT tier  → own data only (userId == self)
  //   - CPA tier     → own data + every client this CPA represents
  // We compute the "in-scope user IDs" once so transaction search is a
  // single query.
  const scopeUserIds: string[] = [userId]
  if (cpaUserId) {
    const rels = await prisma.cpaClient.findMany({
      where: { cpaUserId },
      select: { clientUserId: true },
    })
    for (const r of rels) scopeUserIds.push(r.clientUserId)
  }

  // ── Clients (CPA only) ────────────────────────────────────────────────
  let clients: SearchResultClient[] = []
  if (cpaUserId) {
    const rels = await prisma.cpaClient.findMany({
      where: {
        cpaUserId,
        OR: [
          { displayName: { contains: q, mode: "insensitive" } },
          { client: { name: { contains: q, mode: "insensitive" } } },
          { client: { email: { contains: q, mode: "insensitive" } } },
        ],
      },
      include: { client: { select: { id: true, name: true, email: true } } },
      take: LIMIT,
    })
    clients = rels.map((r) => ({
      kind: "client",
      id: r.client.id,
      name: r.displayName ?? r.client.name ?? r.client.email,
      email: r.client.email,
    }))
  }

  // ── Tax years ─────────────────────────────────────────────────────────
  // Match on the year string (e.g. "2025" or "25") or on the owner's name/email.
  const yearMatch = q.match(/\b(20\d{2}|\d{2})\b/)
  const yearNum = yearMatch
    ? Number(yearMatch[1]!.length === 2 ? "20" + yearMatch[1]! : yearMatch[1]!)
    : null
  const yearWhereOR: Array<Record<string, unknown>> = []
  if (yearNum) yearWhereOR.push({ year: yearNum })
  yearWhereOR.push({ user: { name: { contains: q, mode: "insensitive" } } })
  yearWhereOR.push({ user: { email: { contains: q, mode: "insensitive" } } })

  const yearRows = await prisma.taxYear.findMany({
    where: {
      userId: { in: scopeUserIds },
      OR: yearWhereOR,
    },
    select: {
      id: true,
      year: true,
      status: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
    take: LIMIT,
    orderBy: { year: "desc" },
  })
  const years: SearchResultYear[] = yearRows.map((y) => ({
    kind: "year",
    taxYearId: y.id,
    year: y.year,
    ownerId: y.userId,
    ownerName: y.user.name ?? y.user.email,
    status: y.status,
  }))

  // ── Transactions ──────────────────────────────────────────────────────
  // Match on merchantRaw, merchantNormalized, descriptionRaw. Filter to
  // in-scope tax years to avoid cross-tenant leakage.
  const txnRows = await prisma.transaction.findMany({
    where: {
      taxYear: { userId: { in: scopeUserIds } },
      isStale: false,
      isDuplicateOf: null,
      OR: [
        { merchantRaw: { contains: q, mode: "insensitive" } },
        { merchantNormalized: { contains: q, mode: "insensitive" } },
        { descriptionRaw: { contains: q, mode: "insensitive" } },
      ],
    },
    include: {
      taxYear: { select: { year: true, userId: true } },
      classifications: { where: { isCurrent: true }, select: { code: true }, take: 1 },
    },
    take: LIMIT,
    orderBy: { postedDate: "desc" },
  })
  const transactions: SearchResultTxn[] = txnRows.map((t) => ({
    kind: "txn",
    id: t.id,
    taxYearId: t.taxYearId,
    year: t.taxYear.year,
    ownerId: t.taxYear.userId,
    postedDate: t.postedDate.toISOString().slice(0, 10),
    merchantRaw: t.merchantRaw,
    merchantNormalized: t.merchantNormalized,
    amountNormalized: Number(t.amountNormalized.toString()),
    code: t.classifications[0]?.code ?? null,
  }))

  return { clients, years, transactions }
}
