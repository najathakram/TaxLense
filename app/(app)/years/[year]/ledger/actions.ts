"use server"

import { prisma } from "@/lib/db"
import { getCurrentUserId } from "@/lib/auth"
import { revalidatePath } from "next/cache"
import type { TransactionCode, ClassificationSource } from "@/app/generated/prisma/client"
import { MAX_SPLITS_PER_TRANSACTION } from "@/lib/splits/config"
import { batchCategorizeMerchants } from "@/lib/ai/merchantCategories"

export async function fetchMerchantCategories(
  year: number,
  merchants: string[],
): Promise<Record<string, string>> {
  const userId = await getCurrentUserId()
  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) return {}
  return batchCategorizeMerchants(merchants)
}

// ---------- inline reclassify for a single row ----------

export interface SingleEdit {
  transactionId: string
  code?: TransactionCode
  scheduleCLine?: string | null
  businessPct?: number
  confirm?: boolean // toggle is_user_confirmed
}

export async function editClassification(year: number, edit: SingleEdit) {
  const userId = await getCurrentUserId()

  await prisma.$transaction(async (tx) => {
    const txn = await tx.transaction.findUnique({
      where: { id: edit.transactionId },
      include: { taxYear: true, classifications: { where: { isCurrent: true }, take: 1 } },
    })
    if (!txn) throw new Error("Transaction not found")
    if (txn.taxYear.userId !== userId) throw new Error("Not authorized")

    const current = txn.classifications[0]

    const code = edit.code ?? current?.code ?? "NEEDS_CONTEXT"
    const scheduleCLine =
      edit.scheduleCLine !== undefined ? edit.scheduleCLine : current?.scheduleCLine ?? null
    const businessPct = edit.businessPct ?? current?.businessPct ?? 0
    const evidenceTier = current?.evidenceTier ?? 3
    const ircCitations = current?.ircCitations ?? []
    const reasoning = edit.confirm
      ? `${current?.reasoning ?? ""} [User confirmed]`.trim()
      : `User inline edit: ${edit.code ?? code} at ${businessPct}%.`
    const source: ClassificationSource = edit.confirm ? "AI_USER_CONFIRMED" : "USER"

    await tx.classification.updateMany({
      where: { transactionId: edit.transactionId, isCurrent: true },
      data: { isCurrent: false },
    })
    await tx.classification.create({
      data: {
        transactionId: edit.transactionId,
        code,
        scheduleCLine,
        businessPct,
        ircCitations,
        confidence: edit.confirm ? 1.0 : current?.confidence ?? 0.8,
        evidenceTier,
        source,
        reasoning,
        isCurrent: true,
        createdByUserId: userId,
      },
    })

    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "LEDGER_EDIT",
        entityType: "Classification",
        entityId: edit.transactionId,
        beforeState: current
          ? { code: current.code, businessPct: current.businessPct, scheduleCLine: current.scheduleCLine }
          : undefined,
        afterState: { code, businessPct, scheduleCLine, confirmed: !!edit.confirm },
      },
    })
  })

  revalidatePath(`/years/${year}/ledger`)
}

// ---------- bulk reclassify ----------

export interface BulkEdit {
  transactionIds: string[]
  code?: TransactionCode
  businessPct?: number
  confirm?: boolean
}

export async function bulkReclassify(year: number, edit: BulkEdit) {
  const userId = await getCurrentUserId()

  if (edit.transactionIds.length === 0) return { updated: 0 }
  if (edit.transactionIds.length > 1000) throw new Error("Too many transactions (max 1000)")

  let updated = 0
  await prisma.$transaction(
    async (tx) => {
      for (const id of edit.transactionIds) {
        const current = await tx.classification.findFirst({
          where: { transactionId: id, isCurrent: true },
        })
        const txn = await tx.transaction.findUnique({
          where: { id },
          include: { taxYear: true },
        })
        if (!txn) continue
        if (txn.taxYear.userId !== userId) throw new Error("Not authorized")

        const code = edit.code ?? current?.code ?? "NEEDS_CONTEXT"
        const pct = edit.businessPct ?? current?.businessPct ?? 0
        const source: ClassificationSource = edit.confirm ? "AI_USER_CONFIRMED" : "USER"

        await tx.classification.updateMany({
          where: { transactionId: id, isCurrent: true },
          data: { isCurrent: false },
        })
        await tx.classification.create({
          data: {
            transactionId: id,
            code,
            scheduleCLine: current?.scheduleCLine ?? null,
            businessPct: pct,
            ircCitations: current?.ircCitations ?? [],
            confidence: edit.confirm ? 1.0 : current?.confidence ?? 0.8,
            evidenceTier: current?.evidenceTier ?? 3,
            source,
            reasoning: `Bulk action: ${edit.code ? `code→${edit.code} ` : ""}${edit.businessPct != null ? `pct→${pct} ` : ""}${edit.confirm ? "confirmed" : ""}`.trim(),
            isCurrent: true,
            createdByUserId: userId,
          },
        })
        await tx.auditEvent.create({
          data: {
            userId,
            actorType: "USER",
            eventType: "LEDGER_BULK",
            entityType: "Classification",
            entityId: id,
            beforeState: current
              ? { code: current.code, businessPct: current.businessPct }
              : undefined,
            afterState: { code, businessPct: pct, confirmed: !!edit.confirm },
          },
        })
        updated++
      }
    },
    { timeout: 60_000 }
  )

  revalidatePath(`/years/${year}/ledger`)
  return { updated }
}

// ---------- split transaction (Amazon) ----------

export interface SplitInput {
  amount: number
  code: TransactionCode
  scheduleCLine: string | null
  businessPct: number
  reasoning: string
}

export async function splitTransaction(year: number, parentId: string, splits: SplitInput[]) {
  const userId = await getCurrentUserId()

  if (splits.length < 1) throw new Error("At least one split required")
  if (splits.length > MAX_SPLITS_PER_TRANSACTION)
    throw new Error(`Max ${MAX_SPLITS_PER_TRANSACTION} splits per transaction`)

  await prisma.$transaction(async (tx) => {
    const parent = await tx.transaction.findUnique({
      where: { id: parentId },
      include: { taxYear: true },
    })
    if (!parent) throw new Error("Parent transaction not found")
    if (parent.taxYear.userId !== userId) throw new Error("Not authorized")
    if (parent.isSplit) throw new Error("Transaction is already split")
    if (parent.splitOfId) throw new Error("Cannot split a child of another split")

    const parentCents = Math.round(Number(parent.amountNormalized.toString()) * 100)
    const sumCents = splits.reduce((s, x) => s + Math.round(x.amount * 100), 0)
    if (parentCents !== sumCents) {
      throw new Error(
        `Split sum (${(sumCents / 100).toFixed(2)}) must equal parent amount (${(parentCents / 100).toFixed(2)})`
      )
    }

    const parentSign = Math.sign(Number(parent.amountOriginal.toString())) || 1

    // Flip parent classifications
    await tx.classification.updateMany({
      where: { transactionId: parent.id, isCurrent: true },
      data: { isCurrent: false },
    })

    const childrenCreated: string[] = []
    for (let i = 0; i < splits.length; i++) {
      const s = splits[i]!
      const childId = `${parent.id}_s${i}`
      const childOriginalAmount = s.amount * parentSign

      await tx.transaction.create({
        data: {
          id: childId,
          statementImportId: parent.statementImportId,
          accountId: parent.accountId,
          taxYearId: parent.taxYearId,
          postedDate: parent.postedDate,
          transactionDate: parent.transactionDate,
          amountOriginal: childOriginalAmount.toFixed(2),
          amountNormalized: s.amount.toFixed(2),
          merchantRaw: `${parent.merchantRaw} [split ${i + 1}/${splits.length}]`,
          merchantNormalized: parent.merchantNormalized,
          descriptionRaw: parent.descriptionRaw,
          idempotencyKey: `${parent.id}|split|${i}|${Math.round(s.amount * 100)}`,
          splitOfId: parent.id,
        },
      })
      await tx.classification.create({
        data: {
          transactionId: childId,
          code: s.code,
          scheduleCLine: s.scheduleCLine,
          businessPct: s.businessPct,
          ircCitations: [],
          confidence: 1.0,
          evidenceTier: 3,
          source: "USER",
          reasoning: s.reasoning,
          isCurrent: true,
          createdByUserId: userId,
        },
      })
      childrenCreated.push(childId)
    }

    await tx.transaction.update({
      where: { id: parent.id },
      data: { isSplit: true },
    })

    await tx.auditEvent.create({
      data: {
        userId,
        actorType: "USER",
        eventType: "TXN_SPLIT",
        entityType: "Transaction",
        entityId: parent.id,
        beforeState: {
          parentAmount: Number(parent.amountNormalized.toString()),
          merchant: parent.merchantRaw,
        },
        afterState: {
          childIds: childrenCreated,
          splits: splits.map((s) => ({
            amount: s.amount,
            code: s.code,
            businessPct: s.businessPct,
          })),
        },
      },
    })
  })

  revalidatePath(`/years/${year}/ledger`)
}

// ---------- apply NL override (invoked after preview) ----------

export interface NLMatch {
  transactionId: string
  newCode: TransactionCode
  newBusinessPct: number
  newScheduleCLine: string | null
  ircCitations: string[]
  evidenceTier: number
  reasoning: string
}

export interface NLRuleUpdate {
  merchantKey: string
  code: TransactionCode
  businessPctDefault: number
  scheduleCLine: string | null
  ircCitations: string[]
  reasoning: string
}

export async function applyReclassification(
  year: number,
  instruction: string,
  matches: NLMatch[],
  ruleUpdates: NLRuleUpdate[]
) {
  const userId = await getCurrentUserId()

  if (matches.length === 0) return { updated: 0, rulesUpdated: 0 }
  if (matches.length > 500) throw new Error("Too many transactions (max 500)")

  let updated = 0
  let rulesUpdated = 0
  await prisma.$transaction(
    async (tx) => {
      for (const m of matches) {
        const txn = await tx.transaction.findUnique({
          where: { id: m.transactionId },
          include: { taxYear: true },
        })
        if (!txn) continue
        if (txn.taxYear.userId !== userId) throw new Error("Not authorized")

        await tx.classification.updateMany({
          where: { transactionId: m.transactionId, isCurrent: true },
          data: { isCurrent: false },
        })
        await tx.classification.create({
          data: {
            transactionId: m.transactionId,
            code: m.newCode,
            scheduleCLine: m.newScheduleCLine,
            businessPct: m.newBusinessPct,
            ircCitations: m.ircCitations,
            confidence: 1.0,
            evidenceTier: m.evidenceTier,
            source: "USER",
            reasoning: `NL override: "${instruction.slice(0, 160)}" — ${m.reasoning}`,
            isCurrent: true,
            createdByUserId: userId,
          },
        })
        updated++
      }

      // Find the taxYearId from the first match
      if (ruleUpdates.length > 0 && matches.length > 0) {
        const firstTx = await tx.transaction.findUnique({
          where: { id: matches[0]!.transactionId },
        })
        if (firstTx) {
          for (const r of ruleUpdates) {
            await tx.merchantRule.upsert({
              where: {
                taxYearId_merchantKey: { taxYearId: firstTx.taxYearId, merchantKey: r.merchantKey },
              },
              create: {
                taxYearId: firstTx.taxYearId,
                merchantKey: r.merchantKey,
                code: r.code,
                scheduleCLine: r.scheduleCLine,
                businessPctDefault: r.businessPctDefault,
                appliesTripOverride: false,
                ircCitations: r.ircCitations,
                evidenceTierDefault: 3,
                confidence: 1.0,
                reasoning: r.reasoning,
                requiresHumanInput: false,
                isConfirmed: true,
              },
              update: {
                code: r.code,
                scheduleCLine: r.scheduleCLine,
                businessPctDefault: r.businessPctDefault,
                ircCitations: r.ircCitations,
                reasoning: r.reasoning,
                requiresHumanInput: false,
                isConfirmed: true,
                confidence: 1.0,
              },
            })
            rulesUpdated++
          }
        }
      }

      await tx.auditEvent.create({
        data: {
          userId,
          actorType: "USER",
          eventType: "NL_OVERRIDE",
          entityType: "Classification",
          entityId: null,
          beforeState: { instruction, matchCount: matches.length },
          afterState: { updated, rulesUpdated },
          rationale: instruction,
        },
      })
    },
    { timeout: 60_000 }
  )

  revalidatePath(`/years/${year}/ledger`)
  return { updated, rulesUpdated }
}
