import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { computeRiskScore, type RiskReport, type RiskSignal } from "@/lib/risk/score"
import { runLockAssertions, type AssertionRunResult } from "@/lib/validation/assertions"

interface Props {
  params: Promise<{ year: string }>
}

const bandColor: Record<RiskReport["band"], string> = {
  LOW: "bg-green-100 text-green-800 border-green-300",
  MODERATE: "bg-yellow-100 text-yellow-800 border-yellow-300",
  HIGH: "bg-orange-100 text-orange-800 border-orange-300",
  CRITICAL: "bg-red-100 text-red-800 border-red-300",
}

const severityColor: Record<RiskSignal["severity"], string> = {
  CRITICAL: "border-red-500 bg-red-50",
  HIGH: "border-orange-500 bg-orange-50",
  MEDIUM: "border-yellow-500 bg-yellow-50",
  LOW: "border-green-500 bg-green-50",
}

function SignalGroup({ title, signals }: { title: string; signals: RiskSignal[] }) {
  if (signals.length === 0) return null
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title} ({signals.length})</CardTitle></CardHeader>
      <CardContent className="space-y-2">
        {signals.map((s) => (
          <div key={s.id} className={`rounded border-l-4 p-3 ${severityColor[s.severity]}`}>
            <div className="flex items-center justify-between">
              <strong className="text-sm">{s.title}</strong>
              <div className="flex gap-2 text-xs">
                {s.blocking && <Badge variant="destructive">Blocking</Badge>}
                {s.points > 0 && <Badge variant="secondary">+{s.points} pts</Badge>}
              </div>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{s.details}</p>
            {s.transactionIds && s.transactionIds.length > 0 && (
              <p className="mt-1 text-xs">
                {s.transactionIds.length} affected txn{s.transactionIds.length === 1 ? "" : "s"} —{" "}
                <Link className="text-blue-600 underline" href={`../ledger`}>view in ledger</Link>
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}

function AssertionsPanel({ result }: { result: AssertionRunResult }) {
  const all = [...result.passed, ...result.failed].sort((a, b) => a.id.localeCompare(b.id))
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">QA Assertions</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-1 text-sm">
          {all.map((a) => (
            <li key={a.id} className="flex items-start gap-2">
              <span>{a.passed ? "✓" : a.blocking ? "✗" : "!"}</span>
              <span className="flex-1">
                <strong>[{a.id}]</strong> {a.name}
                <span className="ml-1 text-xs text-muted-foreground">— {a.details}</span>
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

export default async function RiskPage({ params }: Props) {
  const { year: yearParam } = await params
  const session = await requireAuth()
  const userId = session.user!.id!
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: { businessProfile: true },
  })
  if (!taxYear) notFound()

  const [risk, assertions] = await Promise.all([
    computeRiskScore(taxYear.id),
    runLockAssertions(taxYear.id),
  ])

  const blockedCount = assertions.blockingFailures.length + risk.critical.filter((s) => s.blocking).length
  const hasBlockers = blockedCount > 0

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Audit Risk Dashboard — Tax Year {year}</h1>
          <p className="text-sm text-muted-foreground">Deterministic risk scoring per spec §11.2. No AI here.</p>
        </div>
        <div className={`rounded border-2 px-6 py-3 text-center ${bandColor[risk.band]}`}>
          <div className="text-3xl font-bold">{risk.score}</div>
          <div className="text-xs">/ 100 — {risk.band}</div>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Estimated Deductions</CardTitle></CardHeader>
          <CardContent><span className="text-2xl font-bold">${risk.estimatedDeductions.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span></CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Estimated Tax Impact</CardTitle></CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">${risk.estimatedTaxImpact.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            <p className="mt-1 text-xs text-muted-foreground">{risk.estimatedTaxImpactNote}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm text-muted-foreground">Lock Status</CardTitle></CardHeader>
          <CardContent>
            <div className="text-lg font-bold">{taxYear.status}</div>
            <Button asChild size="sm" className="mt-2" disabled={hasBlockers}>
              <Link href={`/years/${year}/lock`}>{hasBlockers ? `${blockedCount} blocker${blockedCount === 1 ? "" : "s"}` : "Attempt lock"}</Link>
            </Button>
          </CardContent>
        </Card>
      </div>

      {hasBlockers && (
        <Alert variant="destructive">
          <AlertTitle>Lock blocked</AlertTitle>
          <AlertDescription>
            {blockedCount} blocking issue{blockedCount === 1 ? "" : "s"} must be resolved before lock.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          <SignalGroup title="Critical" signals={risk.critical} />
          <SignalGroup title="High" signals={risk.high} />
          <SignalGroup title="Medium" signals={risk.medium} />
          <SignalGroup title="Low / Informational" signals={risk.low} />
          {risk.critical.length + risk.high.length + risk.medium.length + risk.low.length === 0 && (
            <Alert>
              <AlertTitle>Clean</AlertTitle>
              <AlertDescription>No risk signals detected.</AlertDescription>
            </Alert>
          )}
        </div>
        <AssertionsPanel result={assertions} />
      </div>
    </div>
  )
}
