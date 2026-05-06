"use server"

import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { applyMerchantRules } from "@/lib/classification/apply"
import type { Prisma, ClassificationSource } from "@/app/generated/prisma/client"
import { deriveFromAnswer, type StopAnswer } from "@/lib/stops/derive"
import { classifyStopsWithAI, type StopForAI } from "@/lib/ai/autoResolveStops"
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

      // Flip and insert per-transaction. The substantiation JSON (when present
      // — §274(d) answers carry it) is written here so that A08, the audit
      // packet, and the ledger all read from Classification.substantiation
      // rather than from StopItem.userAnswer.
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
            substantiation: derived.substantiation
              ? (derived.substantiation as Prisma.InputJsonValue)
              : undefined,
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

// ---------- AI auto-resolve ----------

export interface AutoResolveResult {
  resolved: number
  skipped: number   // confidence < 0.85
  errors: number
  details: Array<{ merchantKey: string; code: string; confidence: number; status: "resolved" | "skipped" | "error" }>
}

const AUTO_RESOLVE_CONFIDENCE_THRESHOLD = 0.85

export async function autoResolveStops(year: number): Promise<AutoResolveResult> {
  const userId = await getCurrentUserId()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: { businessProfile: true },
  })
  if (!taxYear) throw new Error("Tax year not found")

  // Fetch all PENDING stops with their transaction data
  const stops = await prisma.stopItem.findMany({
    where: { taxYearId: taxYear.id, state: "PENDING" },
    include: { merchantRule: true },
  })
  if (stops.length === 0) return { resolved: 0, skipped: 0, errors: 0, details: [] }

  // Gather transaction details
  const allIds = stops.flatMap((s) => s.transactionIds)
  const txns = allIds.length
    ? await prisma.transaction.findMany({
        where: { id: { in: allIds } },
        include: { account: true },
      })
    : []
  const txById = new Map(txns.map((t) => [t.id, t]))

  // Build StopForAI list
  const stopsForAI: StopForAI[] = stops.map((s) => {
    const affected = s.transactionIds.flatMap((id) => {
      const t = txById.get(id)
      if (!t) return []
      return [{ date: t.postedDate.toISOString().slice(0, 10), account: t.account.nickname ?? "", raw: t.merchantRaw, amount: Number(t.amountNormalized.toString()) }]
    })
    const totalAmount = affected.reduce((sum, t) => sum + Math.abs(t.amount), 0)
    return {
      stopId: s.id,
      merchantKey: s.merchantRule?.merchantKey ?? (affected[0]?.raw ?? "UNKNOWN"),
      category: s.category,
      totalAmount,
      txnCount: affected.length,
      samples: affected.slice(0, 5),
    }
  })

  const businessContext = [
    taxYear.businessProfile?.businessDescription ?? "",
    `NAICS: ${taxYear.businessProfile?.naicsCode ?? ""}`,
  ].filter(Boolean).join(". ")

  // Call AI
  const aiResults = await classifyStopsWithAI(stopsForAI, businessContext)
  const resultMap = new Map(aiResults.map((r) => [r.stopId, r]))

  let resolved = 0
  let skipped = 0
  let errors = 0
  const details: AutoResolveResult["details"] = []

  for (const stop of stops) {
    const ai = resultMap.get(stop.id)
    const mk = stop.merchantRule?.merchantKey ?? "UNKNOWN"

    if (!ai) {
      skipped++
      details.push({ merchantKey: mk, code: "?", confidence: 0, status: "skipped" })
      continue
    }

    if (ai.confidence < AUTO_RESOLVE_CONFIDENCE_THRESHOLD) {
      skipped++
      details.push({ merchantKey: mk, code: ai.code, confidence: ai.confidence, status: "skipped" })
      continue
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Flip + insert classification for every transaction in this stop
        for (const txId of stop.transactionIds) {
          await tx.classification.updateMany({
            where: { transactionId: txId, isCurrent: true },
            data: { isCurrent: false },
          })
          await tx.classification.create({
            data: {
              transactionId: txId,
              code: ai.code,
              scheduleCLine: ai.scheduleCLine,
              businessPct: ai.businessPct,
              ircCitations: ai.ircCitations,
              confidence: ai.confidence,
              evidenceTier: 3,
              source: "AI" as ClassificationSource,
              reasoning: `Auto-resolved: ${ai.reasoning}`,
              isCurrent: true,
              createdByUserId: userId,
            },
          })
        }

        // Update merchant rule if applyToSimilar
        if (ai.applyToSimilar && stop.merchantRuleId) {
          await tx.merchantRule.update({
            where: { id: stop.merchantRuleId },
            data: {
              code: ai.code,
              scheduleCLine: ai.scheduleCLine,
              businessPctDefault: ai.businessPct,
              ircCitations: ai.ircCitations,
              requiresHumanInput: false,
              isConfirmed: true,
              confidence: ai.confidence,
              reasoning: ai.reasoning,
            },
          })
          if (stop.merchantRule?.merchantKey) {
            await applyMerchantRules(stop.taxYearId, {
              merchantKey: stop.merchantRule.merchantKey,
              tx: tx as unknown as Prisma.TransactionClient,
              force: false,
            })
          }
        }

        await tx.stopItem.update({
          where: { id: stop.id },
          data: { state: "ANSWERED", answeredAt: new Date(), userAnswer: { autoResolved: true, code: ai.code, confidence: ai.confidence } as unknown as Prisma.InputJsonValue },
        })

        await tx.auditEvent.create({
          data: {
            userId,
            actorType: "AI",
            eventType: "STOP_RESOLVED",
            entityType: "StopItem",
            entityId: stop.id,
            afterState: { code: ai.code, businessPct: ai.businessPct, confidence: ai.confidence, autoResolved: true },
            rationale: ai.reasoning,
          },
        })
      }, { timeout: 30_000 })

      resolved++
      details.push({ merchantKey: mk, code: ai.code, confidence: ai.confidence, status: "resolved" })
    } catch {
      errors++
      details.push({ merchantKey: mk, code: ai.code, confidence: ai.confidence, status: "error" })
    }
  }

  revalidatePath(`/years/${year}/stops`)
  revalidatePath(`/years/${year}/ledger`)
  return { resolved, skipped, errors, details }
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
