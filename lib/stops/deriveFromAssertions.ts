/**
 * Materialize STOP items from assertion-failure conditions so the STOPs queue
 * and the Risk dashboard stay in agreement.
 *
 * Today the lock assertions (A08 meal substantiation, A13 deposits
 * reconstruction) detect these gaps but produce no actionable STOP — so the
 * Risk page reports "36 unclassified deposits" while the STOPs page shows
 * "0 deposits to resolve." This module bridges that gap.
 *
 * Idempotent: if a STOP for a given transaction already exists in the right
 * category, it is left alone. Safe to re-run after every Apply Rules pass.
 */
import { prisma } from "@/lib/db"

export interface DeriveStopsResult {
  depositStops: number
  section274dStops: number
}

export async function deriveStopsFromAssertions(
  taxYearId: string,
): Promise<DeriveStopsResult> {
  let depositStops = 0
  let section274dStops = 0

  // ── DEPOSIT: unclassified inflows (A13 contributors) ─────────────────────
  const unclassifiedInflows = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isTransferPairedWith: null,
      isPaymentPairedWith: null,
      amountNormalized: { lt: 0 }, // inflows are negative per spec §4.2
      OR: [
        { classifications: { none: { isCurrent: true } } },
        {
          classifications: {
            some: { isCurrent: true, code: "NEEDS_CONTEXT" },
          },
        },
      ],
    },
    include: { account: true },
  })

  for (const tx of unclassifiedInflows) {
    const existing = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "DEPOSIT",
        transactionIds: { has: tx.id },
        state: { in: ["PENDING", "ANSWERED"] },
      },
    })
    if (existing) continue
    const abs = Math.abs(Number(tx.amountNormalized.toString())).toFixed(2)
    const dateStr = tx.postedDate.toISOString().slice(0, 10)
    await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "DEPOSIT",
        question: `Deposit of $${abs} on ${dateStr} from "${tx.merchantRaw}" — what kind of inflow is this? (client payment, 1099 platform, owner contribution, gift, loan, refund, or other)`,
        context: {
          merchant: tx.merchantRaw,
          totalAmount: abs,
          date: dateStr,
          account: tx.account.nickname ?? tx.account.institution,
        },
        transactionIds: [tx.id],
        state: "PENDING",
      },
    })
    depositStops++
  }

  // ── SECTION_274D: meals missing attendees/purpose (A08 contributors) ─────
  const meals = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      classifications: {
        some: {
          isCurrent: true,
          code: { in: ["MEALS_50", "MEALS_100"] },
        },
      },
    },
    include: {
      account: true,
      classifications: { where: { isCurrent: true }, take: 1 },
    },
  })

  for (const tx of meals) {
    const c = tx.classifications[0]
    if (!c) continue
    const sub = c.substantiation as
      | { attendees?: string; purpose?: string }
      | null
    const attendeesOk = !!sub?.attendees && sub.attendees.trim().length >= 2
    const purposeOk = !!sub?.purpose && sub.purpose.trim().length >= 2
    if (attendeesOk && purposeOk) continue

    const existing = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "SECTION_274D",
        transactionIds: { has: tx.id },
        state: { in: ["PENDING", "ANSWERED"] },
      },
    })
    if (existing) continue

    const abs = Math.abs(Number(tx.amountNormalized.toString())).toFixed(2)
    const dateStr = tx.postedDate.toISOString().slice(0, 10)
    await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "SECTION_274D",
        question: `Meal on ${dateStr} at "${tx.merchantRaw}" ($${abs}) — who attended and what was the business purpose? §274(d) requires contemporaneous substantiation for any meal deduction.`,
        context: {
          merchant: tx.merchantRaw,
          totalAmount: abs,
          date: dateStr,
          code: c.code,
          account: tx.account.nickname ?? tx.account.institution,
        },
        transactionIds: [tx.id],
        state: "PENDING",
      },
    })
    section274dStops++
  }

  return { depositStops, section274dStops }
}
