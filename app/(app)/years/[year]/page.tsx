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
      // Phase G: include the carryforward into THIS year (set when prior
      // year locks OR when this year is created after a prior locked year).
      priorYearContext: { include: { sourcePriorYear: { select: { year: true } } } },
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
  // Compact a 0-indexed list of missing-month integers ([0,1,2,5,6]) into
  // "Jan–Mar, Jun–Jul" — much more useful than just the count (B-19).
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  function compactMonthRanges(months: number[]): string {
    if (months.length === 0) return ""
    const parts: string[] = []
    let i = 0
    while (i < months.length) {
      const start = months[i]!
      let end = start
      while (i + 1 < months.length && months[i + 1] === end + 1) {
        end = months[++i]!
      }
      parts.push(start === end ? MONTH_NAMES[start]! : `${MONTH_NAMES[start]}–${MONTH_NAMES[end]}`)
      i++
    }
    return parts.join(", ")
  }

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
        missingRanges: compactMonthRanges(missing),
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
                      <strong>{a.nickname}</strong> missing {a.missingRanges} ({a.missingMonthCount} month{a.missingMonthCount === 1 ? "" : "s"})
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

      {/* Phase G: Carryforward into this year — populated automatically when
          the prior year locks OR when this year is created after a prior
          locked year. Read-only display; corrections require unlocking the
          prior year (preserves principle 4: append-only). */}
      {taxYear.priorYearContext && (
        <Card>
          <CardHeader>
            <CardTitle>
              Carryforward into {year}
              {taxYear.priorYearContext.sourcePriorYear && (
                <span className="ml-2 text-xs font-normal text-muted-foreground">
                  from TY {taxYear.priorYearContext.sourcePriorYear.year}
                  {taxYear.priorYearContext.sourceLockedHash && (
                    <span className="font-mono ml-1">
                      ({taxYear.priorYearContext.sourceLockedHash.slice(0, 12)}…)
                    </span>
                  )}
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="text-sm space-y-1">
            {(() => {
              const c = taxYear.priorYearContext
              const items: Array<[string, number, string]> = []
              const nol = Number(c.netOperatingLoss?.toString() ?? "0")
              if (nol > 0) items.push(["§172 Net Operating Loss carryforward", nol, "indefinite carryforward post-TCJA, 80% taxable-income limit"])
              const s179 = Number(c.section179Carryover?.toString() ?? "0")
              if (s179 > 0) items.push(["§179 carryover (deduction exceeded business income limit)", s179, ""])
              const passive = Number(c.passiveLossCarryforward?.toString() ?? "0")
              if (passive > 0) items.push(["§469 suspended passive losses", passive, ""])
              const capS = Number(c.capitalLossShortTerm?.toString() ?? "0")
              if (capS > 0) items.push(["Short-term capital loss carryforward", capS, "Schedule D"])
              const capL = Number(c.capitalLossLongTerm?.toString() ?? "0")
              if (capL > 0) items.push(["Long-term capital loss carryforward", capL, "Schedule D"])
              const amt = Number(c.amtCreditCarryforward?.toString() ?? "0")
              if (amt > 0) items.push(["§53 AMT credit carryforward", amt, ""])
              const qbi = Number(c.qbiLossCarryforward?.toString() ?? "0")
              if (qbi > 0) items.push(["§199A QBI loss carryforward", qbi, "reduces future QBI components"])
              const s163j = Number(c.section163jCarryforward?.toString() ?? "0")
              if (s163j > 0) items.push(["§163(j) interest expense carryforward", s163j, ""])
              if (items.length === 0) {
                return <p className="text-muted-foreground">No carryforward amounts from the prior year.</p>
              }
              return (
                <ul className="space-y-1">
                  {items.map(([label, amount, note]) => (
                    <li key={label} className="flex items-baseline justify-between gap-3">
                      <span>{label}{note && <span className="text-xs text-muted-foreground"> · {note}</span>}</span>
                      <span className="font-mono">${amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>
                    </li>
                  ))}
                </ul>
              )
            })()}
            <p className="text-xs text-muted-foreground pt-2 border-t mt-2">
              Carryforward computed automatically from the prior year&apos;s locked snapshot
              (lib/carryforward/compute.ts). Read-only — to amend, unlock the prior year, fix,
              and re-lock; the new snapshot will repopulate this row.
            </p>
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
