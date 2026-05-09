import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { buildAnalytics } from "@/lib/analytics/build"
import { AnalyticsDashboard } from "@/components/charts/analytics-dashboard"
import { Badge } from "@/components/ui/badge"
import { deriveStage, getYearCounts } from "@/lib/taxYear/status"

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
      <AnalyticsDashboard data={data} />
    </div>
  )
}
