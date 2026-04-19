/**
 * Card payment matching — spec §4.3 Phase 2.
 *
 * A credit card "Payment Thank You" (inflow on card, amountNormalized < 0)
 * is matched to an outflow from a CHECKING account (amountNormalized > 0)
 * with the same absolute dollar amount within ±5 days.
 *
 * Both rows are classified as PAYMENT and excluded from P&L.
 */

import { prisma } from "@/lib/db"
import type { Transaction, FinancialAccount } from "@/app/generated/prisma/client"

type TxWithAccount = Transaction & { account: FinancialAccount }


const WINDOW_DAYS = 5

// Patterns that indicate this is a card payment received, not a purchase
const PAYMENT_PATTERNS =
  /payment\s+thank\s+you|online\s+payment|autopay|mobile\s+payment|bill\s+pay|credit\s+crd|card\s+payment|automatic\s+payment|payment\s+received|e-?payment/i

function toCents(d: { toString(): string } | null | undefined): number {
  if (!d) return 0
  return Math.round(Number(d.toString()) * 100)
}

export interface MatchPaymentsResult {
  paired: number
}

export async function matchCardPayments(taxYearId: string): Promise<MatchPaymentsResult> {
  const allTx = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isTransferPairedWith: null,
      isPaymentPairedWith: null,
      isDuplicateOf: null,
    },
    include: { account: true },
  })

  // Card payment credits: inflows on credit cards matching known payment descriptions
  const cardPayments = allTx.filter(
    (t) =>
      t.account.type === "CREDIT_CARD" &&
      toCents(t.amountNormalized) < 0 &&
      PAYMENT_PATTERNS.test(t.merchantRaw)
  )

  // Checking outflows indexed by userId|cents → Transaction[]
  const checkingOutflows = allTx.filter(
    (t) => t.account.type === "CHECKING" && toCents(t.amountNormalized) > 0
  )
  const checkingIndex = new Map<string, TxWithAccount[]>()
  for (const t of checkingOutflows) {
    const k = `${t.account.userId}|${toCents(t.amountNormalized)}`
    if (!checkingIndex.has(k)) checkingIndex.set(k, [])
    checkingIndex.get(k)!.push(t)
  }

  const claimed = new Set<string>()
  const pairs: Array<{ cardTx: TxWithAccount; checkingTx: TxWithAccount }> = []

  for (const cardTx of cardPayments) {
    const absCents = Math.abs(toCents(cardTx.amountNormalized))
    const k = `${cardTx.account.userId}|${absCents}`
    const candidates = checkingIndex.get(k) ?? []

    const dateMin = new Date(cardTx.postedDate.getTime() - WINDOW_DAYS * 86400000)
    const dateMax = new Date(cardTx.postedDate.getTime() + WINDOW_DAYS * 86400000)

    const windowCandidates = candidates.filter(
      (t) =>
        !claimed.has(t.id) &&
        t.postedDate >= dateMin &&
        t.postedDate <= dateMax
    )

    if (windowCandidates.length === 0) continue

    // Pick closest date, then stable by id
    windowCandidates.sort((a, b) => {
      const da = Math.abs(a.postedDate.getTime() - cardTx.postedDate.getTime())
      const db = Math.abs(b.postedDate.getTime() - cardTx.postedDate.getTime())
      if (da !== db) return da - db
      return a.id.localeCompare(b.id)
    })

    const best = windowCandidates[0]!
    claimed.add(best.id)
    claimed.add(cardTx.id)
    pairs.push({ cardTx, checkingTx: best })
  }

  let paired = 0
  for (const { cardTx, checkingTx } of pairs) {
    await prisma.$transaction([
      prisma.transaction.update({
        where: { id: cardTx.id },
        data: { isPaymentPairedWith: checkingTx.id },
      }),
      prisma.transaction.update({
        where: { id: checkingTx.id },
        data: { isPaymentPairedWith: cardTx.id },
      }),
      prisma.classification.updateMany({
        where: { transactionId: cardTx.id, isCurrent: true },
        data: { isCurrent: false },
      }),
      prisma.classification.updateMany({
        where: { transactionId: checkingTx.id, isCurrent: true },
        data: { isCurrent: false },
      }),
      prisma.classification.create({
        data: {
          transactionId: cardTx.id,
          code: "PAYMENT",
          scheduleCLine: null,
          businessPct: 0,
          ircCitations: [],
          confidence: 0.99,
          evidenceTier: 2,
          source: "AI_USER_CONFIRMED",
          reasoning: `Card payment matched to checking outflow ${checkingTx.id} (${checkingTx.account.institution}) within ±${WINDOW_DAYS}d`,
          isCurrent: true,
        },
      }),
      prisma.classification.create({
        data: {
          transactionId: checkingTx.id,
          code: "PAYMENT",
          scheduleCLine: null,
          businessPct: 0,
          ircCitations: [],
          confidence: 0.99,
          evidenceTier: 2,
          source: "AI_USER_CONFIRMED",
          reasoning: `Credit card payment to ${cardTx.account.institution} ${cardTx.account.mask ?? ""} matched within ±${WINDOW_DAYS}d`,
          isCurrent: true,
        },
      }),
    ])
    paired++
  }

  return { paired }
}
