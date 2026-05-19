import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { AutoFinalizeClient } from "./auto-client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function AutoFinalizePage(props: Props) {
  const params = await props.params
  const year = Number.parseInt(params.year, 10)
  if (Number.isNaN(year)) notFound()
  const userId = await getCurrentUserId()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, status: true, lockedSnapshotHash: true, lockedAt: true },
  })
  if (!taxYear) notFound()

  const [findingsCount, pendingFindings, latestRun] = await Promise.all([
    prisma.ledgerFinding.count({ where: { taxYearId: taxYear.id } }),
    prisma.ledgerFinding.count({ where: { taxYearId: taxYear.id, state: "PROPOSED" } }),
    prisma.pipelineRun.findFirst({
      where: { taxYearId: taxYear.id, kind: { in: ["PRE_CLEANUP", "CPA_AUDIT", "COHAN_SWEEP", "SUBSTANTIATION_QUEUE"] } },
      orderBy: { startedAt: "desc" },
    }),
  ])

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Auto-CPA Finalize</h1>
          <p className="text-muted-foreground mt-1">
            Tax Year {year} · Status: <Badge variant="outline">{taxYear.status}</Badge>
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/years/${year}/finalize`}>
            <Button variant="outline">Back to Finalize</Button>
          </Link>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>What this does</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>
            Runs four AI pipeline stages in sequence, then drops you on the findings review page.
          </p>
          <ol className="list-decimal list-inside space-y-1 ml-2">
            <li>
              <strong>PRE_CLEANUP</strong> — flip wrongly-signed inflows, mark out-of-year stale, archive
              superseded stops, backfill Documents.
            </li>
            <li>
              <strong>CPA_AUDIT</strong> — Opus 4.7 reviews the classified ledger and surfaces findings
              like double-counts, phantom transfers, DIF-risk patterns, missing W-9s.
            </li>
            <li>
              <strong>COHAN_SWEEP</strong> — Sonnet 4.6 (or Opus when exposure ≥$10K) walks PERSONAL +
              tier-3 §162 rows and proposes Cohan-flagged promotions with NAICS-nexus rationale. Hard
              §274(d) deny-list enforced.
            </li>
            <li>
              <strong>SUBSTANTIATION_QUEUE</strong> — Sonnet 4.6 surfaces §274(d) candidate rows
              (restaurants, fuel, hotels still in PERSONAL) as STOPs with EMPTY attendees/purpose
              fields. You fill them in only when you actually remember the facts.
            </li>
          </ol>
          <div className="text-xs text-muted-foreground pt-2 border-t mt-3">
            After running, review on{" "}
            <Link href={`/years/${year}/findings`} className="underline">
              /findings
            </Link>{" "}
            and apply. Then re-attempt lock from{" "}
            <Link href={`/years/${year}/lock`} className="underline">
              /lock
            </Link>{" "}
            — drift verification + position memos auto-run on confirm.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Current state</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div>
              <div className="text-muted-foreground">Total findings</div>
              <div className="text-2xl font-bold">{findingsCount}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Pending review</div>
              <div className="text-2xl font-bold">{pendingFindings}</div>
            </div>
            <div>
              <div className="text-muted-foreground">Last auto-CPA stage</div>
              <div className="text-sm">
                {latestRun
                  ? `${latestRun.kind} · ${latestRun.status} · ${latestRun.startedAt.toISOString().slice(0, 16)}`
                  : "Never run"}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <AutoFinalizeClient year={year} taxYearStatus={taxYear.status} />
    </div>
  )
}
