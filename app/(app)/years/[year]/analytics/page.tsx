import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { buildAnalytics } from "@/lib/analytics/build"
import { AnalyticsDashboard } from "@/components/charts/analytics-dashboard"
import { Badge } from "@/components/ui/badge"

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
    select: { id: true, year: true, status: true },
  })
  if (!taxYear) notFound()

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
        <Badge variant="outline">{taxYear.status}</Badge>
      </div>
      <AnalyticsDashboard data={data} />
    </div>
  )
}
