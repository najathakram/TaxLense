import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Button } from "@/components/ui/button"
import { computeRiskScore, type RiskReport, type RiskSignal } from "@/lib/risk/score"
import { runLockAssertions, type AssertionRunResult } from "@/lib/validation/assertions"
import { attemptLock } from "../lock/actions"
import { LockClient } from "../lock/lock-client"
import { DownloadClient } from "../download/download-client"

interface Props {
  params: Promise<{ year: string }>
}

type SectionStatus = "done" | "ready" | "blocked" | "disabled"

const bandColor: Record<RiskReport["band"], string> = {
  LOW: "bg-emerald-500/20 text-emerald-500 border-emerald-500/40",
  MODERATE: "bg-amber-500/20 text-amber-500 border-amber-500/40",
  HIGH: "bg-orange-500/20 text-orange-500 border-orange-500/40",
  CRITICAL: "bg-red-500/20 text-red-500 border-red-500/40",
}

const severityBorder: Record<RiskSignal["severity"], string> = {
  CRITICAL: "border-red-500/40 bg-red-500/5",
  HIGH: "border-orange-500/40 bg-orange-500/5",
  MEDIUM: "border-amber-500/40 bg-amber-500/5",
  LOW: "border-emerald-500/40 bg-emerald-500/5",
}

export default async function FinalizePage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    include: { businessProfile: true },
  })
  if (!taxYear) notFound()

  const isLocked = taxYear.status === "LOCKED"

  // Run risk + assertions in parallel — these drive the Lock section's
  // gating + the Risk section's content. Skip when LOCKED to avoid
  // re-running expensive aggregates after the year is frozen.
  const [risk, assertions, reports] = await Promise.all([
    isLocked ? null : computeRiskScore(taxYear.id),
    isLocked ? null : runLockAssertions(taxYear.id),
    prisma.report.findMany({
      where: { taxYearId: taxYear.id, isCurrent: true },
    }),
  ])

  // Lock-attempt result mirrors the standalone /lock page so Section 2 can
  // show "ready / blocked" without rerunning the assertions chain. Skip when
  // already locked.
  const lockAttempt = isLocked ? null : await attemptLock(year)
  const lockBlockerCount = lockAttempt?.reasons.length ?? 0

  // Section status calculation — drives the numbered pills + body visibility.
  const riskStatus: SectionStatus = isLocked
    ? "done"
    : !lockAttempt?.blocked
      ? "done"
      : "ready"
  const lockStatus: SectionStatus = isLocked
    ? "done"
    : lockAttempt?.blocked
      ? "blocked"
      : "ready"
  const downloadStatus: SectionStatus = isLocked ? "ready" : "disabled"

  const reportMap = new Map(reports.map((r) => [r.kind, r]))

  const artifacts = [
    {
      kind: "MASTER_LEDGER" as const,
      title: "Master Ledger",
      description:
        "Locked transaction ledger with all classifications, IRC citations, evidence tiers, Merchant Rules, Stop Resolutions, and Profile Snapshot. Five-sheet XLSX.",
      filename: `taxlens-${year}-master-ledger.xlsx`,
    },
    {
      kind: "FINANCIAL_STATEMENTS" as const,
      title: "Financial Statements",
      description:
        "General Ledger, Schedule C totals, P&L statement, Balance Sheet (cash method), Schedule C Detail. Five-sheet XLSX. Schedule C totals match the locked ledger.",
      filename: `taxlens-${year}-financial-statements.xlsx`,
    },
    {
      kind: "AUDIT_PACKET" as const,
      title: "Audit Defense Packet",
      description:
        "ZIP: ledger XLSX, §274(d) substantiation CSVs, Cohan labels, position memos, income reconciliation, source documents inventory.",
      filename: `taxlens-${year}-audit-packet.zip`,
    },
    {
      kind: "TAX_PACKAGE" as const,
      title: "Tax Package (CPA Handoff)",
      description:
        "ZIP: PDF client summary, Schedule C worksheet, Form 8829, depreciation schedule, 1099-NEC recipients CSV, CPA handoff letter, plus Financial Statements + Master Ledger.",
      filename: `taxlens-${year}-tax-package.zip`,
    },
  ]

  return (
    <div className="p-6 space-y-6 max-w-4xl">
      {/* Header + breadcrumbs to old standalone routes for power users */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Finalize — Tax Year {year}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Three steps to lock the year and hand off to the CPA. Each gates the next.
          </p>
        </div>
        <Badge variant={isLocked ? "default" : "outline"} className="text-xs shrink-0">
          {taxYear.status}
        </Badge>
      </div>

      {/* Step rail — numbered circles + section names so the user can see at a
          glance where they are without scrolling. */}
      <div className="flex items-center gap-2 sm:gap-4 px-1">
        <StepBubble n={1} status={riskStatus} label="Review risk" anchor="risk" />
        <StepConnector status={riskStatus} />
        <StepBubble n={2} status={lockStatus} label="Lock ledger" anchor="lock" />
        <StepConnector status={lockStatus} />
        <StepBubble n={3} status={downloadStatus} label="Download" anchor="download" />
      </div>

      {/* SECTION 1 — Risk review */}
      <Section
        id="risk"
        number={1}
        status={riskStatus}
        title="Review risk signals"
        subtitle={
          isLocked
            ? "Year is locked — risk was reviewed prior to lock. View the standalone dashboard for full detail."
            : risk == null
              ? "Risk dashboard unavailable."
              : `${risk.score}/100 · ${risk.band} · est. tax impact $${risk.estimatedTaxImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
        }
      >
        {!isLocked && risk && assertions && (
          <RiskBody
            year={year}
            risk={risk}
            assertions={assertions}
            blockerCount={lockBlockerCount}
          />
        )}
        {isLocked && (
          <Alert>
            <AlertTitle>Locked</AlertTitle>
            <AlertDescription>
              <Link className="underline" href={`/years/${year}/risk`}>
                Open risk dashboard →
              </Link>
            </AlertDescription>
          </Alert>
        )}
      </Section>

      {/* SECTION 2 — Lock */}
      <Section
        id="lock"
        number={2}
        status={lockStatus}
        title={isLocked ? "Locked" : "Lock the ledger"}
        subtitle={
          isLocked
            ? `Locked ${taxYear.lockedAt?.toISOString().slice(0, 10) ?? "—"}`
            : lockStatus === "blocked"
              ? `${lockBlockerCount} blocker${lockBlockerCount === 1 ? "" : "s"} — resolve them above before locking`
              : "All assertions pass. Confirm the lock to freeze the ledger and emit the snapshot hash."
        }
      >
        {isLocked && taxYear.lockedAt && (
          <div className="space-y-3">
            <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 p-3">
              <p className="text-xs text-muted-foreground">
                <strong className="text-foreground">Locked at:</strong>{" "}
                {taxYear.lockedAt.toISOString()}
              </p>
              {taxYear.lockedSnapshotHash && (
                <p className="text-xs text-muted-foreground break-all mt-1">
                  <strong className="text-foreground">Snapshot hash:</strong>{" "}
                  <code className="font-mono">{taxYear.lockedSnapshotHash}</code>
                </p>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Unlocking marks derived reports STALE and requires a rationale.
            </p>
            <LockClient mode="unlock" year={year} />
          </div>
        )}
        {!isLocked && lockAttempt?.blocked && (
          <Alert variant="destructive">
            <AlertTitle>{lockBlockerCount} blocker{lockBlockerCount === 1 ? "" : "s"}</AlertTitle>
            <AlertDescription>
              <ul className="mt-2 list-disc space-y-1 pl-4 text-xs">
                {lockAttempt.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <Link className="underline" href={`/years/${year}/stops`}>
                  Resolve STOPs
                </Link>
                <Link className="underline" href={`/years/${year}/ledger`}>
                  Edit ledger
                </Link>
                <Link className="underline" href="#risk">
                  Re-check risk ↑
                </Link>
              </div>
            </AlertDescription>
          </Alert>
        )}
        {!isLocked && !lockAttempt?.blocked && lockAttempt && (
          <div className="space-y-3">
            <Alert>
              <AlertTitle>Ready to lock</AlertTitle>
              <AlertDescription className="text-xs">
                {lockAttempt.assertions.passed.length} QA assertions pass · risk score{" "}
                {lockAttempt.risk.score} ({lockAttempt.risk.band}) · est. deductions $
                {lockAttempt.risk.estimatedDeductions.toLocaleString(undefined, {
                  maximumFractionDigits: 0,
                })}
              </AlertDescription>
            </Alert>
            <p className="text-xs text-muted-foreground">
              Locking freezes the ledger and writes a SHA-256 snapshot hash. Unlocking later requires a rationale and marks current reports STALE.
            </p>
            <LockClient mode="lock" year={year} />
          </div>
        )}
      </Section>

      {/* SECTION 3 — Download */}
      <Section
        id="download"
        number={3}
        status={downloadStatus}
        title="Download artifacts"
        subtitle={
          downloadStatus === "disabled"
            ? "Available after lock."
            : "Reports are generated on demand from the locked snapshot — re-runs are reproducible."
        }
      >
        {downloadStatus === "disabled" && (
          <p className="text-xs text-muted-foreground">
            Lock the year above to enable downloads.
          </p>
        )}
        {downloadStatus === "ready" && (
          <div className="space-y-3">
            {artifacts.map((a) => {
              const report = reportMap.get(a.kind)
              return (
                <div
                  key={a.kind}
                  className="rounded-md border border-border p-3 flex items-start justify-between gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{a.title}</p>
                      {report && (
                        <span className="text-[10px] text-muted-foreground">
                          last generated {report.generatedAt.toISOString().slice(0, 10)}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                      {a.description}
                    </p>
                  </div>
                  <DownloadClient
                    year={year}
                    kind={a.kind}
                    filename={a.filename}
                    disabled={false}
                  />
                </div>
              )
            })}
            {taxYear.lockedSnapshotHash && (
              <p className="text-[10px] text-muted-foreground/80 font-mono break-all pt-2">
                snapshot sha256: {taxYear.lockedSnapshotHash.slice(0, 32)}…
              </p>
            )}
          </div>
        )}
      </Section>
    </div>
  )
}

function StepBubble({
  n,
  status,
  label,
  anchor,
}: {
  n: number
  status: SectionStatus
  label: string
  anchor: string
}) {
  const cls =
    status === "done"
      ? "bg-emerald-500/20 text-emerald-500 border-emerald-500/40"
      : status === "ready"
        ? "bg-blue-500/20 text-blue-500 border-blue-500/40"
        : status === "blocked"
          ? "bg-amber-500/20 text-amber-500 border-amber-500/40"
          : "bg-muted text-muted-foreground border-border"
  return (
    <a href={`#${anchor}`} className="flex items-center gap-2 group">
      <span
        className={`inline-flex items-center justify-center w-7 h-7 rounded-full border text-sm font-semibold ${cls}`}
        aria-label={`${label} — ${status}`}
      >
        {status === "done" ? "✓" : n}
      </span>
      <span className="text-sm font-medium hidden sm:inline group-hover:underline">
        {label}
      </span>
    </a>
  )
}

function StepConnector({ status }: { status: SectionStatus }) {
  const cls =
    status === "done" ? "bg-emerald-500/40" : "bg-border"
  return <span className={`flex-1 h-px ${cls}`} aria-hidden />
}

function Section({
  id,
  number,
  status,
  title,
  subtitle,
  children,
}: {
  id: string
  number: number
  status: SectionStatus
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  const isDisabled = status === "disabled"
  return (
    <Card id={id} className={isDisabled ? "opacity-60" : undefined}>
      <CardHeader className="pb-3">
        <div className="flex items-center gap-3">
          <StepBubble n={number} status={status} label="" anchor={id} />
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
          <StatusBadge status={status} />
        </div>
      </CardHeader>
      <CardContent className="space-y-3">{children}</CardContent>
    </Card>
  )
}

function StatusBadge({ status }: { status: SectionStatus }) {
  const map: Record<SectionStatus, { label: string; cls: string }> = {
    done: { label: "Done", cls: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30" },
    ready: { label: "Ready", cls: "bg-blue-500/15 text-blue-500 border-blue-500/30" },
    blocked: { label: "Blocked", cls: "bg-amber-500/15 text-amber-500 border-amber-500/30" },
    disabled: { label: "Locked", cls: "bg-muted text-muted-foreground border-border" },
  }
  const { label, cls } = map[status]
  return (
    <span
      className={`text-[10px] uppercase tracking-wide font-semibold px-2 py-0.5 rounded-full border shrink-0 ${cls}`}
    >
      {label}
    </span>
  )
}

function RiskBody({
  year,
  risk,
  assertions,
  blockerCount,
}: {
  year: number
  risk: RiskReport
  assertions: AssertionRunResult
  blockerCount: number
}) {
  const totalSignals =
    risk.critical.length + risk.high.length + risk.medium.length + risk.low.length

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className={`rounded border-2 px-4 py-3 text-center ${bandColor[risk.band]}`}>
          <div className="text-2xl font-bold tabular-nums">{risk.score}</div>
          <div className="text-[10px] uppercase tracking-wide font-semibold">
            {risk.band}
          </div>
        </div>
        <div className="rounded border border-border px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Est. deductions
          </p>
          <p className="text-xl font-bold tabular-nums">
            ${risk.estimatedDeductions.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="rounded border border-border px-4 py-3">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
            Est. tax impact
          </p>
          <p className="text-xl font-bold tabular-nums">
            ${risk.estimatedTaxImpact.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-[10px] text-muted-foreground/80 mt-0.5">
            {risk.estimatedTaxImpactNote}
          </p>
        </div>
      </div>

      {blockerCount > 0 && (
        <Alert variant="destructive">
          <AlertTitle>
            {blockerCount} blocker{blockerCount === 1 ? "" : "s"} preventing lock
          </AlertTitle>
          <AlertDescription className="text-xs">
            Resolve these before continuing to step 2.
          </AlertDescription>
        </Alert>
      )}

      {totalSignals > 0 && (
        <details className="group">
          <summary className="cursor-pointer text-sm font-medium hover:underline select-none">
            <span className="inline-block transition-transform group-open:rotate-90 mr-1">▸</span>
            All risk signals ({totalSignals})
          </summary>
          <div className="space-y-2 mt-3 pl-4">
            <SignalGroupCompact title="Critical" signals={risk.critical} />
            <SignalGroupCompact title="High" signals={risk.high} />
            <SignalGroupCompact title="Medium" signals={risk.medium} />
            <SignalGroupCompact title="Low / Informational" signals={risk.low} />
          </div>
        </details>
      )}

      {totalSignals === 0 && (
        <Alert>
          <AlertTitle>Clean</AlertTitle>
          <AlertDescription>No risk signals detected.</AlertDescription>
        </Alert>
      )}

      {/* QA assertions snapshot — collapsed by default since the standalone
          /risk page goes deeper. The user mostly cares about pass/fail count. */}
      <div className="text-xs text-muted-foreground flex items-center justify-between border-t border-border pt-2">
        <span>
          {assertions.passed.length} of{" "}
          {assertions.passed.length + assertions.failed.length} QA assertions pass
        </span>
        <Link className="underline" href={`/years/${year}/risk`}>
          Detailed dashboard →
        </Link>
      </div>
    </div>
  )
}

function SignalGroupCompact({
  title,
  signals,
}: {
  title: string
  signals: RiskSignal[]
}) {
  if (signals.length === 0) return null
  return (
    <div className="space-y-1">
      <p className="text-xs font-semibold text-muted-foreground">
        {title} · {signals.length}
      </p>
      {signals.map((s) => (
        <div
          key={s.id}
          className={`rounded border-l-4 p-2 text-xs ${severityBorder[s.severity]}`}
        >
          <div className="flex items-center justify-between">
            <strong>{s.title}</strong>
            <div className="flex gap-2">
              {s.blocking && <Badge variant="destructive" className="text-[10px]">Blocking</Badge>}
              {s.points > 0 && <span className="text-[10px] text-muted-foreground">+{s.points}</span>}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">{s.details}</p>
        </div>
      ))}
    </div>
  )
}
