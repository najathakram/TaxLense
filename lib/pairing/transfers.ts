/**
 * Transfer matching — spec §4.3 Phase 2.
 *
 * For each outflow (amountNormalized > 0) find a matching inflow (-same amount)
 * in another account owned by the same user within ±5 days.
 *
 * amountNormalized convention (from Prompt 3): outflows positive, inflows negative.
 * So: outflow A > 0 pairs with inflow B where B.amountNormalized ≈ -A.
 */

import { prisma } from "@/lib/db"
import type { Transaction, FinancialAccount } from "@/app/generated/prisma/client"
import { fmtUSD } from "@/lib/format/currency"
import { isMoneyMoverOutflow } from "@/lib/accounts/kind"

type TxWithAccount = Transaction & { account: FinancialAccount }


// Widened from 5 → 7 days. ACH transfers initiated late in the day, Wise
// cross-border top-ups, and weekend gaps push real same-amount pairs outside
// a 5-day window — Atif's prod ledger left 45 transfers unpaired (A07 lock
// blocker), many of which were Wise top-ups landing 6 days after the Chase
// outflow. The exact-cents match remains the strong signal so widening the
// date doesn't introduce false positives.
const WINDOW_DAYS = 7
const STOP_THRESHOLD_CENTS = 50000 // $500.00 in cents
const TRANSFER_KEYWORDS = /zelle|venmo|transfer|move|xfer|ach|wire|wise|topup|top up/i

// --------------------------------------------------------------------------
// Score a candidate inflow against an outflow (higher = better match)
// --------------------------------------------------------------------------
function scoreCandidate(outflow: Transaction, candidate: Transaction): number {
  let score = 0

  const dayDelta = Math.abs(
    (outflow.postedDate.getTime() - candidate.postedDate.getTime()) /
      (1000 * 60 * 60 * 24)
  )

  // Same day = best
  if (dayDelta < 0.5) score += 100
  // Inverse of date distance
  score += (WINDOW_DAYS - Math.floor(dayDelta)) * 10

  // Raw description transfer-keyword boosts
  if (TRANSFER_KEYWORDS.test(outflow.merchantRaw)) score += 20
  if (TRANSFER_KEYWORDS.test(candidate.merchantRaw)) score += 20

  return score
}

// --------------------------------------------------------------------------
// Convert Decimal to integer cents for exact comparison
// --------------------------------------------------------------------------
function toCents(d: { toString(): string } | null | undefined): number {
  if (!d) return 0
  return Math.round(Number(d.toString()) * 100)
}

// --------------------------------------------------------------------------
// Main
// --------------------------------------------------------------------------

export interface MatchTransfersResult {
  paired: number
  /**
   * Outflows classified as TRANSFER because they go to a money-mover
   * wallet (Wise, PayPal, Venmo, etc.) where 1:1 inflow pairing isn't
   * possible. These are intentionally unpaired; A07 excludes them.
   */
  moneyMoverTransfers: number
  stopItemsCreated: number
}

export async function matchTransfers(taxYearId: string): Promise<MatchTransfersResult> {
  // Pull all unlinked transactions for this tax year
  const allTx = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isTransferPairedWith: null,
      isPaymentPairedWith: null,
      isDuplicateOf: null,
    },
    include: { account: true },
  })

  // Build outflows and inflows
  const outflows = allTx.filter((t) => toCents(t.amountNormalized) > 0)
  const inflows = allTx.filter((t) => toCents(t.amountNormalized) < 0)

  // Index inflows: Map<accountId|absCents, Transaction[]>
  const inflowIndex = new Map<string, TxWithAccount[]>()
  for (const inf of inflows) {
    const absCents = Math.abs(toCents(inf.amountNormalized))
    const k = `${inf.accountId}|${absCents}`
    if (!inflowIndex.has(k)) inflowIndex.set(k, [])
    inflowIndex.get(k)!.push(inf)
  }

  // Track which tx IDs have been claimed as pairs
  const claimed = new Set<string>()

  const pairs: Array<{ out: TxWithAccount; inTx: TxWithAccount }> = []

  for (const out of outflows) {
    const absCents = toCents(out.amountNormalized)
    if (absCents <= 0) continue

    const dateMin = new Date(out.postedDate.getTime() - WINDOW_DAYS * 86400000)
    const dateMax = new Date(out.postedDate.getTime() + WINDOW_DAYS * 86400000)

    // Find candidate inflows in OTHER accounts belonging to the same user
    const candidates: TxWithAccount[] = []
    for (const [key, txList] of inflowIndex) {
      const [accountId, cents] = key.split("|")
      if (accountId === out.accountId) continue
      if (Number(cents) !== absCents) continue

      for (const t of txList) {
        if (claimed.has(t.id)) continue
        if (t.postedDate < dateMin || t.postedDate > dateMax) continue
        // Verify same user (account ownership)
        if (t.account.userId !== out.account.userId) continue
        candidates.push(t)
      }
    }

    if (candidates.length === 0) continue

    // Pick best candidate by score, then by id for determinism
    candidates.sort((a, b) => {
      const sd = scoreCandidate(out, b) - scoreCandidate(out, a)
      if (sd !== 0) return sd
      return a.id.localeCompare(b.id)
    })

    const best = candidates[0]!
    claimed.add(best.id)
    claimed.add(out.id)
    pairs.push({ out, inTx: best })
  }

  // Write pairs in a transaction — classification rows for TRANSFER
  let paired = 0
  for (const { out, inTx } of pairs) {
    await prisma.$transaction([
      prisma.transaction.update({
        where: { id: out.id },
        data: { isTransferPairedWith: inTx.id },
      }),
      prisma.transaction.update({
        where: { id: inTx.id },
        data: { isTransferPairedWith: out.id },
      }),
      prisma.classification.updateMany({
        where: { transactionId: out.id, isCurrent: true },
        data: { isCurrent: false },
      }),
      prisma.classification.updateMany({
        where: { transactionId: inTx.id, isCurrent: true },
        data: { isCurrent: false },
      }),
      prisma.classification.create({
        data: {
          transactionId: out.id,
          code: "TRANSFER",
          scheduleCLine: null,
          businessPct: 0,
          ircCitations: [],
          confidence: 0.99,
          evidenceTier: 2,
          source: "AI_USER_CONFIRMED",
          reasoning: `Transfer pair: matched inflow ${inTx.id} in account ${inTx.accountId} same amount ±${WINDOW_DAYS}d`,
          isCurrent: true,
        },
      }),
      prisma.classification.create({
        data: {
          transactionId: inTx.id,
          code: "TRANSFER",
          scheduleCLine: null,
          businessPct: 0,
          ircCitations: [],
          confidence: 0.99,
          evidenceTier: 2,
          source: "AI_USER_CONFIRMED",
          reasoning: `Transfer pair: matched outflow ${out.id} in account ${out.accountId} same amount ±${WINDOW_DAYS}d`,
          isCurrent: true,
        },
      }),
    ])
    paired++
  }

  // Money-mover sweep — for any unpaired outflow whose merchant text names
  // a known wallet (Wise, PayPal, Venmo, Cash App, Stripe, Zelle to,
  // Pocketsflow, Remitly, Revolut), classify as TRANSFER without requiring
  // a paired inflow on a known account. Why: money-mover wallets aggregate
  // balance — a single $1,500 Chase→Wise top-up may fund three smaller Wise
  // outflows over the next month, so 1:1 pairing structurally fails.
  // Pre-fix: both legs survived as WRITE_OFF_COGS → ~$8K of double-counted
  // COGS on Atif's ledger.
  const pairedOutIds = new Set(pairs.map((p) => p.out.id))
  const moneyMoverOutflows = outflows.filter(
    (t) =>
      !pairedOutIds.has(t.id) &&
      !claimed.has(t.id) &&
      isMoneyMoverOutflow(t.merchantRaw),
  )
  let moneyMoverTransfers = 0
  for (const t of moneyMoverOutflows) {
    await prisma.$transaction([
      prisma.classification.updateMany({
        where: { transactionId: t.id, isCurrent: true },
        data: { isCurrent: false },
      }),
      prisma.classification.create({
        data: {
          transactionId: t.id,
          code: "TRANSFER",
          scheduleCLine: null,
          businessPct: 0,
          ircCitations: [],
          confidence: 0.92,
          evidenceTier: 2,
          source: "AI_USER_CONFIRMED",
          reasoning: `Money-mover outflow: destination is a wallet (${t.merchantRaw}); aggregated balance prevents 1:1 pairing. Real expense booked from the wallet's own outflows.`,
          isCurrent: true,
        },
      }),
    ])
    claimed.add(t.id)
    moneyMoverTransfers++
  }

  // STOP items for unmatched outflows > $500 with transfer-like keywords
  // (excluding the money-mover sweep above — those are correctly classified).
  // De-dupe against existing STOPs first — without this, every Run autonomous
  // CPA click triggers another matchTransfers pass that creates a NEW STOP
  // for each unmatched outflow. On Atif's prod ledger 7 outflows became
  // 7→14→21 STOPs across three clicks. We only create a STOP if the txn
  // doesn't already have a TRANSFER-category StopItem in any state (PENDING /
  // ANSWERED / DEFERRED — already-resolved STOPs shouldn't be re-created).
  const unmatchedTransferOutflows = outflows.filter(
    (t) =>
      !pairedOutIds.has(t.id) &&
      !claimed.has(t.id) &&
      toCents(t.amountNormalized) >= STOP_THRESHOLD_CENTS &&
      TRANSFER_KEYWORDS.test(t.merchantRaw)
  )
  const existingTransferStops = await prisma.stopItem.findMany({
    where: { taxYearId, category: "TRANSFER" },
    select: { transactionIds: true },
  })
  const txnsAlreadyHaveStop = new Set<string>()
  for (const s of existingTransferStops) {
    for (const id of s.transactionIds) txnsAlreadyHaveStop.add(id)
  }

  let stopItemsCreated = 0
  for (const t of unmatchedTransferOutflows) {
    if (txnsAlreadyHaveStop.has(t.id)) continue
    const amountCents = toCents(t.amountNormalized)
    const amountDollars = amountCents / 100
    const amountRaw = amountDollars.toFixed(2) // canonical, no commas — for context.amount
    const amountDisplay = fmtUSD(amountDollars, { cents: true })
    await prisma.stopItem.create({
      data: {
        taxYearId,
        merchantRuleId: null,
        category: "TRANSFER",
        question: `Unmatched outflow of ${amountDisplay} from ${t.account.nickname ?? t.account.institution} on ${t.postedDate.toISOString().slice(0, 10)}: "${t.merchantRaw}" — no matching inflow found in your other accounts. Who is this?`,
        context: {
          transactionId: t.id,
          amount: amountRaw,
          date: t.postedDate.toISOString().slice(0, 10),
          merchantRaw: t.merchantRaw,
          accountNickname: t.account.nickname ?? t.account.institution,
        },
        transactionIds: [t.id],
        state: "PENDING",
      },
    })
    stopItemsCreated++
  }

  return { paired, moneyMoverTransfers, stopItemsCreated }
}
