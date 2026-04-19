"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { CLIENT_CONTEXT_COOKIE } from "./clientContext"

export async function enterClientSession(clientId: string) {
  const session = await requireAuth()
  const cpaId = session.user!.id!

  const rel = await prisma.cpaClient.findUnique({
    where: { cpaUserId_clientUserId: { cpaUserId: cpaId, clientUserId: clientId } },
  })
  if (!rel) throw new Error("Access denied")

  const cookieStore = await cookies()
  cookieStore.set(CLIENT_CONTEXT_COOKIE, `${cpaId}:${clientId}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8,
  })

  redirect("/dashboard")
}

export async function exitClientSession() {
  const cookieStore = await cookies()
  cookieStore.delete(CLIENT_CONTEXT_COOKIE)
  redirect("/clients")
}
