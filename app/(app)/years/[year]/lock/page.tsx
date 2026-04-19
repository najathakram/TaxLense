import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { attemptLock } from "./actions"
import { LockClient } from "./lock-client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function LockPage({ params }: Props) {
  const { year: yearParam } = await params
  const session = await requireAuth()
  const userId = session.user!.id!
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({ where: { userId_year: { userId, year } } })
  if (!taxYear) notFound()

  const result = await attemptLock(year)
  const isLocked = taxYear.status === "LOCKED"

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Lock Tax Year {year}</h1>
        <Badge variant={isLocked ? "default" : "outline"}>{taxYear.status}</Badge>
      </div>

      {isLocked && taxYear.lockedAt && (
        <Card>
          <CardHeader><CardTitle>Locked</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><strong>Locked at:</strong> {taxYear.lockedAt.toISOString()}</p>
            <p className="break-all"><strong>Snapshot hash:</strong> <code className="text-xs">{taxYear.lockedSnapshotHash}</code></p>
            <p className="text-muted-foreground">Unlocking marks derived reports STALE and requires a rationale.</p>
            <LockClient mode="unlock" year={year} />
          </CardContent>
        </Card>
      )}

      {!isLocked && result.blocked && (
        <Alert variant="destructive">
          <AlertTitle>Lock blocked — {result.reasons.length} issue{result.reasons.length === 1 ? "" : "s"}</AlertTitle>
          <AlertDescription>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm">
              {result.reasons.map((r, i) => <li key={i}>{r}</li>)}
            </ul>
            <div className="mt-3 flex gap-2">
              <Link className="text-sm text-blue-700 underline" href={`/years/${year}/stops`}>Resolve STOPs</Link>
              <Link className="text-sm text-blue-700 underline" href={`/years/${year}/ledger`}>Edit ledger</Link>
              <Link className="text-sm text-blue-700 underline" href={`/years/${year}/risk`}>Risk dashboard</Link>
            </div>
          </AlertDescription>
        </Alert>
      )}

      {!isLocked && !result.blocked && (
        <>
          <Alert>
            <AlertTitle>Ready to lock</AlertTitle>
            <AlertDescription>
              All {result.assertions.passed.length} QA assertions pass. Risk score {result.risk.score} ({result.risk.band}).
              Estimated deductions ${result.risk.estimatedDeductions.toFixed(2)}.
            </AlertDescription>
          </Alert>
          <Card>
            <CardHeader><CardTitle>Confirm lock</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <p>Locking freezes the ledger and records a SHA-256 snapshot hash.
              Unlocking requires a rationale and will mark current reports STALE.</p>
              <LockClient mode="lock" year={year} />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
