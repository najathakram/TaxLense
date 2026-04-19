import { NextRequest, NextResponse } from "next/server"
import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import bcrypt from "bcryptjs"
import crypto from "crypto"
import { z } from "zod"

const BodySchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  displayName: z.string().max(100).optional(),
})

export async function POST(req: NextRequest) {
  let session: Awaited<ReturnType<typeof requireAuth>>
  try {
    session = await requireAuth()
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const cpaId = session.user!.id!
  const me = await prisma.user.findUnique({ where: { id: cpaId }, select: { role: true } })
  if (me?.role !== "CPA") {
    return NextResponse.json({ error: "Only CPA accounts can add clients" }, { status: 403 })
  }

  const parsed = BodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const { name, email, displayName } = parsed.data

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    return NextResponse.json({ error: "A user with that email already exists" }, { status: 409 })
  }

  // Generate a readable temporary password
  const tempPassword = crypto.randomBytes(5).toString("hex")
  const hashed = await bcrypt.hash(tempPassword, 12)

  const client = await prisma.user.create({
    data: { name, email, password: hashed, role: "CLIENT" },
  })

  await prisma.cpaClient.create({
    data: { cpaUserId: cpaId, clientUserId: client.id, displayName: displayName ?? null },
  })

  await prisma.auditEvent.create({
    data: {
      userId: cpaId,
      actorType: "USER",
      eventType: "CLIENT_CREATED",
      entityType: "User",
      entityId: client.id,
      afterState: { name, email, displayName },
    },
  })

  return NextResponse.json({ name, email, password: tempPassword })
}
