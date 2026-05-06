/**
 * Super-admin tier helpers — parallel to lib/cpa/clientContext.ts.
 *
 * Three things live here:
 *   1. getCurrentAdminContext()   — info about the logged-in super admin
 *   2. getAdminCpaContext()       — when admin is impersonating a CPA, who
 *   3. listAllCpas()              — feeds /admin/cpas list
 *
 * Cookie model (parallels taxlens_client_ctx):
 *   taxlens_admin_ctx = "<adminId>:<cpaId>"   set by enterCpaSession()
 *
 * Resolution order in getCurrentUserId():
 *   client_ctx.clientId → admin_ctx.cpaId → session.user.id
 * (deepest impersonation level wins; see lib/auth.ts)
 */
import { cache } from "react"
import { cookies } from "next/headers"
import { auth } from "@/auth"
import { prisma } from "@/lib/db"

export const ADMIN_CONTEXT_COOKIE = "taxlens_admin_ctx"

export interface AdminContext {
  adminId: string
  adminName: string
  adminEmail: string
  /** True only for users with role=SUPER_ADMIN. Other roles return null instead
   *  of an AdminContext (this field is here for symmetry with CpaContext.isCpa). */
  isAdmin: true
}

export interface AdminCpaContext {
  adminId: string
  cpaId: string
  cpaName: string
  cpaEmail: string
}

/**
 * Returns admin info about the LOGGED-IN user. Returns null for non-admins
 * (CPAs and CLIENTs) so callers can `if (admin) { ...admin chrome... }` cleanly.
 */
export const getCurrentAdminContext = cache(
  async (): Promise<AdminContext | null> => {
    const session = await auth()
    if (!session?.user?.id) return null

    const user = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: { id: true, name: true, email: true, role: true, isActive: true },
    })
    if (!user) return null
    if (user.role !== "SUPER_ADMIN") return null
    if (!user.isActive) return null

    return {
      adminId: user.id,
      adminName: user.name ?? user.email,
      adminEmail: user.email,
      isAdmin: true,
    }
  },
)

/**
 * Returns the CPA that the logged-in admin is currently impersonating, or null.
 * Verifies role=SUPER_ADMIN before honoring the cookie — a CLIENT or CPA who
 * managed to set this cookie still gets null back.
 */
export const getAdminCpaContext = cache(
  async (): Promise<AdminCpaContext | null> => {
    const admin = await getCurrentAdminContext()
    if (!admin) return null

    const cookieStore = await cookies()
    const val = cookieStore.get(ADMIN_CONTEXT_COOKIE)?.value
    if (!val) return null

    const [adminId, cpaId] = val.split(":")
    if (!adminId || !cpaId || adminId !== admin.adminId) return null

    const cpa = await prisma.user.findUnique({
      where: { id: cpaId },
      select: { id: true, name: true, email: true, role: true },
    })
    if (!cpa) return null
    if (cpa.role !== "CPA") return null

    return {
      adminId: admin.adminId,
      cpaId: cpa.id,
      cpaName: cpa.name ?? cpa.email,
      cpaEmail: cpa.email,
    }
  },
)

export interface CpaListEntry {
  cpaId: string
  cpaName: string
  cpaEmail: string
  isActive: boolean
  clientCount: number
  createdAt: Date
}

/**
 * Lists every CPA on the platform with a client count. Powers /admin/cpas.
 * Admin-only; callers must check role first.
 */
export async function listAllCpas(): Promise<CpaListEntry[]> {
  const cpas = await prisma.user.findMany({
    where: { role: "CPA" },
    select: {
      id: true,
      name: true,
      email: true,
      isActive: true,
      createdAt: true,
      _count: { select: { cpaClients: true } },
    },
    orderBy: { createdAt: "desc" },
  })

  return cpas.map((c) => ({
    cpaId: c.id,
    cpaName: c.name ?? c.email,
    cpaEmail: c.email,
    isActive: c.isActive,
    clientCount: c._count.cpaClients,
    createdAt: c.createdAt,
  }))
}
