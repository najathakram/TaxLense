/**
 * Lineage builder — for any tax form (Schedule C, 1120-S, 1065, 1120),
 * walks the locked ledger and produces a per-line breakdown of:
 *   - line label (verbatim from getFormSpec)
 *   - total deductible
 *   - count of contributing transactions
 *   - the actual transactions (id, date, merchant, amount, deductible, code)
 *
 * Powers the lineage drill-down panel on /documents/[kind]. Pure read; no
 * AI; reads from the same Classification rows the master ledger uses so
 * "one number, one place" holds (B-08 invariant).
 *
 * When given a docSlug, the lineage is filtered to only the lines/codes
 * that doc is responsible for — Form 1125-A only shows COGS rows; Form
 * 8829 only home office; Schedule SE only the net-SE figure; etc. Without
 * filtering, every doc rendered the same generic ledger summary.
 */

import { prisma } from "@/lib/db"
import { computeDeductibleAmt } from "@/lib/classification/deductible"
import { inYearWindow } from "@/lib/queries/yearWindow"
import { getFormSpec } from "@/lib/forms/registry"

export interface LineageRow {
  line: string
  total: number
  txCount: number
  txns: Array<{
    id: string
    date: string
    merchant: string
    amount: number
    deductible: number
    code: string
  }>
}

/**
 * Per-doc filter — returns true if a classification line is RELEVANT to
 * the given doc slug. When the slug is unknown (or it's the primary entity
 * worksheet), all lines pass through.
 */
function lineMatchesDoc(line: string, docSlug?: string): boolean {
  if (!docSlug) return true
  const l = line.toLowerCase()
  switch (docSlug) {
    case "form-1125a-cogs":
      // Cost of Goods Sold detail — only Part III COGS / WRITE_OFF_COGS rows
      return l.includes("cogs") || l.includes("part iii")
    case "form-8829":
      // Home office expenses
      return l.includes("home office") || l.includes("line 30")
    case "form-4562-depreciation":
    case "depreciation-schedule":
      return l.includes("depreciation") || l.includes("line 13") || l.includes("§179") || l.includes("§168")
    case "schedule-se":
      // SE tax is computed from Schedule C net — show all deductible lines
      return true
    case "form-8995-qbi":
      // QBI is 20% of net QBI — show all deductible lines (drives net)
      return true
    case "form-1125-e":
      // Compensation of officers — Line 7 (1120-S) / 12 (1120) / 10 (1065 partner pmts)
      return l.includes("compensation") || l.includes("officer") || l.includes("line 7") ||
             l.includes("line 10") || l.includes("line 12")
    case "form-1099-nec":
      return l.includes("contract labor") || l.includes("line 11")
    default:
      return true
  }
}

export async function buildLineage(
  taxYearId: string,
  docSlug?: string,
): Promise<LineageRow[]> {
  const ty = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    select: { id: true, year: true },
  })
  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { entityType: true },
  })
  const formSpec = getFormSpec(profile?.entityType)
  const lineOrder = new Map(formSpec.lines.map((l, i) => [l, i]))

  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false, ...inYearWindow(ty.year) },
    select: {
      id: true,
      postedDate: true,
      amountNormalized: true,
      merchantNormalized: true,
      merchantRaw: true,
      classifications: {
        where: { isCurrent: true },
        select: { code: true, scheduleCLine: true, businessPct: true },
        take: 1,
      },
    },
  })

  const byLine = new Map<string, LineageRow>()
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    if (!["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100", "GRAY"].includes(c.code)) {
      continue
    }
    const line = c.scheduleCLine ?? "(no line)"
    // Per-doc filter — drop rows that aren't relevant to the active doc.
    // E.g., Form 1125-A only shows COGS rows; Form 8829 only home office.
    if (!lineMatchesDoc(line, docSlug)) continue
    if (!byLine.has(line)) {
      byLine.set(line, { line, total: 0, txCount: 0, txns: [] })
    }
    const row = byLine.get(line)!
    const amt = Math.abs(Number(t.amountNormalized.toString()))
    const ded = computeDeductibleAmt(amt, c.code, c.businessPct)
    row.total += ded
    row.txCount++
    row.txns.push({
      id: t.id,
      date: t.postedDate.toISOString().slice(0, 10),
      merchant: t.merchantNormalized ?? t.merchantRaw,
      amount: amt,
      deductible: ded,
      code: c.code,
    })
  }

  // Sort each row's txns by date desc, then sort the rows by form-line order.
  for (const r of byLine.values()) {
    r.txns.sort((a, b) => b.date.localeCompare(a.date))
  }
  return [...byLine.values()].sort(
    (a, b) => (lineOrder.get(a.line) ?? 999) - (lineOrder.get(b.line) ?? 999),
  )
}
