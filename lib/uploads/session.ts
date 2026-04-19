/**
 * Upload-session lifecycle + rate limiting (Session 9 §A.3).
 *
 * A session groups N uploads within one "batch upload" action. Each PDF-route
 * AI extraction (Haiku cleanup / Vision doc / retry) counts as one API call
 * against `apiCallLimit`. Exceeding the limit throws RateLimitError.
 */

import { prisma } from "@/lib/db"

export const DEFAULT_API_CALL_LIMIT = 50

export class RateLimitError extends Error {
  constructor(message: string, public readonly limit: number, public readonly used: number) {
    super(message)
    this.name = "RateLimitError"
  }
}

export interface SessionHandle {
  id: string
  taxYearId: string
  apiCallLimit: number
}

/** Open (or reuse) the in-progress session for a tax year. */
export async function openOrGetSession(
  taxYearId: string,
  cpaUserId: string | null,
): Promise<SessionHandle> {
  const existing = await prisma.importSession.findFirst({
    where: { taxYearId, status: "IN_PROGRESS" },
    orderBy: { uploadedAt: "desc" },
  })
  if (existing) {
    return { id: existing.id, taxYearId, apiCallLimit: existing.apiCallLimit }
  }
  const created = await prisma.importSession.create({
    data: {
      taxYearId,
      cpaUserId,
      status: "IN_PROGRESS",
      totalApiCalls: 0,
      apiCallLimit: DEFAULT_API_CALL_LIMIT,
    },
  })
  return { id: created.id, taxYearId, apiCallLimit: created.apiCallLimit }
}

/**
 * Atomically increment the call counter. Throws RateLimitError if the new
 * total would exceed `apiCallLimit`. Uses a single UPDATE with a WHERE clause
 * so concurrent callers can't double-count.
 */
export async function chargeApiCall(sessionId: string): Promise<number> {
  const row = await prisma.$transaction(async (tx) => {
    const sess = await tx.importSession.findUnique({ where: { id: sessionId } })
    if (!sess) throw new Error(`Session ${sessionId} not found`)
    if (sess.status !== "IN_PROGRESS") {
      throw new Error(`Session ${sessionId} is ${sess.status}`)
    }
    if (sess.totalApiCalls >= sess.apiCallLimit) {
      throw new RateLimitError(
        `Upload session API call limit reached (${sess.apiCallLimit})`,
        sess.apiCallLimit,
        sess.totalApiCalls,
      )
    }
    return tx.importSession.update({
      where: { id: sessionId },
      data: { totalApiCalls: { increment: 1 } },
    })
  })
  return row.totalApiCalls
}

export async function closeSession(
  sessionId: string,
  status: "COMPLETE" | "ABORTED" = "COMPLETE",
): Promise<void> {
  await prisma.importSession.update({
    where: { id: sessionId },
    data: { status, closedAt: new Date() },
  })
}

export async function saveSessionNotes(sessionId: string, notes: string): Promise<void> {
  await prisma.importSession.update({
    where: { id: sessionId },
    data: { notes },
  })
}
