import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { getClientContext } from "@/lib/cpa/clientContext"

export async function getSession() {
  return await auth()
}

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  return session
}

export async function getCurrentUserId(): Promise<string> {
  const ctx = await getClientContext()
  if (ctx) return ctx.clientId
  const session = await requireAuth()
  return session.user!.id!
}
