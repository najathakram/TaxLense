/**
 * P2P round-trip detector — finds counterparties that appear on BOTH
 * sides of the ledger (money in AND money out from/to the same person).
 *
 * Why: the agent classifies each side independently. On Atif's prod
 * ledger this produced an asymmetric pattern:
 *   - Pocketsflow inflows from Kirsten Hatch → NEEDS_CONTEXT, $0 income
 *   - Pocketsflow outflows TO Kirsten Hatch → WRITE_OFF Contract Labor 100%
 * The same name on both sides almost always means one of three things:
 *   1. Personal P2P transfer between friends (both sides PERSONAL, $0 net)
 *   2. Customer payment + refund (inflow=BIZ_INCOME, outflow=negative income)
 *   3. Genuine contractor work (1099-NEC required if ≥ $600/year per payee)
 * The CPA must pick — the AI cannot tell from the ledger alone.
 *
 * Output: ONE STOP per counterparty grouping both legs together so the
 * CPA decides once, not 15 times.
 */

import { prisma } from "@/lib/db"
import { fmtUSD } from "@/lib/format/currency"

/**
 * Extract a counterparty (individual person's name) from a bank statement
 * merchant string. Returns null if the merchant text doesn't appear to
 * carry an individual name (corporate vendor, generic transfer, etc.).
 *
 * Patterns supported (real strings from Atif's ledger and common bank
 * formats):
 *   - "POCKETSFLOW DES:TRANSFER ID:ST-X INDN:KIRSTEN HATCH CO ID:..."
 *     ACH `INDN:` (Individual Name) field is the canonical source.
 *   - "ZELLE TO JOHN DOE", "ZELLE FROM JOHN DOE"
 *   - "ZELLE PAYMENT FROM JANE SMITH"
 *   - "VENMO PAYMENT JOHN-DOE", "VENMO CASHOUT FROM JOHN"
 *   - "WISE INC SENT MONEY TO ZAIN UL ABIDEEN SAFDAR"
 *   - "SENT MONEY TO USMAN ASLAM" (Wise outflow without WISE prefix)
 *
 * Names are normalized to UPPER and stripped of trailing IDs / co names.
 */
export function extractCounterparty(merchantRaw: string): string | null {
  if (!merchantRaw) return null
  const text = merchantRaw.trim()

  // ACH INDN field: "INDN:NAME CO ID:..." — most reliable.
  const indnMatch = /\bINDN:([^]+?)(?:\s+CO\s+ID:|\s{2,}|$)/i.exec(text)
  if (indnMatch && indnMatch[1]) {
    const name = indnMatch[1].trim().replace(/\s+/g, " ")
    if (looksLikePersonName(name)) return name.toUpperCase()
  }

  // "SENT MONEY TO NAME" — Wise outflow format. Captures everything
  // after TO until end-of-string or a transaction-id token starting with
  // "TRANSFER-" / "ID:".
  const wiseMatch = /\bSENT\s+MONEY\s+TO\s+([A-Z][A-Z\s'.-]+?)(?:\s+(?:TRANSFER-|ID:|\d{6,}|$))/i.exec(text)
  if (wiseMatch && wiseMatch[1]) {
    const name = wiseMatch[1].trim().replace(/\s+/g, " ")
    if (looksLikePersonName(name)) return name.toUpperCase()
  }

  // Zelle: "ZELLE TO|FROM|PAYMENT TO|PAYMENT FROM <NAME>"
  const zelleMatch = /\bZELLE(?:\s+PAYMENT)?\s+(?:TO|FROM)\s+([A-Z][A-Z\s'.-]+?)(?:\s{2,}|\s+(?:CONF|REF|ID)\b|$)/i.exec(text)
  if (zelleMatch && zelleMatch[1]) {
    const name = zelleMatch[1].trim().replace(/\s+/g, " ")
    if (looksLikePersonName(name)) return name.toUpperCase()
  }

  // Venmo: "VENMO PAYMENT NAME-WITH-DASHES" or "VENMO CASHOUT FROM NAME"
  const venmoMatch = /\bVENMO\s+(?:PAYMENT|CASHOUT(?:\s+FROM)?)\s+([A-Z][A-Z\s'.-]+?)(?:\s{2,}|$)/i.exec(text)
  if (venmoMatch && venmoMatch[1]) {
    const name = venmoMatch[1].trim().replace(/[-_]/g, " ").replace(/\s+/g, " ")
    if (looksLikePersonName(name)) return name.toUpperCase()
  }

  return null
}

/**
 * Heuristic: does a string look like an individual's name (not a
 * corporation or merchant)? Reject if it contains corporate suffixes,
 * is too long, or has digits.
 */
function looksLikePersonName(s: string): boolean {
  if (!s || s.length < 4 || s.length > 50) return false
  if (/\d/.test(s)) return false
  if (/\b(LLC|LLP|INC|CORP|LTD|GMBH|CO|COMPANY|CONSULTING|SERVICES|FUND|TRUST|GROUP|HOLDINGS|CAPITAL)\b/i.test(s)) {
    return false
  }
  // Need at least 2 word tokens (first + last name)
  const words = s.split(/\s+/).filter((w) => w.length >= 2)
  return words.length >= 2
}

export interface P2pCounterpartySummary {
  counterparty: string
  inflowTxIds: string[]
  outflowTxIds: string[]
  inflowTotalCents: number
  outflowTotalCents: number
}

/**
 * Scan the ledger for counterparties with money flowing in BOTH directions.
 * Returns one summary per counterparty, sorted by total magnitude desc.
 *
 * Threshold: at least $200 on each side — below that the asymmetry is
 * usually noise (e.g. someone splitting a meal bill).
 */
export async function detectP2pRoundTrips(
  taxYearId: string,
): Promise<P2pCounterpartySummary[]> {
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false },
    select: { id: true, merchantRaw: true, amountNormalized: true },
  })

  const groups = new Map<string, P2pCounterpartySummary>()
  for (const t of txns) {
    const cp = extractCounterparty(t.merchantRaw)
    if (!cp) continue
    const cents = Math.round(Number(t.amountNormalized.toString()) * 100)
    if (cents === 0) continue

    let g = groups.get(cp)
    if (!g) {
      g = {
        counterparty: cp,
        inflowTxIds: [],
        outflowTxIds: [],
        inflowTotalCents: 0,
        outflowTotalCents: 0,
      }
      groups.set(cp, g)
    }
    if (cents < 0) {
      // Inflow per spec §4.2 (amountNormalized < 0)
      g.inflowTxIds.push(t.id)
      g.inflowTotalCents += Math.abs(cents)
    } else {
      g.outflowTxIds.push(t.id)
      g.outflowTotalCents += cents
    }
  }

  const MIN_CENTS_PER_SIDE = 20000 // $200
  const out = Array.from(groups.values())
    .filter(
      (g) =>
        g.inflowTotalCents >= MIN_CENTS_PER_SIDE &&
        g.outflowTotalCents >= MIN_CENTS_PER_SIDE &&
        g.inflowTxIds.length > 0 &&
        g.outflowTxIds.length > 0,
    )
    .sort(
      (a, b) =>
        b.inflowTotalCents +
        b.outflowTotalCents -
        (a.inflowTotalCents + a.outflowTotalCents),
    )

  return out
}

export interface DeriveP2pStopsResult {
  counterpartyStops: number
  totalTransactionsFlagged: number
}

/**
 * Materialize one STOP per round-trip counterparty. Idempotent: if a
 * P2P_ROUNDTRIP STOP exists for the same counterparty (any state), it's
 * left alone unless it was auto-archived as superseded — in which case
 * a fresh STOP is emitted (the auto-archive likely fired off stale state).
 */
export async function deriveP2pRoundTripStops(
  taxYearId: string,
): Promise<DeriveP2pStopsResult> {
  const summaries = await detectP2pRoundTrips(taxYearId)
  let counterpartyStops = 0
  let totalTransactionsFlagged = 0

  for (const s of summaries) {
    const allTxIds = [...s.inflowTxIds, ...s.outflowTxIds]
    const existing = await prisma.stopItem.findFirst({
      where: {
        taxYearId,
        category: "P2P_ROUNDTRIP",
        // Match by counterparty stored in context — same person yields same key
        context: { path: ["counterparty"], equals: s.counterparty } as never,
        state: { in: ["PENDING", "ANSWERED"] },
      },
    })
    if (existing) {
      const userAnswer = existing.userAnswer as
        | { autoArchivedAsSuperseded?: boolean }
        | null
      const isSupersededShell =
        existing.state === "ANSWERED" &&
        userAnswer?.autoArchivedAsSuperseded === true
      if (!isSupersededShell) continue
    }

    const inflowDisplay = fmtUSD(s.inflowTotalCents / 100, { cents: true })
    const outflowDisplay = fmtUSD(s.outflowTotalCents / 100, { cents: true })

    await prisma.stopItem.create({
      data: {
        taxYearId,
        category: "P2P_ROUNDTRIP",
        question:
          `${s.counterparty} appears on both sides of your ledger: ` +
          `${inflowDisplay} received over ${s.inflowTxIds.length} txn${s.inflowTxIds.length > 1 ? "s" : ""}, ` +
          `${outflowDisplay} paid out over ${s.outflowTxIds.length} txn${s.outflowTxIds.length > 1 ? "s" : ""}. ` +
          `What is your relationship with ${s.counterparty}?`,
        context: {
          counterparty: s.counterparty,
          inflowTotal: (s.inflowTotalCents / 100).toFixed(2),
          outflowTotal: (s.outflowTotalCents / 100).toFixed(2),
          inflowCount: s.inflowTxIds.length,
          outflowCount: s.outflowTxIds.length,
          // Three valid resolutions surfaced as options to the CPA. The
          // STOPs UI renders these as radio buttons.
          options: [
            {
              key: "PERSONAL_P2P",
              label: "Personal P2P (friends/family) — both sides PERSONAL, $0 net effect",
              inflowCode: "PERSONAL",
              outflowCode: "PERSONAL",
            },
            {
              key: "CUSTOMER_REFUND",
              label: "Customer payment + refund — inflow=BIZ_INCOME, outflow=negative BIZ_INCOME",
              inflowCode: "BIZ_INCOME",
              outflowCode: "BIZ_INCOME", // signed-negative on outflow side
            },
            {
              key: "CONTRACTOR",
              label: "Genuine contractor work (1099-NEC required if ≥$600/yr) — inflow=PERSONAL or BIZ_INCOME, outflow=Contract Labor",
              inflowCode: "PERSONAL",
              outflowCode: "WRITE_OFF",
              outflowScheduleCLine: "Line 11 Contract Labor",
            },
          ],
        },
        transactionIds: allTxIds,
        state: "PENDING",
      },
    })
    counterpartyStops++
    totalTransactionsFlagged += allTxIds.length
  }

  return { counterpartyStops, totalTransactionsFlagged }
}
