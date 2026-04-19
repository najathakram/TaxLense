import { auth } from "@/auth"
import { redirect } from "next/navigation"

export async function getSession() {
  return await auth()
}

export async function requireAuth() {
  const session = await auth()
  if (!session?.user) redirect("/login")
  return session
}

export async function getCurrentUserId(): Promise<string> {
  const session = await requireAuth()
  return session.user!.id!
}
