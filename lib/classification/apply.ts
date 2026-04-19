/**
 * Rule application — spec §4.4 Phase 3, step 6.
 *
 * For each Transaction lacking a current Classification, find its MerchantRule
 * and create a Classification. Trip override logic promotes GRAY/travel codes
 * to WRITE_OFF_TRAVEL when the transaction date falls inside a confirmed trip.
 *
 * Idempotent: if a transaction already has an AI Classification, skip it
 * unless force=true is passed.
 */

import { prisma } from "@/lib/db"
import type { MerchantRule, Trip, TransactionCode } from "@/app/generated/prisma/client"


const RESTAURANT_CODES: TransactionCode[] = ["MEALS_50", "MEALS_100"]
const RESTAURANT_LINES = ["Line 24b Meals"]

function isRestaurantRule(rule: MerchantRule): boolean {
  return (
    RESTAURANT_CODES.includes(rule.code) ||
    RESTAURANT_LINES.includes(rule.scheduleCLine ?? "")
  )
}

function dateInTrip(date: Date, trip: Trip): boolean {
  return date >= trip.startDate && date <= trip.endDate
}

export interface ApplyRulesResult {
  classified: number
  tripOverrides: number
  skipped: number
}

export async function applyMerchantRules(
  taxYearId: string,
  options: { force?: boolean } = {}
): Promise<ApplyRulesResult> {
  // Load all merchant rules for this year
  const rules = await prisma.merchantRule.findMany({ where: { taxYearId } })
  const ruleByKey = new Map(rules.map((r) => [r.merchantKey.toUpperCase(), r]))

  // Load confirmed trips
  const trips = await prisma.trip.findMany({
    where: { profile: { taxYearId }, isConfirmed: true },
  })

  // Load transactions needing classification
  // Skip already-paired (TRANSFER / PAYMENT handled by pairing steps)
  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isTransferPairedWith: null,
      isPaymentPairedWith: null,
      isDuplicateOf: null,
      merchantNormalized: { not: null },
    },
  })

  let classified = 0
  let tripOverrides = 0
  let skipped = 0

  for (const tx of txns) {
    // Check for existing current AI classification
    if (!options.force) {
      const existing = await prisma.classification.findFirst({
        where: { transactionId: tx.id, isCurrent: true },
      })
      if (existing) {
        skipped++
        continue
      }
    }

    const key = tx.merchantNormalized!.toUpperCase()
    const rule = ruleByKey.get(key)

    if (!rule) {
      // No rule — residual agent (Prompt 6) will handle
      skipped++
      continue
    }

    // Determine base values from rule
    let code: TransactionCode = rule.requiresHumanInput ? "NEEDS_CONTEXT" : rule.code
    let pct = rule.businessPctDefault
    let tier = rule.evidenceTierDefault
    let citations = [...rule.ircCitations]
    let reasoning = rule.reasoning ?? `Classified by Merchant Intelligence rule for ${rule.merchantKey}.`

    // Trip override logic (spec §3.2)
    if (rule.appliesTripOverride && !rule.requiresHumanInput) {
      const activeTrip = trips.find((t) => dateInTrip(tx.postedDate, t))
      if (activeTrip) {
        if (isRestaurantRule(rule)) {
          // Restaurant during trip → MEALS_50 at 100% (still 50% deductible by code)
          code = "MEALS_50"
          pct = 100
          tier = Math.min(tier, 2)
        } else {
          code = "WRITE_OFF_TRAVEL"
          pct = 100
          tier = Math.min(tier, 2)
        }
        // Deduplicate citations
        const travelCitations = ["§162", "§274(d)"]
        for (const c of travelCitations) {
          if (!citations.includes(c)) citations.push(c)
        }
        reasoning =
          `${reasoning} [Trip override: "${activeTrip.name}" ${activeTrip.startDate.toISOString().slice(0, 10)}–${activeTrip.endDate.toISOString().slice(0, 10)}, ${activeTrip.destination}]`
        tripOverrides++
      }
    }

    // Flip any prior current classification to false
    await prisma.classification.updateMany({
      where: { transactionId: tx.id, isCurrent: true },
      data: { isCurrent: false },
    })

    // Insert new classification
    await prisma.classification.create({
      data: {
        transactionId: tx.id,
        code,
        scheduleCLine: rule.scheduleCLine,
        businessPct: pct,
        ircCitations: citations,
        confidence: rule.confidence,
        evidenceTier: tier,
        source: "AI",
        reasoning,
        isCurrent: true,
      },
    })

    classified++
  }

  return { classified, tripOverrides, skipped }
}

// ---------------------------------------------------------------------------
// Also: run merchant normalization on raw transactions that haven't been normalized yet
// ---------------------------------------------------------------------------
import { normalizeMerchant } from "@/lib/merchants/normalize"

export async function normalizeMerchantsForYear(taxYearId: string): Promise<number> {
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, merchantNormalized: null },
    select: { id: true, merchantRaw: true },
  })

  let updated = 0
  for (const tx of txns) {
    const { key } = normalizeMerchant(tx.merchantRaw)
    await prisma.transaction.update({
      where: { id: tx.id },
      data: { merchantNormalized: key },
    })
    updated++
  }
  return updated
}
