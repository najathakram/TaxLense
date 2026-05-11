"use client"

/**
 * Lineage drill-down panel — for entity tax forms (Schedule C, 1120-S, etc.)
 * shows each line of the form with the source transactions summing to that
 * total. Click a line → expand to see the txn list with deep-link to ledger.
 *
 * Pure client-side: server pre-computes the lineage map and passes it as
 * props. Each row is collapsible; ledger deep-links open in same tab.
 */

import { useState } from "react"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

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

interface Props {
  year: number
  rows: LineageRow[]
  formName: string
}

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
}

export function LineagePanel({ year, rows, formName }: Props) {
  const [expanded, setExpanded] = useState<string | null>(null)
  if (rows.length === 0) {
    return (
      <Card>
        <CardContent className="py-6 text-xs text-muted-foreground">
          No deductible classifications found yet — lineage is empty.
        </CardContent>
      </Card>
    )
  }
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">
          Lineage — click any line to see source transactions
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        <table className="w-full text-xs">
          <thead className="border-b text-muted-foreground">
            <tr>
              <th className="text-left px-3 py-2">{formName} line</th>
              <th className="text-right">Total ($)</th>
              <th className="text-right">Txns</th>
              <th className="w-8" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const isOpen = expanded === r.line
              return (
                <>
                  <tr
                    key={r.line}
                    className="border-b cursor-pointer hover:bg-muted/30"
                    onClick={() => setExpanded(isOpen ? null : r.line)}
                  >
                    <td className="px-3 py-2 font-medium">{r.line}</td>
                    <td className="text-right font-mono">{fmt(r.total)}</td>
                    <td className="text-right text-muted-foreground">{r.txCount}</td>
                    <td className="text-center text-muted-foreground">{isOpen ? "▾" : "▸"}</td>
                  </tr>
                  {isOpen && (
                    <tr className="border-b bg-muted/10">
                      <td colSpan={4} className="px-3 py-2">
                        <table className="w-full text-[11px]">
                          <thead className="text-muted-foreground">
                            <tr>
                              <th className="text-left">Date</th>
                              <th className="text-left">Merchant</th>
                              <th className="text-left">Code</th>
                              <th className="text-right">Amount</th>
                              <th className="text-right">Deductible</th>
                              <th />
                            </tr>
                          </thead>
                          <tbody>
                            {r.txns.map((t) => (
                              <tr key={t.id}>
                                <td className="font-mono">{t.date}</td>
                                <td className="truncate max-w-[280px]">{t.merchant}</td>
                                <td>
                                  <Badge variant="outline" className="text-[9px]">
                                    {t.code}
                                  </Badge>
                                </td>
                                <td className="text-right font-mono">{fmt(t.amount)}</td>
                                <td className="text-right font-mono">{fmt(t.deductible)}</td>
                                <td className="text-right">
                                  <Link
                                    href={`/years/${year}/ledger?txnId=${t.id}`}
                                    className="text-[10px] underline"
                                  >
                                    open →
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
