import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NextActionCard } from "@/components/pipeline/next-action-card"
import { deriveStage } from "@/lib/taxYear/status"

interface Props {
  params: Promise<{ year: string }>
}

export default async function YearPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: {
      _count: { select: { transactions: true, financialAccounts: true, merchantRules: true } },
      businessProfile: { select: { naicsCode: true, businessDescription: true, entityType: true } },
      financialAccounts: { select: { id: true, institution: true, nickname: true, mask: true, type: true } },
    },
  })

  if (!taxYear) notFound()

  // Counts driving the NextActionCard hero. Match the denominators used on
  // the pipeline page so the two views agree on "everything classified."
  // Excluding duplicates from totalTx mirrors lib/taxYear/status.ts and the
  // pipeline page's stat cards.
  const [totalTx, classified, pendingStops] = await Promise.all([
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

  // Derive the live stage from row counts. Belt-and-suspenders against years
  // where TaxYear.status hasn't been recomputed yet (e.g. read traffic before
  // any post-Tier-1 mutation). recomputeStatus() persists this on every
  // server action; this derivation just keeps the chip honest on read.
  const derivedStage = deriveStage(
    { status: taxYear.status, lockedAt: taxYear.lockedAt },
    { totalTx, classifiedTx: classified, pendingStops },
  )

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold text-foreground">Tax Year {year}</h1>
        <Badge variant="outline">{derivedStage}</Badge>
      </div>

      <NextActionCard
        year={year}
        stage={derivedStage}
        counts={{ totalTx, classifiedTx: classified, pendingStops }}
        lockedAt={taxYear.lockedAt}
        lockedSnapshotHash={taxYear.lockedSnapshotHash}
      />

      <div className="grid gap-4 grid-cols-2 sm:grid-cols-4">
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Accounts</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold tabular-nums">{taxYear._count.financialAccounts}</span></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Transactions</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold tabular-nums">{totalTx}</span></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Classified</CardTitle></CardHeader>
          <CardContent><span className="text-3xl font-bold tabular-nums">{classified}</span></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">STOPs pending</CardTitle></CardHeader>
          <CardContent><span className={`text-3xl font-bold tabular-nums ${pendingStops > 0 ? "text-amber-500" : ""}`}>{pendingStops}</span></CardContent>
        </Card>
      </div>

      {taxYear.businessProfile && (
        <Card>
          <CardHeader><CardTitle>Business Profile</CardTitle></CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p><span className="text-muted-foreground">Description:</span> {taxYear.businessProfile.businessDescription}</p>
            <p><span className="text-muted-foreground">NAICS:</span> {taxYear.businessProfile.naicsCode}</p>
            <p><span className="text-muted-foreground">Entity:</span> {taxYear.businessProfile.entityType}</p>
          </CardContent>
        </Card>
      )}

      {taxYear.financialAccounts.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Accounts</CardTitle></CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {taxYear.financialAccounts.map((acct) => (
                <li key={acct.id} className="flex items-center justify-between text-sm">
                  <span className="font-medium">{acct.nickname ?? acct.institution}</span>
                  <span className="text-muted-foreground">{acct.type} ···{acct.mask}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
