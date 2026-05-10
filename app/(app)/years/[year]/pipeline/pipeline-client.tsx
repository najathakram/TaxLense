"use client"

import { useEffect, useRef, useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FloatingProgress } from "@/components/pipeline/floating-progress"
import { formatDuration, formatRelative } from "@/lib/jobs/receipts"
import {
  runNormalizeMerchants,
  runMatchTransfers,
  runMatchPayments,
  runMatchRefunds,
  runMerchantAI,
  runApplyRules,
  runResidualAI,
  runBulkClassify,
  runAutoResolveStops,
  runCpaAgentAction,
  runExtractRePass,
  getPipelineRunStatus,
} from "./actions"

interface PipelineStats {
  totalTx: number
  normalizedTx: number
  transferPairs: number
  paymentPairs: number
  refundPairs: number
  merchantRules: number
  classified: number
  stops: number
  /** Step 7 input — GRAY merchant rules at confidence < 0.85 (multi-candidate proxy). */
  residualCandidates: number
  /** Step 8 input — current classifications stamped NEEDS_CONTEXT. */
  needsContextCount: number
  /** Step 9 input — StopItems still PENDING. */
  pendingStops: number
  /** Re-extract banner — PDF imports with parse confidence < 0.85. */
  lowConfPdfCount: number
}

interface WireReceipt {
  changed: number
  unchanged: number | null
  skipped: number | null
  summary: string
  durationMs: number
  /** ISO string from the server (rehydrated to Date in formatRelative). */
  finishedAt: string
}

type ReceiptKind =
  | "NORMALIZE_MERCHANTS"
  | "MATCH_TRANSFERS"
  | "MATCH_PAYMENTS"
  | "MATCH_REFUNDS"
  | "MERCHANT_AI"
  | "APPLY_RULES"
  | "RESIDUAL_AI"
  | "BULK_CLASSIFY"
  | "AUTO_RESOLVE_STOPS"
  | "CPA_AGENT"
  | "EXTRACT_REPASS"

interface PipelineClientProps {
  year: number
  initial: PipelineStats
  receipts: Partial<Record<ReceiptKind, WireReceipt>>
}

interface StepResult {
  label: string
  detail: string
  ok: boolean
}

interface RunHandle {
  runId: string
  reused?: boolean
}

const POLL_INTERVAL_MS = 2_000

export function PipelineClient({ year, initial, receipts }: PipelineClientProps) {
  const [stats] = useState(initial)
  const [results, setResults] = useState<StepResult[]>([])
  const [isPending, startTransition] = useTransition()
  const [fullAutoRunning, setFullAutoRunning] = useState(false)
  const [activeRun, setActiveRun] = useState<{ runId: string; label: string } | null>(null)
  const [progress, setProgress] = useState<Record<string, unknown>>({})
  const [lastError, setLastError] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function addResult(label: string, detail: string, ok: boolean) {
    setResults((prev) => [...prev, { label, detail, ok }])
  }

  // Poll the active run until it leaves RUNNING. Stops the poll, reloads the
  // page so server-rendered stats refresh.
  useEffect(() => {
    if (!activeRun) {
      if (pollRef.current) {
        clearInterval(pollRef.current)
        pollRef.current = null
      }
      return
    }
    const tick = async () => {
      const status = await getPipelineRunStatus(activeRun.runId)
      if (!status) return
      setProgress((status.progress as Record<string, unknown>) ?? {})
      if (status.status === "DONE") {
        addResult(activeRun.label, JSON.stringify(status.result, null, 0), true)
        setActiveRun(null)
        setFullAutoRunning(false)
        setLastError(null)
        setTimeout(() => window.location.reload(), 250)
      } else if (status.status === "FAILED") {
        addResult(activeRun.label, status.lastError ?? "failed", false)
        setActiveRun(null)
        setFullAutoRunning(false)
        setLastError(status.lastError ?? "Run failed without an error message.")
      }
    }
    void tick()
    pollRef.current = setInterval(tick, POLL_INTERVAL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.runId])

  function run(action: () => Promise<RunHandle>, label: string) {
    startTransition(async () => {
      try {
        setLastError(null)
        const handle = await action()
        setProgress({})
        setActiveRun({ runId: handle.runId, label })
        if (handle.reused) {
          addResult(label, `(re-attached to in-progress run ${handle.runId})`, true)
        }
      } catch (err) {
        addResult(label, String(err), false)
        setLastError(String(err))
      }
    })
  }

  async function runFullAutoClassify() {
    setFullAutoRunning(true)
    setLastError(null)
    const stepsList = [
      { fn: () => runResidualAI(year), label: "7. Residual AI Pass" },
      { fn: () => runBulkClassify(year), label: "8. CPA Bulk Classify" },
      { fn: () => runAutoResolveStops(year), label: "9. Auto-Resolve Stops" },
    ]
    for (const step of stepsList) {
      try {
        const handle = await step.fn()
        // Activate the floating progress bar for this sub-step too so the user
        // can watch the phase change between steps 7 → 8 → 9.
        setProgress({})
        setActiveRun({ runId: handle.runId, label: step.label })
        await waitForRun(handle.runId, step.label, (logLabel, detail, ok, prog) => {
          if (prog) setProgress(prog as Record<string, unknown>)
          // Only write to the run log when waitForRun emits a non-empty label
          // (i.e. terminal status — DONE / FAILED). Empty label = progress tick.
          if (logLabel) addResult(logLabel, detail, ok)
        })
      } catch (err) {
        addResult(step.label, String(err), false)
        setLastError(String(err))
        break
      }
    }
    setActiveRun(null)
    setFullAutoRunning(false)
    setTimeout(() => window.location.reload(), 250)
  }

  // Per-step status derivation. Done = no work to do; Idle = upstream input
  // not ready yet; Ready = there's work to do here. Running is set live from
  // activeRun; Error not derived locally (covered by FloatingProgress).
  const totalNonZero = stats.totalTx > 0
  const stepStatus = (
    backlog: number,
    isReady: boolean,
  ): "done" | "ready" | "idle" =>
    !isReady ? "idle" : backlog === 0 ? "done" : "ready"

  const steps = [
    {
      id: "normalize",
      label: "1. Normalize Merchants",
      description: "Strip processor prefixes, trailing city/state, reference numbers",
      action: () => runNormalizeMerchants(year),
      stat: `${stats.normalizedTx} / ${stats.totalTx} normalized`,
      status: stepStatus(stats.totalTx - stats.normalizedTx, totalNonZero),
      receiptKind: "NORMALIZE_MERCHANTS" as const,
    },
    {
      id: "transfers",
      label: "2. Match Transfers",
      description: "Pair outflow/inflow across accounts (±5 days, same amount)",
      action: () => runMatchTransfers(year),
      stat: `${stats.transferPairs} transfer pairs`,
      // Transfers is informational — there's no "missing" backlog. Treat as
      // ready whenever there are transactions and at least one has been run.
      status: stepStatus(0, totalNonZero) as "done" | "ready" | "idle",
      receiptKind: "MATCH_TRANSFERS" as const,
    },
    {
      id: "payments",
      label: "3. Match Card Payments",
      description: 'Pair "Payment Thank You" with checking outflow',
      action: () => runMatchPayments(year),
      stat: `${stats.paymentPairs} payment pairs`,
      status: stepStatus(0, totalNonZero) as "done" | "ready" | "idle",
      receiptKind: "MATCH_PAYMENTS" as const,
    },
    {
      id: "refunds",
      label: "4. Match Refunds",
      description: "Pair credit card refunds to prior charges (90-day window)",
      action: () => runMatchRefunds(year),
      stat: `${stats.refundPairs} refund pairs`,
      status: stepStatus(0, totalNonZero) as "done" | "ready" | "idle",
      receiptKind: "MATCH_REFUNDS" as const,
    },
    {
      id: "ai",
      label: "5. Run Merchant AI",
      description: "Call Sonnet 4.6 in batches of 25 — classify unique merchants",
      action: () => runMerchantAI(year),
      stat: `${stats.merchantRules} rules`,
      // Done if every distinct normalized merchant has a rule. We don't have
      // that count here so use a softer check: "ready" while there are
      // transactions but no rules; "done" once any rule exists.
      status:
        !totalNonZero
          ? ("idle" as const)
          : stats.merchantRules === 0
            ? ("ready" as const)
            : ("done" as const),
      receiptKind: "MERCHANT_AI" as const,
    },
    {
      id: "apply",
      label: "6. Apply Rules",
      description: "Stamp Classification rows; apply trip overrides",
      action: () => runApplyRules(year),
      stat: `${stats.classified} classified, ${stats.stops} STOPs`,
      status: stepStatus(
        Math.max(0, stats.totalTx - stats.classified),
        stats.merchantRules > 0,
      ),
      receiptKind: "APPLY_RULES" as const,
    },
  ]

  // Steps 7–9 share the same gating: Apply Rules (step 6) must have run at
  // least once before any of these have meaningful input.
  const aiReady = stats.merchantRules > 0 && stats.classified > 0
  const aiSteps = [
    {
      id: "residual",
      label: "7. Residual AI Pass",
      description: "Classifies GRAY / outlier / trip-ambiguous transactions with per-transaction reasoning",
      action: () => runResidualAI(year),
      stat:
        stats.residualCandidates === 0
          ? "no residual candidates"
          : `${stats.residualCandidates} candidate${stats.residualCandidates === 1 ? "" : "s"}`,
      backlog: stats.residualCandidates,
      status: stepStatus(stats.residualCandidates, aiReady),
      receiptKind: "RESIDUAL_AI" as const,
    },
    {
      id: "bulk",
      label: "8. CPA Bulk Classify",
      description: "Senior CPA (Sonnet 4.6) classifies remaining NEEDS_CONTEXT — auto-applies ≥78% confidence",
      action: () => runBulkClassify(year),
      stat:
        stats.needsContextCount === 0
          ? "no NEEDS_CONTEXT rows"
          : `${stats.needsContextCount} NEEDS_CONTEXT`,
      backlog: stats.needsContextCount,
      status: stepStatus(stats.needsContextCount, aiReady),
      receiptKind: "BULK_CLASSIFY" as const,
    },
    {
      id: "autostops",
      label: "9. Auto-Resolve Stops",
      description: "Sonnet resolves PENDING stops at ≥85% confidence — no user input needed",
      action: () => runAutoResolveStops(year),
      stat:
        stats.pendingStops === 0
          ? "no pending stops"
          : `${stats.pendingStops} pending stop${stats.pendingStops === 1 ? "" : "s"}`,
      backlog: stats.pendingStops,
      status: stepStatus(stats.pendingStops, aiReady),
      receiptKind: "AUTO_RESOLVE_STOPS" as const,
    },
  ]

  const runDisabled = isPending || fullAutoRunning || activeRun !== null

  return (
    <div className="space-y-6">
      {/* Floating live progress — fixed bottom-right, visible across the whole page */}
      <FloatingProgress
        active={activeRun}
        progress={progress as { phase?: string; processed?: number; total?: number; label?: string }}
        errorMessage={lastError}
        recentResults={results}
      />

      {/* Hero: Autonomous CPA Agent — single-click rewrite that replaces the
          per-step flow below for normal use. The 6+3 stage buttons stay
          available as an "Advanced" disclosure. */}
      <Card className="border-2 border-primary/40 bg-gradient-to-br from-primary/5 to-transparent">
        <CardContent className="py-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-base">
                Autonomous CPA Agent <Badge variant="default" className="ml-2 text-xs align-middle">v1</Badge>
              </h3>
              <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                One Sonnet-led pass over the entire ledger. Classifies every transaction
                (with IRC citations + evidence tier + confidence), applies the same
                judgment a senior CPA would, and emits a single audit memo to the
                client&apos;s Documents folder. Defaults uncertain §274(d) rows to PERSONAL
                with a &quot;not-claimed&quot; line so you can promote them later by uploading
                receipts — no STOP queue.
              </p>
              <p className="text-xs text-muted-foreground/80 mt-2">
                This is the canonical CTA. Open <span className="font-medium">Advanced</span> below only to re-run a single phase.
              </p>
            </div>
            <Button
              size="lg"
              disabled={runDisabled}
              onClick={() => run(() => runCpaAgentAction(year), "Autonomous CPA Agent")}
              className="shrink-0"
            >
              {runDisabled ? "Running…" : "Run autonomous CPA"}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total transactions" value={stats.totalTx} />
        <StatCard label="Classified" value={stats.classified} />
        <StatCard label="Merchant rules" value={stats.merchantRules} />
        <StatCard label="STOPs pending" value={stats.stops} />
      </div>

      {/* Re-extraction (Phase A) — only useful when the original Haiku
          extraction came back with low confidence on scanned PDFs. */}
      <Card>
        <CardContent className="flex items-center justify-between py-4 gap-4">
          <div className="flex-1 min-w-0">
            <p className="font-medium text-sm">Re-extract low-confidence PDFs (Sonnet vision)</p>
            <p className="text-xs text-muted-foreground">
              Finds StatementImports below 0.85 parse confidence and re-runs Sonnet vision.
              Transactions de-dupe by idempotencyKey; safe to re-run.
            </p>
          </div>
          <Badge variant="outline" className="text-xs shrink-0">
            {stats.lowConfPdfCount} low-confidence PDF{stats.lowConfPdfCount === 1 ? "" : "s"}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            disabled={runDisabled}
            onClick={() => run(() => runExtractRePass(year), "Phase A · Sonnet vision re-extract")}
          >
            {runDisabled ? "Running…" : "Re-extract"}
          </Button>
        </CardContent>
      </Card>

      {/* Step buttons 1–6 + AI sub-pipeline 7–9 — the legacy multi-stage flow.
          Hidden by default behind an Advanced disclosure; normal use now goes
          through the autonomous CPA agent above. The 7→9 button stays inside
          this block so we have one canonical "Run everything" CTA at the top
          (Autonomous CPA) and one debugging surface here. */}
      <details className="group space-y-3">
        <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground flex items-center gap-2 select-none">
          <span className="transition-transform group-open:rotate-90 inline-block">▸</span>
          Advanced — run individual pipeline stages
        </summary>

        <div className="space-y-3 mt-3">
          {steps.map((step) => {
            const isRunning = activeRun?.label === step.label
            const liveStatus: "done" | "ready" | "idle" | "running" = isRunning ? "running" : step.status
            const stepDisabled = runDisabled || liveStatus === "idle" || liveStatus === "done"
            const receipt = receipts[step.receiptKind]
            return (
              <Card key={step.id} className={liveStatus === "done" ? "opacity-70" : undefined}>
                <CardContent className="py-4 gap-4 flex flex-col">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <StatusPill status={liveStatus} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{step.label}</p>
                        <p className="text-xs text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {step.stat}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={stepDisabled}
                      onClick={() => run(step.action, step.label)}
                    >
                      {isRunning ? "Running…" : liveStatus === "done" ? "Re-run" : "Run"}
                    </Button>
                  </div>
                  {receipt && <ReceiptLine receipt={receipt} />}
                </CardContent>
              </Card>
            )
          })}
        </div>

        <div className="space-y-3 mt-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold">AI Auto-Classification</h3>
              <p className="text-xs text-muted-foreground">
                Steps 7–9 cover 90–95% of remaining transactions automatically
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={runDisabled}
              onClick={runFullAutoClassify}
              className="shrink-0"
            >
              {fullAutoRunning ? "Running 7→9…" : "Run AI sub-pipeline (7→9)"}
            </Button>
          </div>
          {aiSteps.map((step) => {
            const isRunning = activeRun?.label === step.label
            const liveStatus: "done" | "ready" | "idle" | "running" = isRunning ? "running" : step.status
            const stepDisabled = runDisabled || liveStatus === "idle" || liveStatus === "done"
            const receipt = receipts[step.receiptKind]
            return (
              <Card key={step.id} className={liveStatus === "done" ? "opacity-70" : undefined}>
                <CardContent className="py-4 gap-4 flex flex-col">
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <StatusPill status={liveStatus} />
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm">{step.label}</p>
                        <p className="text-xs text-muted-foreground">{step.description}</p>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-xs shrink-0">
                      {step.stat}
                    </Badge>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={stepDisabled}
                      onClick={() => run(step.action, step.label)}
                    >
                      {isRunning ? "Running…" : liveStatus === "done" ? "Re-run" : "Run"}
                    </Button>
                  </div>
                  {receipt && <ReceiptLine receipt={receipt} />}
                </CardContent>
              </Card>
            )
          })}
        </div>
      </details>

      {/* Run log */}
      {results.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Run log</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 font-mono text-xs">
              {results.map((r, i) => (
                <div key={i} className={r.ok ? "text-green-600" : "text-red-600"}>
                  <span className="font-semibold">{r.ok ? "✓" : "✗"} {r.label}:</span>{" "}
                  {r.detail}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

async function waitForRun(
  runId: string,
  label: string,
  cb: (label: string, detail: string, ok: boolean, progress?: unknown) => void,
): Promise<void> {
  for (;;) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS))
    const status = await getPipelineRunStatus(runId)
    if (!status) return
    if (status.status === "RUNNING") {
      // Surface progress without writing a run-log line on every tick.
      cb("", "", true, status.progress)
      continue
    }
    if (status.status === "DONE") {
      cb(label, JSON.stringify(status.result, null, 0), true, status.progress)
      return
    }
    if (status.status === "FAILED") {
      cb(label, status.lastError ?? "failed", false, status.progress)
      throw new Error(status.lastError ?? "failed")
    }
  }
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-2xl font-bold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground mt-1">{label}</p>
      </CardContent>
    </Card>
  )
}

const STATUS_GLYPH = {
  done: "✓",
  running: "⋯",
  ready: "◌",
  idle: "–",
} as const

const STATUS_LABEL = {
  done: "Done",
  running: "Running",
  ready: "Ready",
  idle: "Idle",
} as const

const STATUS_CLASS = {
  // Tailwind utility tokens — match the existing dark/light theming used
  // elsewhere in the pipeline page so we don't introduce new design tokens.
  done: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30",
  running: "bg-blue-500/15 text-blue-500 border-blue-500/30 animate-pulse",
  ready: "bg-amber-500/15 text-amber-500 border-amber-500/30",
  idle: "bg-muted text-muted-foreground border-border",
} as const

function ReceiptLine({ receipt }: { receipt: WireReceipt }) {
  const finishedAt = new Date(receipt.finishedAt)
  const isNoOp = receipt.changed === 0
  const dotColor = isNoOp ? "bg-muted-foreground/40" : "bg-emerald-500/70"
  return (
    <div className="flex items-center gap-2 pl-10 pt-1">
      <span aria-hidden className={`inline-block w-1.5 h-1.5 rounded-full ${dotColor}`} />
      <p className="text-[11px] text-muted-foreground/80 leading-tight">
        Last run: {receipt.summary} · {formatDuration(receipt.durationMs)} · {formatRelative(finishedAt)}
      </p>
    </div>
  )
}

function StatusPill({ status }: { status: "done" | "running" | "ready" | "idle" }) {
  return (
    <span
      title={STATUS_LABEL[status]}
      className={`inline-flex items-center justify-center w-7 h-7 rounded-full border text-sm font-semibold shrink-0 ${STATUS_CLASS[status]}`}
      aria-label={`Status: ${STATUS_LABEL[status]}`}
    >
      {STATUS_GLYPH[status]}
    </span>
  )
}
