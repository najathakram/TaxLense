/**
 * Refund pairing — spec §4.3 Phase 2.
 *
 * A refund on a credit card appears as an inflow (amountNormalized < 0) that is
 * NOT a payment. We match it to the nearest prior positive charge at the same
 * normalized merchant within a 90-day window.
 *
 * Link is one-way: refund.isRefundPairedWith = original.id
 * The offset is applied at lock time when computing deductible amounts.
 */

import { prisma } from "@/lib/db"
import type { Transaction, FinancialAccount } from "@/app/generated/prisma/client"

type TxWithAccount = Transaction & { account: FinancialAccount }


const REFUND_WINDOW_DAYS = 90

// Same patterns used in payments.ts — exclude payment credits from refund candidates
const PAYMENT_PATTERNS =
  /payment\s+thank\s+you|online\s+payment|autopay|mobile\s+payment|bill\s+pay|credit\s+crd|card\s+payment|automatic\s+payment|payment\s+received|e-?payment/i

function toCents(d: { toString(): string } | null | undefined): number {
  if (!d) return 0
  return Math.round(Number(d.toString()) * 100)
}

export interface MatchRefundsResult {
  paired: number
}

export async function matchRefunds(taxYearId: string): Promise<MatchRefundsResult> {
  // Pull all credit card transactions for this tax year (refunds only happen on cards)
  const cardTx = await prisma.transaction.findMany({
    where: {
      taxYearId,
      account: { type: "CREDIT_CARD" },
      isRefundPairedWith: null,
      isDuplicateOf: null,
    },
    include: { account: true },
    orderBy: { postedDate: "asc" },
  })

  // Refund candidates: inflows on cards that are NOT payment thank-yous
  const refundCandidates = cardTx.filter(
    (t) =>
      toCents(t.amountNormalized) < 0 &&
      !PAYMENT_PATTERNS.test(t.merchantRaw) &&
      // Must have a normalized merchant to match against
      !!t.merchantNormalized
  )

  // Original charges: outflows on the same card
  const charges = cardTx.filter((t) => toCents(t.amountNormalized) > 0)

  // Index charges by accountId|merchantNormalized → Transaction[] (sorted by date asc)
  const chargeIndex = new Map<string, TxWithAccount[]>()
  for (const c of charges) {
    if (!c.merchantNormalized) continue
    const k = `${c.accountId}|${c.merchantNormalized.toUpperCase()}`
    if (!chargeIndex.has(k)) chargeIndex.set(k, [])
    chargeIndex.get(k)!.push(c)
  }

  const claimedOriginals = new Set<string>()
  const pairs: Array<{ refund: TxWithAccount; original: TxWithAccount }> = []

  for (const refund of refundCandidates) {
    const merchantKey = refund.merchantNormalized!.toUpperCase()
    const k = `${refund.accountId}|${merchantKey}`
    const candidates = chargeIndex.get(k) ?? []

    const windowStart = new Date(
      refund.postedDate.getTime() - REFUND_WINDOW_DAYS * 86400000
    )

    // Find prior charges at same merchant within 90 days that haven't been claimed
    const eligible = candidates.filter(
      (c) =>
        !claimedOriginals.has(c.id) &&
        c.postedDate >= windowStart &&
        c.postedDate < refund.postedDate
    )

    if (eligible.length === 0) continue

    const absCents = Math.abs(toCents(refund.amountNormalized))

    // Prefer smallest amount delta (handles partial refunds), then closest prior date
    eligible.sort((a, b) => {
      const aDelta = Math.abs(toCents(a.amountNormalized) - absCents)
      const bDelta = Math.abs(toCents(b.amountNormalized) - absCents)
      if (aDelta !== bDelta) return aDelta - bDelta
      // Closest prior date
      return b.postedDate.getTime() - a.postedDate.getTime()
    })

    const original = eligible[0]!
    claimedOriginals.add(original.id)
    pairs.push({ refund, original })
  }

  let paired = 0
  for (const { refund, original } of pairs) {
    await prisma.transaction.update({
      where: { id: refund.id },
      data: { isRefundPairedWith: original.id },
    })
    paired++
  }

  return { paired }
}
