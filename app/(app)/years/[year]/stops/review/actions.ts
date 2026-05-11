"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { applyMerchantRules } from "@/lib/classification/apply"
import { deriveFromAnswer, type StopAnswer } from "@/lib/stops/derive"
import { recomputeStatus } from "@/lib/taxYear/status"
import { archiveSupersededStopsForYear } from "@/lib/stops/archiveSuperseded"
import type { Prisma, ClassificationSource } from "@/app/generated/prisma/client"

// ────────────────────────────────────────────────────────────────────────
// approveProposals — bulk approve every selected stop's stored proposal.
//
// Each stop's `aiProposal.answer` is the StopAnswer that gets fed to
// deriveFromAnswer (same code path as a manual resolve). Optional
// `overrides` lets the CPA edit specific proposals before approval —
// e.g. "I changed stop_42 from REFUND to GIFT before clicking Approve."
//
// Non-transactional outer loop because each stop's flip-and-insert is
// already atomic and we want partial success: if one stop's transaction
// fails, the others still apply.
// ────────────────────────────────────────────────────────────────────────

export interface ApproveProposalsResult {
  approved: number
  errors: number
  details: Array<{
    stopId: string
    status: "approved" | "error" | "skipped"
    reason?: string
  }>
}

export async function approveProposals(
  year: number,
  stopIds: string[],
  overrides?: Record<string, StopAnswer>,
): Promise<ApproveProposalsResult> {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true },
  })
  if (!taxYear) throw new Error("Tax year not found")

  const stops = await prisma.stopItem.findMany({
    where: {
      id: { in: stopIds },
      taxYearId: taxYear.id,
      state: "PENDING",
    },
    include: { merchantRule: true },
  })

  let approved = 0
  let errors = 0
  const details: ApproveProposalsResult["details"] = []

  for (const stop of stops) {
    const proposal = stop.aiProposal as { answer?: unknown } | null
    const answer = (overrides?.[stop.id] ?? (proposal?.answer as StopAnswer | undefined)) ?? null
    if (!answer || typeof answer !== "object" || !("kind" in answer)) {
      details.push({ stopId: stop.id, status: "skipped", reason: "no_proposal_or_override" })
      continue
    }

    try {
      const derived = deriveFromAnswer(answer, {
        ruleCode: stop.merchantRule?.code,
        ruleLine: stop.merchantRule?.scheduleCLine,
      })
      await prisma.$transaction(
        async (tx) => {
          for (const txId of stop.transactionIds) {
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
                source: (overrides && overrides[stop.id]
                  ? "USER"
                  : "AI_USER_CONFIRMED") as ClassificationSource,
                reasoning: `Approved from /review${overrides?.[stop.id] ? " (CPA edit)" : ""}: ${derived.reasoning}`,
                substantiation: derived.substantiation
                  ? (derived.substantiation as Prisma.InputJsonValue)
                  : undefined,
                isCurrent: true,
                createdByUserId: userId,
              },
            })
          }

          await tx.stopItem.update({
            where: { id: stop.id },
            data: {
              state: "ANSWERED",
              answeredAt: new Date(),
              userAnswer: {
                approvedFromReview: true,
                edited: !!overrides?.[stop.id],
                code: derived.code,
                businessPct: derived.businessPct,
                scheduleCLine: derived.scheduleCLine,
              } as unknown as Prisma.InputJsonValue,
            },
          })

          await tx.auditEvent.create({
            data: {
              userId,
              actorType: "USER",
              eventType: "STOP_RESOLVED",
              entityType: "StopItem",
              entityId: stop.id,
              afterState: {
                code: derived.code,
                businessPct: derived.businessPct,
                approvedFromReview: true,
                edited: !!overrides?.[stop.id],
              } as Prisma.InputJsonValue,
              rationale: derived.reasoning,
            },
          })
        },
        { timeout: 60_000 },
      )
      approved++
      details.push({ stopId: stop.id, status: "approved" })
    } catch (err) {
      errors++
      const reason = err instanceof Error ? err.message.slice(0, 120) : "unknown_error"
      console.error("[approveProposals] failed for", stop.id, err)
      details.push({ stopId: stop.id, status: "error", reason })
    }
  }

  // House-keeping: archive any STOPs the new classifications now supersede,
  // then recompute the year's stage so REVIEW → LOCKED gates correctly.
  await archiveSupersededStopsForYear(taxYear.id).catch(() => {})
  await recomputeStatus(taxYear.id)

  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/stops`)
  revalidatePath(`/years/${year}/stops/review`)
  revalidatePath(`/years/${year}/ledger`)

  return { approved, errors, details }
}

// ────────────────────────────────────────────────────────────────────────
// overrideAutoApproved — undo a high-confidence auto-applied proposal and
// re-classify with the CPA's chosen answer. The original auto-apply stays
// in the audit history (append-only); we just flip the current
// Classification rows to the new answer.
// ────────────────────────────────────────────────────────────────────────

export async function overrideAutoApproved(
  year: number,
  stopId: string,
  newAnswer: StopAnswer,
): Promise<void> {
  const userId = await getCurrentUserId()
  const stop = await prisma.stopItem.findUnique({
    where: { id: stopId },
    include: { merchantRule: true, taxYear: true },
  })
  if (!stop) throw new Error("StopItem not found")
  if (stop.taxYear.userId !== userId) throw new Error("Not authorized")

  const derived = deriveFromAnswer(newAnswer, {
    ruleCode: stop.merchantRule?.code,
    ruleLine: stop.merchantRule?.scheduleCLine,
  })

  await prisma.$transaction(
    async (tx) => {
      for (const txId of stop.transactionIds) {
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
            source: "USER" as ClassificationSource,
            reasoning: `Override of auto-approved proposal: ${derived.reasoning}`,
            substantiation: derived.substantiation
              ? (derived.substantiation as Prisma.InputJsonValue)
              : undefined,
            isCurrent: true,
            createdByUserId: userId,
          },
        })
      }
      await tx.stopItem.update({
        where: { id: stopId },
        data: {
          state: "ANSWERED",
          answeredAt: new Date(),
          userAnswer: {
            overrideOfAutoApproved: true,
            previousUserAnswer: stop.userAnswer,
            code: derived.code,
            businessPct: derived.businessPct,
          } as unknown as Prisma.InputJsonValue,
        },
      })
      await tx.auditEvent.create({
        data: {
          userId,
          actorType: "USER",
          eventType: "STOP_RE_ANSWERED",
          entityType: "StopItem",
          entityId: stopId,
          beforeState: {
            priorUserAnswer: stop.userAnswer,
          } as Prisma.InputJsonValue,
          afterState: {
            code: derived.code,
            businessPct: derived.businessPct,
            override: true,
          } as Prisma.InputJsonValue,
          rationale: `CPA override from /review: ${derived.reasoning}`,
        },
      })
    },
    { timeout: 60_000 },
  )

  // Propagate the new code to other ledger rows matching this merchant rule
  // so a single override updates every recurring instance.
  if (stop.merchantRule?.merchantKey) {
    await applyMerchantRules(stop.taxYearId, {
      merchantKey: stop.merchantRule.merchantKey,
      force: true,
    }).catch((err) => console.error("[overrideAutoApproved] propagation failed:", err))
  }

  await recomputeStatus(stop.taxYearId)
  revalidatePath(`/years/${year}`)
  revalidatePath(`/years/${year}/stops`)
  revalidatePath(`/years/${year}/stops/review`)
  revalidatePath(`/years/${year}/ledger`)
}
