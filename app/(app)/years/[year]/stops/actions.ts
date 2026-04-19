"use server"

import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { applyMerchantRules } from "@/lib/classification/apply"
import type { Prisma } from "@/app/generated/prisma/client"
import { deriveFromAnswer, type StopAnswer } from "@/lib/stops/derive"
export type { StopAnswer } from "@/lib/stops/derive"


// ---------- resolveStop ----------

export async function resolveStop(
  stopId: string,
  answer: StopAnswer,
  applyToSimilar: boolean
) {
  const userId = await getCurrentUserId()

  await prisma.$transaction(
    async (tx) => {
      const stop = await tx.stopItem.findUnique({
        where: { id: stopId },
        include: { merchantRule: true, taxYear: true },
      })
      if (!stop) throw new Error("StopItem not found")
      if (stop.taxYear.userId !== userId) throw new Error("Not authorized")
      if (stop.state !== "PENDING") throw new Error(`StopItem is already ${stop.state}`)

      const derived = deriveFromAnswer(answer, {
        ruleCode: stop.merchantRule?.code,
        ruleLine: stop.merchantRule?.scheduleCLine,
      })

      const txIds = stop.transactionIds
      const priorClassifications = txIds.length
        ? await tx.classification.findMany({
            where: { transactionId: { in: txIds }, isCurrent: true },
          })
        : []

      // Flip and insert per-transaction
      for (const txId of txIds) {
        await tx.classification.updateMany({
          where: { transactionId: txId, isCurrent: true },
          data: { isCurrent: false },
        })
        await tx.classification.create({
          data: {
            transactionId: txId,
            code: derived.code,
            scheduleCLine: derived.scheduleCLine,
            businessPct: derived.businessPct,
            ircCitations: derived.ircCitations,
            confidence: 1.0,
            evidenceTier: derived.evidenceTier,
            source: derived.source,
            reasoning: derived.reasoning,
            isCurrent: true,
            createdByUserId: userId,
          },
        })
      }

      // MerchantRule update + re-apply
      let ruleUpdated = false
      if (applyToSimilar && stop.category === "MERCHANT" && stop.merchantRuleId) {
        await tx.merchantRule.update({
          where: { id: stop.merchantRuleId },
          data: {
            code: derived.code,
            scheduleCLine: derived.scheduleCLine,
            businessPctDefault: derived.businessPct,
            ircCitations: derived.ircCitations,
            evidenceTierDefault: derived.evidenceTier,
            reasoning: derived.reasoning,
            requiresHumanInput: false,
            humanQuestion: null,
            isConfirmed: true,
            confidence: 1.0,
          },
        })
        ruleUpdated = true

        if (stop.merchantRule?.merchantKey) {
          await applyMerchantRules(stop.taxYearId, {
            merchantKey: stop.merchantRule.merchantKey,
            tx: tx as unknown as Prisma.TransactionClient,
            force: false,
          })
        }
      }

      await tx.auditEvent.create({
        data: {
          userId,
          actorType: "USER",
          eventType: "STOP_RESOLVED",
          entityType: "StopItem",
          entityId: stopId,
          beforeState: {
            prior: priorClassifications.map((c) => ({
              transactionId: c.transactionId,
              code: c.code,
              businessPct: c.businessPct,
            })),
          },
          afterState: {
            code: derived.code,
            businessPct: derived.businessPct,
            applyToSimilar,
            ruleUpdated,
            txCount: txIds.length,
          },
          rationale: derived.reasoning,
        },
      })

      await tx.stopItem.update({
        where: { id: stopId },
        data: {
          state: "ANSWERED",
          userAnswer: answer as unknown as Prisma.InputJsonValue,
          answeredAt: new Date(),
        },
      })
    },
    { timeout: 30_000 }
  )

  revalidatePath(`/years/${(await getYearFor(stopId)) ?? ""}/stops`)
  revalidatePath(`/years/${(await getYearFor(stopId)) ?? ""}/ledger`)
}

async function getYearFor(stopId: string): Promise<number | null> {
  const s = await prisma.stopItem.findUnique({
    where: { id: stopId },
    include: { taxYear: true },
  })
  return s?.taxYear.year ?? null
}

// ---------- deferStop ----------

export async function deferStop(stopId: string) {
  const userId = await getCurrentUserId()

  const stop = await prisma.stopItem.findUnique({
    where: { id: stopId },
    include: { taxYear: true },
  })
  if (!stop) throw new Error("StopItem not found")
  if (stop.taxYear.userId !== userId) throw new Error("Not authorized")

  await prisma.$transaction(async (tx) => {
    await tx.stopItem.update({
      where: { id: stopId },
      data: { state: "DEFERRED" },
    })
    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "STOP_DEFERRED",
        entityType: "StopItem",
        entityId: stopId,
      },
    })
  })

  revalidatePath(`/years/${stop.taxYear.year}/stops`)
}
