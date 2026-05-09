/**
 * Auto-archive PENDING StopItems whose underlying transactions are already
 * classified.
 *
 * Pre-B-09 the user had to click the "Archive superseded STOPs" button on the
 * year hub manually. With the autonomous CPA agent owning every classification
 * and the agent's per-run hook frequently dropping the archive call, the queue
 * could grow to 90+ stale STOPs even though every transaction was classified
 * — and the year-hub "Next action" card had to apologize and tell the user to
 * click the button.
 *
 * Now every classification-write path calls this helper. Idempotent and cheap
 * (one COUNT query per pending stop in the year).
 */

import { prisma } from "@/lib/db"
import type { Prisma } from "@/app/generated/prisma/client"

export interface ArchiveResult {
  archived: number
  skipped: number
}

/**
 * Archive PENDING StopItems whose transactions now carry a current
 * Classification. Returns counts; never throws on per-stop errors (best-
 * effort: an unexpected DB error on stop X shouldn't block the user's
 * primary classification action).
 */
export async function archiveSupersededStopsForYear(
  taxYearId: string,
): Promise<ArchiveResult> {
  const stops = await prisma.stopItem.findMany({
    where: { taxYearId, state: "PENDING" },
    select: { id: true, transactionIds: true },
  })

  let archived = 0
  let skipped = 0

  for (const stop of stops) {
    if (stop.transactionIds.length === 0) {
      await prisma.stopItem.update({
        where: { id: stop.id },
        data: {
          state: "ANSWERED",
          answeredAt: new Date(),
          userAnswer: {
            autoArchivedAsSuperseded: true,
            archivedAt: new Date().toISOString(),
            reason: "Empty STOP (no transactions) — auto-archived.",
          } as Prisma.InputJsonValue,
        },
      })
      archived++
      continue
    }

    const classifiedCount = await prisma.classification.count({
      where: {
        transactionId: { in: stop.transactionIds },
        isCurrent: true,
      },
    })
    if (classifiedCount === 0) {
      skipped++
      continue
    }

    await prisma.stopItem.update({
      where: { id: stop.id },
      data: {
        state: "ANSWERED",
        answeredAt: new Date(),
        userAnswer: {
          autoArchivedAsSuperseded: true,
          archivedAt: new Date().toISOString(),
          reason: `${classifiedCount} of ${stop.transactionIds.length} underlying transactions classified — STOP superseded.`,
        } as Prisma.InputJsonValue,
      },
    })
    archived++
  }

  return { archived, skipped }
}
