"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { writeAuditEvent } from "@/lib/audit"
import { getAdminCpaContext } from "@/lib/admin/adminContext"
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

// ───────── createClientAccount ────────────────────────────────────────
//
// Server-action used by /clients/new (CPA tier) and /admin/cpas/[id]/clients/new
// (admin impersonating a CPA). Creates a User with role=CLIENT, links via
// CpaClient to the acting CPA, and writes an audit event.

export async function createClientAccount(formData: FormData) {
  const session = await requireAuth()
  const sessionUserId = session.user!.id!

  // Determine the CPA to attach the new client to:
  //   - If admin is impersonating a CPA, attach to that CPA.
  //   - Otherwise, the logged-in user must be a CPA themselves.
  const adminCpaCtx = await getAdminCpaContext()
  let cpaId: string
  if (adminCpaCtx) {
    cpaId = adminCpaCtx.cpaId
  } else {
    const me = await prisma.user.findUnique({ where: { id: sessionUserId }, select: { role: true } })
    if (me?.role !== "CPA" && me?.role !== "SUPER_ADMIN") {
      throw new Error("Only CPA accounts can add clients")
    }
    cpaId = sessionUserId
  }

  const name = (formData.get("name") as string | null)?.trim()
  const email = (formData.get("email") as string | null)?.trim().toLowerCase()
  const displayName = (formData.get("displayName") as string | null)?.trim() || null

  if (!name || !email) throw new Error("Name and email are required")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email")

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw new Error("A user with that email already exists")

  const tempPassword = crypto.randomBytes(5).toString("hex")
  const hashed = await bcrypt.hash(tempPassword, 12)

  const client = await prisma.user.create({
    data: { name, email, password: hashed, role: "CLIENT" },
  })

  await prisma.cpaClient.create({
    data: { cpaUserId: cpaId, clientUserId: client.id, displayName },
  })

  await writeAuditEvent({
    userId: client.id,
    actorType: "USER",
    eventType: "CLIENT_CREATED",
    entityType: "User",
    entityId: client.id,
    afterState: { name, email, displayName, cpaUserId: cpaId },
    rationale: `New client created. Temp password issued (delivered out-of-band).`,
  })

  redirect(`/clients/${client.id}`)
}
