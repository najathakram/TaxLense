import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { YearStepper } from "@/components/pipeline/year-stepper"
import { deriveStage } from "@/lib/taxYear/status"

interface Props {
  params: Promise<{ year: string }>
  children: React.ReactNode
}

/**
 * Year-level layout — renders the horizontal stage stepper above every
 * /years/[year]/* page. The stepper is the primary wayfinding cue (Tier
 * 3.10); the sidebar stays as secondary nav for jumping to specific
 * subviews (e.g. Coverage, Analytics) that aren't represented on the
 * stepper.
 *
 * One small DB read per request: TaxYear + 3 counts. Cheap enough to run on
 * every year page; the per-page server component still does its own data
 * fetching for whatever the page needs to render.
 *
 * If the year is missing or invalid the stepper renders a degraded "Ingest"
 * segment and the page-level component handles notFound() — keeping this
 * layout strictly visual.
 */
export default async function YearLayout({ params, children }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)

  if (isNaN(year)) {
    return <>{children}</>
  }

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, status: true, lockedAt: true },
  })

  if (!taxYear) {
    return <>{children}</>
  }

  const [totalTx, classifiedTx, pendingStops] = await Promise.all([
    prisma.transaction.count({
      where: { taxYearId: taxYear.id, isDuplicateOf: null },
    }),
    prisma.classification.count({
      where: {
        transaction: { taxYearId: taxYear.id, isDuplicateOf: null },
        isCurrent: true,
      },
    }),
    prisma.stopItem.count({
      where: { taxYearId: taxYear.id, state: "PENDING" },
    }),
  ])

  const derivedStage = deriveStage(
    { status: taxYear.status, lockedAt: taxYear.lockedAt },
    { totalTx, classifiedTx, pendingStops },
  )

  return (
    <>
      <YearStepper
        year={year}
        stage={derivedStage}
        pendingStops={pendingStops}
        classifiedTx={classifiedTx}
        totalTx={totalTx}
      />
      {children}
    </>
  )
}
