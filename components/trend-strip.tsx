"use client"

/**
 * 5-year trend strip for a single client. Pure-CSS sparkline (no Recharts
 * dependency to keep the client page light) showing receipts / deductions /
 * net per year, plus carryover alerts derived from PriorYearContext.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export interface YearTrendRow {
  year: number
  status: string
  receipts: number
  deductions: number
  net: number
  /** Carryforwards from PriorYearContext for this year (sum of all). */
  carryforwardTotal: number
}

interface Props {
  rows: YearTrendRow[]
}

function fmt(n: number) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`
  return `$${Math.round(n)}`
}

function bar(v: number, max: number, color: string) {
  const pct = max === 0 ? 0 : Math.abs(v) / max
  return (
    <div
      style={{
        height: 4,
        background: color,
        width: `${Math.max(2, pct * 100).toFixed(0)}%`,
        borderRadius: 2,
        marginTop: 2,
      }}
    />
  )
}

export function TrendStrip({ rows }: Props) {
  if (rows.length === 0) {
    return null
  }

  const sortedAsc = [...rows].sort((a, b) => a.year - b.year)
  const maxAbs = Math.max(
    ...rows.map((r) => Math.max(Math.abs(r.receipts), Math.abs(r.deductions), Math.abs(r.net))),
  )

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Multi-year trend</CardTitle>
      </CardHeader>
      <CardContent>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `120px repeat(${sortedAsc.length}, 1fr)`,
            gap: 8,
            fontSize: 12,
          }}
        >
          <div className="text-muted-foreground">&nbsp;</div>
          {sortedAsc.map((r) => (
            <div key={`hdr-${r.year}`} className="text-center">
              <div className="font-mono text-xs">{r.year}</div>
              <Badge variant="outline" className="text-[9px]">
                {r.status}
              </Badge>
            </div>
          ))}

          <div className="text-muted-foreground self-center">Receipts</div>
          {sortedAsc.map((r) => (
            <div key={`r-${r.year}`}>
              <div className="font-mono text-xs">{fmt(r.receipts)}</div>
              {bar(r.receipts, maxAbs, "rgb(34 197 94 / 0.6)")}
            </div>
          ))}

          <div className="text-muted-foreground self-center">Deductions</div>
          {sortedAsc.map((r) => (
            <div key={`d-${r.year}`}>
              <div className="font-mono text-xs">{fmt(r.deductions)}</div>
              {bar(r.deductions, maxAbs, "rgb(244 63 94 / 0.6)")}
            </div>
          ))}

          <div className="text-muted-foreground self-center">Net</div>
          {sortedAsc.map((r) => (
            <div key={`n-${r.year}`}>
              <div
                className="font-mono text-xs"
                style={{ color: r.net < 0 ? "rgb(244 63 94)" : undefined }}
              >
                {fmt(r.net)}
              </div>
              {bar(r.net, maxAbs, r.net < 0 ? "rgb(244 63 94 / 0.6)" : "rgb(34 197 94 / 0.6)")}
            </div>
          ))}

          {sortedAsc.some((r) => r.carryforwardTotal > 0) && (
            <>
              <div className="text-muted-foreground self-center">Carryforward in</div>
              {sortedAsc.map((r) => (
                <div key={`c-${r.year}`}>
                  {r.carryforwardTotal > 0 ? (
                    <div className="font-mono text-xs text-amber-600">{fmt(r.carryforwardTotal)}</div>
                  ) : (
                    <div className="text-xs text-muted-foreground">—</div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
