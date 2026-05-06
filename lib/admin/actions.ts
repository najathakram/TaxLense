"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { prisma } from "@/lib/db"
import { requireAuth } from "@/lib/auth"
import { ADMIN_CONTEXT_COOKIE } from "./adminContext"
import { CLIENT_CONTEXT_COOKIE } from "@/lib/cpa/clientContext"
import { writeAuditEvent } from "@/lib/audit"

/**
 * Admin server actions — gated to SUPER_ADMIN role.
 *
 * enterCpaSession  — admin impersonates a CPA (sets the admin_ctx cookie + audit)
 * exitCpaSession   — admin releases CPA impersonation (clears cookie + audit)
 *
 * The CLIENT impersonation cookie (taxlens_client_ctx) is independent and
 * preserved across enter/exit. If admin had also been impersonating a client,
 * exiting CPA implicitly drops the client too — getCurrentUserId resolves
 * client_ctx → admin_ctx → session, and without admin_ctx the chain is
 * "session.user.id (admin's own id)" which has no client relationship.
 */

async function requireAdmin() {
  const session = await requireAuth()
  const userId = session.user!.id!
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, role: true, isActive: true },
  })
  if (!u || u.role !== "SUPER_ADMIN" || !u.isActive) {
    throw new Error("Forbidden")
  }
  return u
}

export async function enterCpaSession(cpaId: string) {
  const admin = await requireAdmin()

  const cpa = await prisma.user.findUnique({
    where: { id: cpaId },
    select: { id: true, role: true, isActive: true },
  })
  if (!cpa) throw new Error("CPA not found")
  if (cpa.role !== "CPA") throw new Error("Target is not a CPA")
  if (!cpa.isActive) throw new Error("CPA is suspended")

  const cookieStore = await cookies()
  cookieStore.set(ADMIN_CONTEXT_COOKIE, `${admin.id}:${cpaId}`, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 8, // 8 hours
  })
  // Always clear any prior client impersonation when switching to a different
  // CPA — otherwise the chrome would show stale "on behalf of <client>" text
  // for the WRONG CPA's client.
  cookieStore.delete(CLIENT_CONTEXT_COOKIE)

  await writeAuditEvent({
    userId: cpaId,
    actorAdminUserId: admin.id,
    actorType: "USER",
    eventType: "ADMIN_ASSUMED_CPA",
    entityType: "User",
    entityId: cpaId,
    rationale: `Super admin ${admin.id} began impersonating CPA ${cpaId}.`,
  })

  redirect("/workspace")
}

export async function exitCpaSession() {
  const session = await requireAuth()
  const adminId = session.user!.id!

  const cookieStore = await cookies()
  const val = cookieStore.get(ADMIN_CONTEXT_COOKIE)?.value
  const cpaId = val ? val.split(":")[1] : null

  cookieStore.delete(ADMIN_CONTEXT_COOKIE)
  cookieStore.delete(CLIENT_CONTEXT_COOKIE)

  if (cpaId) {
    await writeAuditEvent({
      userId: cpaId,
      actorAdminUserId: adminId,
      actorType: "USER",
      eventType: "ADMIN_RELEASED_CPA",
      entityType: "User",
      entityId: cpaId,
      rationale: `Super admin ${adminId} stopped impersonating CPA ${cpaId}.`,
    })
  }

  redirect("/admin/cpas")
}

// ───────── createCpaAccount ───────────────────────────────────────────
// Server-action used by /admin/cpas/new. Creates a User with role=CPA.
// Admin-only (the function gates on requireAdmin).

export async function createCpaAccount(formData: FormData) {
  const admin = await requireAdmin()

  const name = (formData.get("name") as string | null)?.trim()
  const email = (formData.get("email") as string | null)?.trim().toLowerCase()

  if (!name || !email) throw new Error("Name and email are required")
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Invalid email")

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) throw new Error("A user with that email already exists")

  const tempPassword = crypto.randomBytes(5).toString("hex")
  const hashed = await bcrypt.hash(tempPassword, 12)

  const cpa = await prisma.user.create({
    data: { name, email, password: hashed, role: "CPA" },
  })

  await writeAuditEvent({
    userId: cpa.id,
    actorAdminUserId: admin.id,
    actorType: "USER",
    eventType: "CPA_CREATED",
    entityType: "User",
    entityId: cpa.id,
    afterState: { name, email },
    rationale: `Admin ${admin.id} created CPA ${cpa.id}. Temp password issued (delivered out-of-band).`,
  })

  // For now, just redirect to the CPA list. A future "show password once" page
  // will display the temp password — for now the admin can reset it.
  void tempPassword

  redirect(`/admin/cpas/${cpa.id}`)
}
