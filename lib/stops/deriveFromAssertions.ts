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
import { fmtUSD } from "@/lib/format/currency"

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
      isStale: false,
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
    // Skip if ANY existing stop covers this transaction, regardless of
    // state. The previous "only skip PENDING" rule fed an infinite loop:
    // when a stop was answered as OTHER (or auto-applied as
    // NEEDS_CONTEXT), the underlying transaction's current classification
    // stayed NEEDS_CONTEXT, which re-matched the OR clause above on the
    // next page load and re-created a fresh PENDING stop. The CPA would
    // press Generate, watch 8 proposals get persisted, and on reload see
    // 8 brand-new blank-radio cards because deriveStopsFromAssertions had
    // forgotten the prior decision and made new shells with no aiSuggestion.
    //
    // The user can still re-answer an ANSWERED stop via the "Show
    // answered" toggle on /stops — we just don't materialize a duplicate.
    const existingStop = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "DEPOSIT",
        transactionIds: { has: tx.id },
      },
    })
    if (existingStop) continue
    const absDollars = Math.abs(Number(tx.amountNormalized.toString()))
    const abs = absDollars.toFixed(2) // canonical for stop.context — keep machine-readable
    const absDisplay = fmtUSD(absDollars, { cents: true })
    const dateStr = tx.postedDate.toISOString().slice(0, 10)
    await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "DEPOSIT",
        question: `Deposit of ${absDisplay} on ${dateStr} from "${tx.merchantRaw}" — what kind of inflow is this? (client payment, 1099 platform, owner contribution, gift, loan, refund, or other)`,
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
      isStale: false,
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

    // Same any-state skip as the DEPOSIT branch above — see comment there.
    const existingStop = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "SECTION_274D",
        transactionIds: { has: tx.id },
      },
    })
    if (existingStop) continue

    const absDollars = Math.abs(Number(tx.amountNormalized.toString()))
    const abs = absDollars.toFixed(2)
    const absDisplay = fmtUSD(absDollars, { cents: true })
    const dateStr = tx.postedDate.toISOString().slice(0, 10)
    await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "SECTION_274D",
        question: `Meal on ${dateStr} at "${tx.merchantRaw}" (${absDisplay}) — who attended and what was the business purpose? §274(d) requires contemporaneous substantiation for any meal deduction.`,
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
