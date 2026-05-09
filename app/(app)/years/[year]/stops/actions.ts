"use server"

import { after } from "next/server"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import { applyMerchantRules } from "@/lib/classification/apply"
import type { Prisma, ClassificationSource } from "@/app/generated/prisma/client"
import { deriveFromAnswer, type StopAnswer } from "@/lib/stops/derive"
import { classifyStopsWithAI, type StopForAI } from "@/lib/ai/autoResolveStops"
import { aiSuggestionFromResolution } from "@/lib/stops/aiSuggestion"
import type { ProgressReporter } from "@/lib/jobs/pipelineRun"
import { recomputeStatus } from "@/lib/taxYear/status"
import { deriveStopsFromAssertions } from "@/lib/stops/deriveFromAssertions"
import { archiveSupersededStopsForYear } from "@/lib/stops/archiveSuperseded"
export type { StopAnswer } from "@/lib/stops/derive"


// ---------- resolveStop ----------

export async function resolveStop(
  stopId: string,
  answer: StopAnswer,
  applyToSimilar: boolean
) {
  const userId = await getCurrentUserId()

  // Read once outside the txn — needed for revalidate paths + the after()
  // propagation step. Keeps the txn lean.
  const stopBefore = await prisma.stopItem.findUnique({
    where: { id: stopId },
    include: { merchantRule: true, taxYear: true },
  })
  if (!stopBefore) throw new Error("StopItem not found")
  if (stopBefore.taxYear.userId !== userId) throw new Error("Not authorized")
  // ANSWERED + DEFERRED stops are intentionally re-resolvable: the user may
  // realize they mis-clicked or new info changed the right answer. The flip-
  // and-insert pattern below supersedes the prior classification cleanly,
  // and the AuditEvent preserves the change history (append-only by design).
  const isReAnswer = stopBefore.state === "ANSWERED"

  const derived = deriveFromAnswer(answer, {
    ruleCode: stopBefore.merchantRule?.code,
    ruleLine: stopBefore.merchantRule?.scheduleCLine,
  })

  const txIds = stopBefore.transactionIds
  const willPropagate =
    applyToSimilar &&
    stopBefore.category === "MERCHANT" &&
    !!stopBefore.merchantRuleId &&
    !!stopBefore.merchantRule?.merchantKey

  // Tight transaction: only the immediate side-effects on THIS stop and its
  // own transactions. Propagation to other matching transactions is moved to
  // an after() hook so the user gets instant resolution feedback even when
  // the merchant has 30+ rows.
  await prisma.$transaction(
    async (tx) => {
      const priorClassifications = txIds.length
        ? await tx.classification.findMany({
            where: { transactionId: { in: txIds }, isCurrent: true },
          })
        : []

      // Flip + insert per affected transaction. The substantiation JSON
      // (when present — §274(d) answers carry it) is written here so that
      // A08, the audit packet, and the ledger all read from
      // Classification.substantiation rather than from StopItem.userAnswer.
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

      // MerchantRule update — atomic with the classifications above so a
      // mid-flight failure doesn't leave the rule pointing at a code that
      // hasn't been written. The rule UPDATE is one row, ~ms.
      if (willPropagate) {
        await tx.merchantRule.update({
          where: { id: stopBefore.merchantRuleId! },
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
      }

      await tx.auditEvent.create({
        data: {
          userId,
          actorType: "USER",
          // STOP_RE_ANSWERED on re-resolve so the audit trail clearly
          // distinguishes a correction from the initial answer.
          eventType: isReAnswer ? "STOP_RE_ANSWERED" : "STOP_RESOLVED",
          entityType: "StopItem",
          entityId: stopId,
          beforeState: {
            priorState: stopBefore.state,
            priorAnswer: stopBefore.userAnswer ?? undefined,
            priorClassifications: priorClassifications.map((c) => ({
              transactionId: c.transactionId,
              code: c.code,
              businessPct: c.businessPct,
            })),
          },
          afterState: {
            code: derived.code,
            businessPct: derived.businessPct,
            applyToSimilar,
            ruleUpdated: willPropagate,
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
    // 120s ceiling as a safety net — the new shape should land in <500ms,
    // but a few legacy STOPs cover hundreds of txns and we don't want to
    // hard-fail those at the ceiling.
    { timeout: 120_000 }
  )

  // Auto-archive any other PENDING STOPs whose underlying transactions are
  // now classified by this resolution (B-09). Cheap; idempotent.
  await archiveSupersededStopsForYear(stopBefore.taxYearId)

  // Auto-advance the year's stage now that one more STOP is gone (may flip
  // CLASSIFICATION → REVIEW if this was the last pending STOP and every row
  // is classified).
  await recomputeStatus(stopBefore.taxYearId)

  // Revalidate immediately so the page-level fetch on next render reflects
  // the resolved STOP (banner / count / row strikethrough).
  const year = stopBefore.taxYear.year
  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/stops`)
  revalidatePath(`/years/${year}/ledger`)

  // Propagate to other matching transactions in the background. Bulk
  // re-classification of every TIM HORTONS row is the dominant cost on a
  // 500+ ledger; doing it inside the request would push the resolve over
  // the server-action timeout.
  //
  // On re-answer (STOP was already ANSWERED), force=true so the rule change
  // actually overwrites the prior classifications on other matching rows.
  // Without force, applyMerchantRules skips rows that already have a current
  // classification — which is exactly what we want to replace here.
  if (willPropagate && stopBefore.merchantRule?.merchantKey) {
    const merchantKey = stopBefore.merchantRule.merchantKey
    const merchantRuleId = stopBefore.merchantRuleId!
    const taxYearId = stopBefore.taxYearId
    after(async () => {
      try {
        await applyMerchantRules(taxYearId, { merchantKey, force: isReAnswer })
        // After re-classifying matching rows, archive any OTHER PENDING
        // StopItems pointing at the same MerchantRule — they're now
        // redundant because the rule itself answers their question.
        // Without this, the Wise pattern that surfaces 28× would leave
        // 27 PENDING duplicates after the user resolved the first.
        const orphans = await prisma.stopItem.findMany({
          where: {
            taxYearId,
            merchantRuleId,
            state: "PENDING",
            id: { not: stopId },
          },
          select: { id: true },
        })
        if (orphans.length > 0) {
          await prisma.stopItem.updateMany({
            where: { id: { in: orphans.map((o) => o.id) } },
            data: {
              state: "ANSWERED",
              answeredAt: new Date(),
              userAnswer: {
                supersededByRuleUpdate: true,
                viaStopId: stopId,
                archivedAt: new Date().toISOString(),
                reason: `MerchantRule for "${merchantKey}" was confirmed via STOP ${stopId}; this duplicate was auto-archived.`,
              } as Prisma.InputJsonValue,
            },
          })
        }
        revalidatePath(`/years/${year}/stops`)
        revalidatePath(`/years/${year}/ledger`)
      } catch (err) {
        // Don't fail the user-facing action — the rule update is already
        // committed, so a future Apply Rules run will pick it up.
        console.error("[resolveStop] propagation after-hook failed:", err)
      }
    })
  }
}

// ---------- AI auto-resolve ----------

export interface AutoResolveResult {
  resolved: number
  skipped: number   // confidence < threshold
  errors: number
  details: Array<{ merchantKey: string; code: string; confidence: number; status: "resolved" | "skipped" | "error" }>
}

// Lowered from 0.85 → 0.70 so high-but-not-perfect Sonnet decisions on
// repetitive patterns (recurring Wise top-ups, recurring Pocketsflow
// payouts) auto-resolve instead of cluttering the queue. Below 0.70 the
// suggestion is still persisted to StopItem.aiSuggestion so the user
// gets a one-click confirm on every STOP — just not an automatic one.
const AUTO_RESOLVE_CONFIDENCE_THRESHOLD = 0.7

export async function autoResolveStops(
  year: number,
  reportProgress?: ProgressReporter,
): Promise<AutoResolveResult> {
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

  if (reportProgress) {
    await reportProgress({
      phase: "auto_resolve_stops",
      processed: 0,
      total: stops.length,
      label: `Asking AI to resolve ${stops.length} STOP${stops.length === 1 ? "" : "s"}…`,
    })
  }

  // Call AI — emit a "starting batch" event before each Sonnet call so the
  // user sees what's actually in flight during the long wait. Without this
  // the panel reads "0 / N" while a 30-60s API call is grinding away and
  // it looks indistinguishable from a stuck run.
  const aiResults = await classifyStopsWithAI(
    stopsForAI,
    businessContext,
    undefined,
    async ({ batchIdx, totalBatches, batchStops }) => {
      if (!reportProgress) return
      const seen = new Set<string>()
      const samples: string[] = []
      for (const s of batchStops) {
        const m = s.merchantKey.trim()
        if (!m || seen.has(m)) continue
        seen.add(m)
        const short = m.length > 16 ? `${m.slice(0, 15)}…` : m
        samples.push(short)
        if (samples.length >= 4) break
      }
      const more = batchStops.length - samples.length
      const merchantBlurb =
        samples.length === 0
          ? ""
          : ` · ${samples.join(", ")}${more > 0 ? ` +${more}` : ""}`
      await reportProgress({
        phase: "auto_resolve_stops",
        processed: (batchIdx - 1) * 15,
        total: stops.length,
        label: `Batch ${batchIdx} of ${totalBatches} · ${batchStops.length} STOPs${merchantBlurb}`,
      })
    },
  )
  const resultMap = new Map(aiResults.map((r) => [r.stopId, r]))

  let resolved = 0
  let skipped = 0
  let errors = 0
  const details: AutoResolveResult["details"] = []

  for (let stopIdx = 0; stopIdx < stops.length; stopIdx++) {
    const stop = stops[stopIdx]!
    const ai = resultMap.get(stop.id)
    const mk = stop.merchantRule?.merchantKey ?? "UNKNOWN"

    if (!ai) {
      skipped++
      details.push({ merchantKey: mk, code: "?", confidence: 0, status: "skipped" })
      continue
    }

    if (ai.confidence < AUTO_RESOLVE_CONFIDENCE_THRESHOLD) {
      // Persist the suggestion anyway so the form pre-fills with the AI's
      // best guess on the next render. Without this the user faces four
      // blank radios on every STOP that didn't make the auto-resolve
      // bar — which is what they were complaining about.
      const suggestion = aiSuggestionFromResolution(
        stop.category,
        ai.code,
        ai.businessPct,
        ai.scheduleCLine ?? null,
        ai.confidence,
        ai.reasoning,
      )
      if (suggestion) {
        await prisma.stopItem.update({
          where: { id: stop.id },
          data: { aiSuggestion: suggestion as unknown as Prisma.InputJsonValue },
        })
      }
      skipped++
      details.push({ merchantKey: mk, code: ai.code, confidence: ai.confidence, status: "skipped" })
      continue
    }

    try {
      const willPropagate = ai.applyToSimilar && !!stop.merchantRuleId && !!stop.merchantRule?.merchantKey
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

        // Update merchant rule (rule UPDATE only — propagation to other
        // matching transactions is moved to an after() hook below so the
        // per-stop $transaction stays under the timeout when a single
        // rule covers 30+ ledger rows).
        if (willPropagate) {
          await tx.merchantRule.update({
            where: { id: stop.merchantRuleId! },
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
      }, { timeout: 120_000 })

      if (willPropagate && stop.merchantRule?.merchantKey) {
        const merchantKey = stop.merchantRule.merchantKey
        const taxYearId = stop.taxYearId
        after(async () => {
          try {
            await applyMerchantRules(taxYearId, { merchantKey, force: false })
          } catch (err) {
            console.error("[autoResolveStops] propagation after-hook failed:", err)
          }
        })
      }

      resolved++
      details.push({ merchantKey: mk, code: ai.code, confidence: ai.confidence, status: "resolved" })
    } catch {
      errors++
      details.push({ merchantKey: mk, code: ai.code, confidence: ai.confidence, status: "error" })
    }

    if (reportProgress) {
      await reportProgress({
        phase: "auto_resolve_stops",
        processed: stopIdx + 1,
        total: stops.length,
        label: `${stopIdx + 1} of ${stops.length} · ${resolved} resolved · ${skipped} skipped · ${errors} error${errors === 1 ? "" : "s"}`,
      })
    }
  }

  // Auto-resolve emptied a chunk of the queue. Re-derive STOPs from the
  // current state of the ledger so any inflow that's *still* unclassified
  // (i.e. now visible because its old MERCHANT/TRANSFER stop is gone)
  // shows up as a DEPOSIT stop the user can answer. Idempotent.
  try {
    await deriveStopsFromAssertions(taxYear.id)
  } catch (err) {
    console.error("[autoResolveStops] deriveStopsFromAssertions failed:", err)
  }

  // Bulk auto-resolve flips many STOPs in one go — recompute once at the end
  // rather than per-STOP for performance.
  await recomputeStatus(taxYear.id)

  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/stops`)
  revalidatePath(`/years/${year}/ledger`)
  return { resolved, skipped, errors, details }
}

// ---------- archiveSupersededStops ----------

/**
 * Archive PENDING StopItems whose underlying transactions now have a current
 * Classification. The autonomous CPA agent owns the canonical classification
 * for every in-year transaction; once it's classified, any legacy STOP from
 * the old multi-stage pipeline is by definition superseded — the agent's
 * decision is the truth.
 *
 * The same logic is supposed to run inline at the end of `runCpaAgent`, but
 * the in-agent hook didn't fire on Atif's prod ledger and 90+ STOPs stayed
 * PENDING after the agent run completed cleanly. This action lets the user
 * (or CPA) click a button to clear the legacy STOPs without re-running the
 * whole agent.
 *
 * Returns { archived, skipped } so the UI can show what happened.
 */
export async function archiveSupersededStops(year: number): Promise<{
  archived: number
  skipped: number
}> {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, year: true },
  })
  if (!taxYear) throw new Error(`No tax year ${year}`)

  const stops = await prisma.stopItem.findMany({
    where: { taxYearId: taxYear.id, state: "PENDING" },
    select: { id: true, transactionIds: true },
  })

  let archived = 0
  let skipped = 0

  for (const stop of stops) {
    if (stop.transactionIds.length === 0) {
      // Empty STOP — archive as a holdover edge case
      await prisma.stopItem.update({
        where: { id: stop.id },
        data: {
          state: "ANSWERED",
          answeredAt: new Date(),
          userAnswer: {
            cpaAgentSupersededByButton: true,
            archivedAt: new Date().toISOString(),
            reason: "Empty STOP (no transactions) — archived by user.",
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
          cpaAgentSupersededByButton: true,
          archivedAt: new Date().toISOString(),
          reason: `${classifiedCount} of ${stop.transactionIds.length} underlying transactions classified — STOP superseded.`,
        } as Prisma.InputJsonValue,
      },
    })
    archived++
  }

  await prisma.auditEvent.create({
    data: {
      userId,
      actorType: "USER",
      eventType: "STOPS_ARCHIVED_AS_SUPERSEDED",
      entityType: "TaxYear",
      entityId: taxYear.id,
      afterState: { archived, skipped, scanned: stops.length } as Prisma.InputJsonValue,
      rationale: `User clicked "Archive superseded STOPs" — ${archived} archived, ${skipped} skipped (no classifications).`,
    },
  })

  await recomputeStatus(taxYear.id)
  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/stops`)
  revalidatePath(`/years/${year}/risk`)

  return { archived, skipped }
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

  await recomputeStatus(stop.taxYearId)

  revalidatePath(`/years/${stop.taxYear.year}`)
  revalidatePath(`/years/${stop.taxYear.year}/stops`)
}
