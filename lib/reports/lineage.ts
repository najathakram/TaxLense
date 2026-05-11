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

export async function buildLineage(taxYearId: string): Promise<LineageRow[]> {
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
