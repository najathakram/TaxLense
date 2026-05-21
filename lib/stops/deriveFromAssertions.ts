/**
 * Materialize STOP items from assertion-failure conditions so the STOPs queue
 * and the Risk dashboard stay in agreement.
 *
 * Today the lock assertions detect gaps that don't always produce an
 * actionable STOP. Without this bridge the Risk page reports "21 unpaired
 * transfer rows" / "3 §274(d) tier-4 rows" / "$1,700 unclassified deposits"
 * while the STOPs page shows zeroes — the CPA has no path from "blocked"
 * to "fix it." This module materializes STOPs from every blocking assertion:
 *
 *   - A07 TRANSFER paired         → TRANSFER stops for the unpaired rows
 *   - A08 MEALS §274(d) sub        → SECTION_274D stops (existing)
 *   - A09 §274(d) evidenceTier ≤ 3 → SECTION_274D stops for tier-4 rows
 *   - A13 deposits reconstruction → DEPOSIT stops for unclassified inflows
 *
 * Idempotent: if a STOP for a given transaction already exists in the right
 * category, it is left alone. Safe to re-run on every Risk-page load.
 *
 * The "skip if existing stop" rule covers any state — PENDING, DEFERRED,
 * ANSWERED, ARCHIVED. The previous "only skip PENDING" rule fed an infinite
 * loop when an auto-resolved answer left the underlying Classification as
 * NEEDS_CONTEXT (re-matching the source filter and spawning a fresh blank
 * STOP on every reload). Respecting prior decisions wins.
 */
import { prisma } from "@/lib/db"
import { fmtUSD } from "@/lib/format/currency"
import { isMoneyMoverOutflow } from "@/lib/accounts/kind"

export interface DeriveStopsResult {
  depositStops: number
  section274dStops: number
  /** §274(d) tier-4 stops (separate path from meal-substantiation stops). */
  section274dTierStops: number
  /** TRANSFER stops materialized from A07 unpaired-transfer offenders. */
  transferStops: number
}

export async function deriveStopsFromAssertions(
  taxYearId: string,
): Promise<DeriveStopsResult> {
  // NOTE: an earlier iteration of this module called
  // archiveSupersededStopsForYear at the top here to clean up stale stops.
  // It backfired: that helper archives any PENDING stop whose underlying
  // transaction has a non-NEEDS_CONTEXT classification — but a TRANSFER-
  // coded row WITHOUT a paired counterparty is still an A07 offender even
  // though TRANSFER ≠ NEEDS_CONTEXT. The archive ran first, then the
  // "skip if existing stop" guard further down stopped fresh stops from
  // being created (the just-archived stop matched the existsAny query).
  // Net effect on Atif's prod ledger: 38 PENDING stops disappeared in
  // one shot and the queue went empty while A07 still failed.
  //
  // The right place to archive stops is at the resolve/answer site (which
  // already calls archiveSupersededStopsForYear) and the user's explicit
  // "Archive superseded" button on /stops. Both honor the semantic
  // intended for archive — "the user resolved this STOP and the
  // classification changed" — instead of "any stop whose row isn't
  // NEEDS_CONTEXT." Don't auto-archive on every page load.

  let depositStops = 0
  let section274dStops = 0
  let section274dTierStops = 0
  let transferStops = 0

  // ── DEPOSIT: unclassified inflows (A13 contributors) ─────────────────────
  // A13 counts an inflow as "unclassified" when its current classification
  // is NOT in {BIZ_INCOME, OWNER_EQUITY, TRANSFER, PERSONAL, PAYMENT}. The
  // original filter only caught NEEDS_CONTEXT + no-classification, missing
  // GRAY / MEALS_* / WRITE_OFF* inflows (rare but real). Broaden so the
  // STOPs queue matches A13's offender set 1:1.
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
            some: {
              isCurrent: true,
              code: {
                notIn: ["BIZ_INCOME", "OWNER_EQUITY", "TRANSFER", "PERSONAL", "PAYMENT"],
              },
            },
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
    // Skip only when an *active* stop already covers this transaction.
    // PENDING/DEFERRED count as active — the CPA is mid-decision and we
    // shouldn't duplicate the card. ANSWERED stops do NOT count: a prior
    // auto-archive run (or a stale answer that didn't actually fix the
    // assertion) shouldn't permanently block re-surfacing. Without this
    // narrower filter the auto-archive hotfix would have stranded Atif's
    // 21 A07 stops in ANSWERED state with no path back to PENDING.
    const existingStop = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "DEPOSIT",
        transactionIds: { has: tx.id },
        state: { in: ["PENDING", "DEFERRED"] },
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

    // Same active-state filter as DEPOSIT/TRANSFER — let ANSWERED stops
    // re-surface if the assertion is still failing.
    const existingStop = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "SECTION_274D",
        transactionIds: { has: tx.id },
        state: { in: ["PENDING", "DEFERRED"] },
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

  // ── TRANSFER: unpaired TRANSFER-coded rows (A07 contributors) ────────────
  // A07 fails when TRANSFER rows have no `isTransferPairedWith` partner.
  // Money-mover outflows (Wise top-ups, PayPal funding) are intentionally
  // unpaired and excluded by A07's own filter — apply the same filter here.
  const unpairedTransfers = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isStale: false,
      isTransferPairedWith: null,
      classifications: { some: { isCurrent: true, code: "TRANSFER" } },
    },
    include: { account: true },
  })

  // Dedup TRANSFER stops: when two transactions share the same merchant +
  // amount + date (e.g. duplicate ingest, or a pair that should have been
  // refund-paired), they produce two STOPs with identical questions. The
  // CPA sees the same card twice in the queue. Track which (merchant,
  // amount, date) tuples we've already created a stop for in this run.
  const seenTransferKeys = new Set<string>()

  for (const tx of unpairedTransfers) {
    // Skip money-mover outflows (Wise/PayPal funding) — A07 doesn't flag them.
    if (isMoneyMoverOutflow(tx.merchantRaw)) continue

    const dedupKey = [
      (tx.merchantNormalized ?? tx.merchantRaw).toLowerCase(),
      Math.round(Number(tx.amountNormalized) * 100), // cents
      tx.postedDate.toISOString().slice(0, 10),
    ].join("|")
    if (seenTransferKeys.has(dedupKey)) continue
    seenTransferKeys.add(dedupKey)

    // Same active-state filter as DEPOSIT (see comment above) — let
    // ANSWERED stops re-surface if the assertion is still failing.
    const existingStop = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "TRANSFER",
        transactionIds: { has: tx.id },
        state: { in: ["PENDING", "DEFERRED"] },
      },
    })
    if (existingStop) continue

    const absDollars = Math.abs(Number(tx.amountNormalized.toString()))
    const abs = absDollars.toFixed(2)
    const absDisplay = fmtUSD(absDollars, { cents: true })
    const dateStr = tx.postedDate.toISOString().slice(0, 10)
    const direction = Number(tx.amountNormalized) < 0 ? "inflow" : "outflow"
    // Hint the most likely option based on the merchant pattern. The
    // resolve form already accepts SUPPLIER / CHARGEBACK / OWNER_EQUITY;
    // this just primes the question wording so the CPA reads the right
    // path first.
    const merchUpper = tx.merchantRaw.toUpperCase()
    const looksChargeback =
      /RETURN ITEM|RETURNED|CHARGEBACK|REVERSAL|REFER TO MAKER|FEE REVERSAL/i.test(merchUpper)
    const looksSupplier =
      direction === "outflow" &&
      /^(SENT MONEY|WISE|PAYPAL|TRANSFERWISE)/.test(merchUpper)
    const hint = looksChargeback
      ? `Looks like a bank-side chargeback / bounced item. If yes, pick "Bounced check / chargeback" to net it against the prior BIZ_INCOME deposit on Line 1b.`
      : looksSupplier
        ? `Looks like a wire to an overseas supplier. If yes, pick "Supplier payment / inventory" to send it to Part III COGS.`
        : `Pick the option that matches: SUPPLIER (inventory), CHARGEBACK (bounced check), OWNER_EQUITY (transfer to/from owner's external account), CONTRACTOR (services), LOAN (proceeds/repayment), PERSONAL, or OTHER.`
    await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "TRANSFER",
        question: `Unpaired TRANSFER ${direction} of ${absDisplay} on ${dateStr} (${tx.merchantRaw}) — counterparty wasn't found in any tracked account. ${hint}`,
        context: {
          merchant: tx.merchantRaw,
          totalAmount: abs,
          date: dateStr,
          account: tx.account.nickname ?? tx.account.institution,
          direction,
        },
        transactionIds: [tx.id],
        state: "PENDING",
      },
    })
    transferStops++
  }

  // ── SECTION_274D tier-4: A09 contributors (§274(d) rows at tier 4+) ──────
  // Cohan promotion is forbidden for §274(d) categories, but the rail can
  // leak (we've seen it in production). When A09 flags rows, surface them as
  // STOPs so the CPA can either supply receipts (bump to tier 3 with
  // contemporaneous substantiation) or recode the row to PERSONAL.
  const tier4_274d = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isStale: false,
      classifications: { some: { isCurrent: true, evidenceTier: { gt: 3 } } },
    },
    include: {
      account: true,
      classifications: { where: { isCurrent: true }, take: 1 },
    },
  })

  // Mirror A09's filter: §274(d) substantiation only binds deductible rows.
  // A PERSONAL/TRANSFER/PAYMENT row with a residual §274(d) citation isn't
  // a real audit risk — surfacing it as a STOP asks the CPA for attendees
  // and purpose on a row that's already excluded from Schedule C.
  const DEDUCTIBLE_CODES_274D = new Set([
    "WRITE_OFF",
    "WRITE_OFF_COGS",
    "WRITE_OFF_TRAVEL",
    "MEALS_50",
    "MEALS_100",
    "GRAY",
  ])

  for (const tx of tier4_274d) {
    const c = tx.classifications[0]
    if (!c) continue
    if (!DEDUCTIBLE_CODES_274D.has(c.code)) continue
    const has274d = c.ircCitations.some((cit) => cit.startsWith("§274(d)"))
    if (!has274d) continue

    // Same active-state filter — let ANSWERED stops re-surface if the
    // assertion is still failing.
    const existingStop = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "SECTION_274D",
        transactionIds: { has: tx.id },
        state: { in: ["PENDING", "DEFERRED"] },
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
        question: `§274(d) row at evidence tier ${c.evidenceTier} (Cohan-rail leak): ${tx.merchantRaw} on ${dateStr} for ${absDisplay} (${c.code}). §274(d) requires contemporaneous substantiation — Cohan estimation is NOT allowed. Either upload the receipt + log to demote to tier 3, or recode this row to PERSONAL.`,
        context: {
          merchant: tx.merchantRaw,
          totalAmount: abs,
          date: dateStr,
          code: c.code,
          evidenceTier: c.evidenceTier,
          account: tx.account.nickname ?? tx.account.institution,
        },
        transactionIds: [tx.id],
        state: "PENDING",
      },
    })
    section274dTierStops++
  }

  return { depositStops, section274dStops, section274dTierStops, transferStops }
}
