import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getClientContext } from "@/lib/cpa/clientContext"
import { getAdminCpaContext } from "@/lib/admin/adminContext"

export async function getSession() {
  return await auth()
}

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  return session
}

/**
 * Resolves the "effective taxpayer / CPA / admin" user id for the current
 * request, deepest impersonation level wins:
 *   1. CLIENT context (CPA impersonating a client)         → return clientId
 *   2. ADMIN→CPA context (admin impersonating a CPA)        → return cpaId
 *   3. Logged-in session user                               → return session id
 *
 * This keeps existing pages that query `where: { userId }` automatically
 * scoped to whichever tier the user is currently working in.
 */
export async function getCurrentUserId(): Promise<string> {
  const clientCtx = await getClientContext()
  if (clientCtx) return clientCtx.clientId

  const adminCpaCtx = await getAdminCpaContext()
  if (adminCpaCtx) return adminCpaCtx.cpaId

  const session = await requireAuth()
  return session.user!.id!
}
