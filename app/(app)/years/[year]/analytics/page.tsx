import Link from "next/link"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { buildAnalytics } from "@/lib/analytics/build"
import { AnalyticsDashboard } from "@/components/charts/analytics-dashboard"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { deriveStage, getYearCounts } from "@/lib/taxYear/status"
import { buildAnalyticsSuggestions } from "@/lib/analytics/suggestions"
import { inYearWindow } from "@/lib/queries/yearWindow"
import { computeDeductibleAmt } from "@/lib/classification/deductible"

interface Props {
  params: Promise<{ year: string }>
}

export default async function AnalyticsPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, year: true, status: true, lockedAt: true },
  })
  if (!taxYear) notFound()

  // Derive the live stage so the badge agrees with the year-overview chip.
  // Reading raw taxYear.status leaves the analytics page reporting "INGESTION"
  // long after row counts say CLASSIFICATION (same drift Bug #1 fixed elsewhere).
  const counts = await getYearCounts(taxYear.id)
  const derivedStage = deriveStage(
    { status: taxYear.status, lockedAt: taxYear.lockedAt },
    counts,
  )

  const data = await buildAnalytics(taxYear.id)

  // 'What to do' suggestions for industry-comparison outliers (Plan 7).
  const profileForSuggestions = await prisma.businessProfile.findUnique({
    where: { taxYearId: taxYear.id },
    select: { naicsCode: true, vehicleConfig: true },
  })
  const txnsForLineMap = await prisma.transaction.findMany({
    where: { taxYearId: taxYear.id, isSplit: false, isStale: false, ...inYearWindow(taxYear.year) },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  const lineTotals = new Map<string, number>()
  let mealsTotal = 0
  for (const t of txnsForLineMap) {
    const c = t.classifications[0]
    if (!c) continue
    if (
      ["WRITE_OFF", "WRITE_OFF_TRAVEL", "WRITE_OFF_COGS", "MEALS_50", "MEALS_100", "GRAY"].includes(
        c.code,
      )
    ) {
      const amt = Math.abs(Number(t.amountNormalized.toString()))
      const ded = computeDeductibleAmt(amt, c.code, c.businessPct)
      if (c.scheduleCLine) {
        lineTotals.set(c.scheduleCLine, (lineTotals.get(c.scheduleCLine) ?? 0) + ded)
      }
      if (c.code === "MEALS_50" || c.code === "MEALS_100") mealsTotal += ded
    }
  }
  const vehicleCfg = (profileForSuggestions?.vehicleConfig ?? {}) as {
    has?: boolean
    bizPct?: number
  }
  const suggestions = buildAnalyticsSuggestions({
    year,
    naicsCode: profileForSuggestions?.naicsCode ?? null,
    grossReceipts: data.grossReceipts,
    totalDeductions: data.totalDeductible,
    lineTotals,
    mealsTotal,
    vehicleBizPct: vehicleCfg.has ? (vehicleCfg.bizPct ?? 0) : 0,
  })

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Tax Year {year} · computed {new Date(data.computedAt).toLocaleString()}
          </p>
        </div>
        <Badge variant="outline">{derivedStage}</Badge>
      </div>

      {suggestions.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">
              What to do ({suggestions.length} suggestion{suggestions.length === 1 ? "" : "s"})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {suggestions.map((s) => {
              const sevColor =
                s.severity === "CRITICAL"
                  ? "border-red-500/40 bg-red-500/5"
                  : s.severity === "WARN"
                    ? "border-amber-500/40 bg-amber-500/5"
                    : "border-blue-500/40 bg-blue-500/5"
              return (
                <div key={s.id} className={`border-l-4 rounded p-3 ${sevColor}`}>
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-semibold">{s.title}</p>
                    <Badge variant="outline" className="text-[10px]">
                      {s.severity}
                    </Badge>
                  </div>
                  <p className="text-xs mt-1 text-foreground/80">{s.message}</p>
                  <div className="mt-2 flex items-center gap-3">
                    {s.href && s.hrefLabel && (
                      <Link href={s.href(year)} className="text-xs underline">
                        {s.hrefLabel}
                      </Link>
                    )}
                    <span className="text-[10px] text-muted-foreground/80">{s.authority}</span>
                  </div>
                </div>
              )
            })}
          </CardContent>
        </Card>
      )}

      <AnalyticsDashboard data={data} />
    </div>
  )
}
