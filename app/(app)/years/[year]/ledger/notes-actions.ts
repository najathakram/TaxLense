"use server"

/**
 * Phase J — per-classification CPA notes (append-only).
 *
 * Edits create a NEW row; prior notes persist. Rendered on ledger row
 * hover (💬 indicator) and in the merchant detail viewer.
 */

import { revalidatePath } from "next/cache"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"

const AddNoteSchema = z.object({
  year: z.number().int(),
  classificationId: z.string().min(1),
  body: z.string().min(2).max(2000),
})

export async function addClassificationNote(
  input: z.infer<typeof AddNoteSchema>,
): Promise<{ ok: true; noteId: string } | { ok: false; error: string }> {
  const userId = await getCurrentUserId()
  const parsed = AddNoteSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid input" }
  const { year, classificationId, body } = parsed.data

  // Verify classification belongs to user's year
  const cls = await prisma.classification.findUnique({
    where: { id: classificationId },
    include: { transaction: { select: { taxYearId: true } } },
  })
  if (!cls) return { ok: false, error: "Classification not found" }
  const taxYear = await prisma.taxYear.findUnique({
    where: { id: cls.transaction.taxYearId },
    select: { userId: true, year: true },
  })
  if (!taxYear) return { ok: false, error: "Tax year not found" }

  const note = await prisma.classificationNote.create({
    data: {
      classificationId,
      authorUserId: userId,
      body: body.trim(),
    },
  })
  await prisma.auditEvent.create({
    data: {
      userId: taxYear.userId,
      actorType: "USER",
      eventType: "CLASSIFICATION_NOTE_ADDED",
      entityType: "Classification",
      entityId: classificationId,
      afterState: { noteId: note.id, bodyLen: body.length },
    },
  })

  revalidatePath(`/years/${year}/ledger`)
  return { ok: true, noteId: note.id }
}

export async function loadNotesForClassifications(
  classificationIds: string[],
): Promise<Record<string, Array<{ id: string; body: string; authorName: string; createdAt: string }>>> {
  if (classificationIds.length === 0) return {}
  const notes = await prisma.classificationNote.findMany({
    where: { classificationId: { in: classificationIds } },
    orderBy: { createdAt: "desc" },
    include: { author: { select: { name: true, email: true } } },
  })
  const out: Record<string, Array<{ id: string; body: string; authorName: string; createdAt: string }>> = {}
  for (const n of notes) {
    if (!out[n.classificationId]) out[n.classificationId] = []
    out[n.classificationId].push({
      id: n.id,
      body: n.body,
      authorName: n.author.name ?? n.author.email,
      createdAt: n.createdAt.toISOString(),
    })
  }
  return out
}
