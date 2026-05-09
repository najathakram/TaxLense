import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { NextActionCard } from "@/components/pipeline/next-action-card"
import { deriveStage, getYearCounts } from "@/lib/taxYear/status"
import { inYearWindow } from "@/lib/queries/yearWindow"

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
      financialAccounts: {
        select: {
          id: true,
          institution: true,
          nickname: true,
          mask: true,
          type: true,
          transactions: {
            where: { ...inYearWindow(year), isStale: false, isDuplicateOf: null },
            select: { postedDate: true },
          },
        },
      },
    },
  })

  if (!taxYear) notFound()

  // Compute per-account month coverage for the year overview banner. We only
  // surface accounts that already have at least one transaction (otherwise
  // the user hasn't connected this account yet — coverage isn't a "gap"). For
  // each remaining account, count missing months (0 in-year tx). Then pick
  // the worst offenders to surface as a "missing X months" nudge — without
  // this the user has no signal that COGS may be materially understated
  // until they manually navigate to /coverage.
  const accountGaps = taxYear.financialAccounts
    .map((acct) => {
      const monthsWithTx = new Set<number>()
      for (const tx of acct.transactions) {
        monthsWithTx.add(tx.postedDate.getUTCMonth())
      }
      const missing: number[] = []
      for (let m = 0; m < 12; m++) if (!monthsWithTx.has(m)) missing.push(m)
      return {
        id: acct.id,
        nickname: acct.nickname ?? acct.institution,
        type: acct.type,
        txCount: acct.transactions.length,
        missingMonthCount: missing.length,
      }
    })
    .filter((a) => a.txCount > 0 && a.missingMonthCount > 0)
    .sort((a, b) => b.missingMonthCount - a.missingMonthCount)
  const totalMissingMonths = accountGaps.reduce((n, a) => n + a.missingMonthCount, 0)

  // Canonical counts (B-04). One helper, one filter — every page agrees.
  const { totalTx, classifiedTx: classified, pendingStops } = await getYearCounts(taxYear.id)

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

      {accountGaps.length > 0 && totalMissingMonths >= 3 && (
        <Card className="border-amber-500/40 bg-amber-500/5">
          <CardContent className="py-4">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex-1 min-w-[280px]">
                <div className="flex items-center gap-2 mb-1">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500/20 text-amber-500 text-xs font-bold" aria-hidden>!</span>
                  <p className="text-xs font-medium text-amber-500 uppercase tracking-wide">
                    Coverage gap · {totalMissingMonths} month{totalMissingMonths === 1 ? "" : "s"} missing
                  </p>
                </div>
                <p className="text-sm leading-relaxed">
                  {accountGaps.slice(0, 3).map((a, i) => (
                    <span key={a.id}>
                      {i > 0 ? "; " : ""}
                      <strong>{a.nickname}</strong> missing {a.missingMonthCount} month{a.missingMonthCount === 1 ? "" : "s"}
                    </span>
                  ))}
                  {accountGaps.length > 3 ? `; +${accountGaps.length - 3} more` : ""}.
                </p>
                <p className="text-xs text-muted-foreground mt-1.5">
                  Untouched months mean transactions may not be on the ledger — which can materially understate COGS or revenue. Upload the missing statements before locking.
                </p>
              </div>
              <Link
                href={`/years/${year}/coverage`}
                className="text-sm font-medium text-amber-500 hover:underline shrink-0"
              >
                View coverage →
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

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
