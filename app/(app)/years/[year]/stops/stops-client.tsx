"use client"

import { createContext, useContext, useEffect, useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import type { StopCategory, StopState } from "@/app/generated/prisma/client"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { resolveStop, deferStop, archiveSupersededStops, type StopAnswer } from "./actions"
import { runGenerateAiProposals, getPipelineRunStatus } from "@/app/(app)/years/[year]/pipeline/actions"
import { FloatingProgress } from "@/components/pipeline/floating-progress"
import type { AiSuggestion } from "@/lib/stops/aiSuggestion"
import { fmtUSD } from "@/lib/format/currency"

export type { AiSuggestion } from "@/lib/stops/aiSuggestion"

export interface SerializedAffected {
  id: string
  postedDate: string
  accountNickname: string | null
  merchantRaw: string
  amount: number
}

export interface SerializedStop {
  id: string
  category: StopCategory
  state: StopState
  question: string
  context: Record<string, unknown>
  merchantRuleId: string | null
  merchantKey: string | null
  totalAmount: number
  affected: SerializedAffected[]
  /** AI's pre-selected default for the form. Populated for MERCHANT,
   *  TRANSFER, and DEPOSIT stops (anything where we have either a
   *  persisted Sonnet decision below the auto-resolve threshold, a
   *  confirmed MerchantRule mapping, or a high-confidence pattern match).
   *  When present, the form opens with the corresponding radio chosen and
   *  shows an "AI suggests …" banner — the user can confirm with one
   *  click instead of reading four blank radios. When null, the radio
   *  stays unselected and Resolve is disabled until the user picks. */
  aiSuggestion: AiSuggestion | null
  /** Prior answer JSON — present on ANSWERED stops. Used to prefill the form
   *  when the user clicks "Edit answer" on an already-resolved STOP. May
   *  carry the AI auto-resolve shape ({autoResolved: true, code, ...}) which
   *  doesn't match StopAnswer; the form treats that as "no prefill". */
  userAnswer: Record<string, unknown> | null
  /** ISO timestamp — shown beside the ANSWERED badge so the user can see
   *  when the prior answer was recorded. */
  answeredAt: string | null
}

const CATEGORIES: { key: StopCategory; label: string }[] = [
  { key: "MERCHANT", label: "Merchant" },
  { key: "TRANSFER", label: "Transfer" },
  { key: "DEPOSIT", label: "Deposit" },
  { key: "SECTION_274D", label: "§274(d)" },
  { key: "PERIOD_GAP", label: "Period Gap" },
]

// Entity-aware form-line context. The MerchantForm's "Override line"
// dropdown reads this so an S-Corp user sees Form 1120-S lines instead of
// Schedule C lines. Default keeps the page renderable in isolation (tests
// that mount StopsClient with no provider get Schedule C semantics).
const FormLinesContext = createContext<{ lines: string[]; label: string }>({
  lines: [],
  label: "Sch C Line",
})

const POLL_MS = 2_000

export interface LastAutoSummary {
  /** Which pipeline kind produced this run — drives the label rendering
   *  ("auto-resolved" vs "auto-applied", "skipped" vs "pending review"). */
  kind?: "AUTO_RESOLVE_STOPS" | "GENERATE_AI_PROPOSALS"
  status: string
  startedAt: string
  finishedAt: string | null
  result: {
    resolved?: number
    skipped?: number
    errors?: number
    skipBreakdown?: Record<string, number>
    details?: Array<{ merchantKey: string; code: string; confidence: number; status: string; reason?: string }>
  } | null
  lastError: string | null
}

export function StopsClient({
  year,
  stops,
  initialCategory,
  lastAutoSummary,
  pendingProposalsCount = 0,
  formLines = [],
  formLineLabel = "Sch C Line",
}: {
  year: number
  stops: SerializedStop[]
  /** Optional category to land on when the user deep-links via
   *  ?cat=DEPOSIT (e.g. from Risk dashboard "Resolve deposits queue →"). */
  initialCategory?: string | null
  /** Server-rendered summary of the most recent AUTO_RESOLVE_STOPS run.
   *  Persists across page reloads so the user can see why the last
   *  Auto-resolve attempt didn't drop the count (e.g. "0 resolved, 22
   *  skipped — 22 low_confidence"). */
  lastAutoSummary?: LastAutoSummary | null
  /** Count of pending stops with an aiProposal — drives a banner that
   *  routes the CPA to /review even after a page reload. */
  pendingProposalsCount?: number
  /** Allowed form-line strings for the taxpayer's entity. Drives the
   *  MerchantForm "Override line" dropdown. */
  formLines?: string[]
  /** Column-label per entity ("Sch C Line", "Form 1120-S Line", …). */
  formLineLabel?: string
}) {
  const [activeRun, setActiveRun] = useState<{ runId: string; label: string } | null>(null)
  const [progress, setProgress] = useState<Record<string, unknown>>({})
  const [lastError, setLastError] = useState<string | null>(null)
  // The result shape needs to carry skipBreakdown — the floating progress chip
  // reads it to render "5 resolved · 17 skipped (12 low_confidence, 5
  // missing_from_response)" instead of just the headline counters. Without
  // this typing, the new field was being thrown away when the result landed.
  const [lastResult, setLastResult] = useState<{
    resolved: number
    skipped: number
    errors: number
    skipBreakdown?: Record<string, number>
  } | null>(null)
  // Filter: default PENDING-only because that's the actionable list. The
  // toggle reveals ANSWERED + DEFERRED for history / re-answer flows.
  // Keeping ANSWERED stops in the same scroll list mixed with PENDING was a
  // common confusion point — sidebar said "94 pending" while the page showed
  // 200+ cards.
  const [showAnswered, setShowAnswered] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Polling: while a run is active, fetch its status every 2s, surface progress,
  // and reload the page on DONE so the server-rendered stop list refreshes.
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
        // The new result shape is from generateAiProposals — generated /
        // autoApplied / pendingReview. Map onto the legacy {resolved,
        // skipped, errors} so the floating chip still renders something
        // sensible, then redirect to /review where the CPA can scan and
        // bulk-approve the rest.
        const r = (status.result as {
          generated?: number
          autoApplied?: number
          pendingReview?: number
          errors?: number
          withPriorCaseContext?: number
        } | null) ?? null
        if (r) {
          setLastResult({
            resolved: r.autoApplied ?? 0,
            skipped: r.pendingReview ?? 0,
            errors: r.errors ?? 0,
            skipBreakdown: r.withPriorCaseContext != null && r.generated != null
              ? { with_prior_cases: r.withPriorCaseContext, without_prior_cases: r.generated - r.withPriorCaseContext }
              : undefined,
          })
        }
        setActiveRun(null)
        // Refresh /stops so the cards re-render with the freshly persisted
        // aiSuggestion: radios get pre-selected per stop, and the
        // "Other — explain" textarea pre-fills with the AI's reasoning.
        // The user reviews each card in place and clicks Resolve. The
        // dedicated /review screen is still accessible via the banner
        // for users who prefer the bulk-approve UX.
        setTimeout(() => window.location.reload(), 2500)
      } else if (status.status === "FAILED") {
        setLastError(status.lastError ?? "Generation failed.")
        setActiveRun(null)
      }
    }
    void tick()
    pollRef.current = setInterval(tick, POLL_MS)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.runId])

  const onAutoResolve = async () => {
    setLastError(null)
    setLastResult(null)
    setProgress({})
    try {
      const handle = await runGenerateAiProposals(year)
      setActiveRun({ runId: handle.runId, label: "Generating AI recommendations" })
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e))
    }
  }

  const byCat = new Map<StopCategory, SerializedStop[]>()
  for (const c of CATEGORIES) byCat.set(c.key, [])
  for (const s of stops) {
    if (!showAnswered && s.state !== "PENDING") continue
    byCat.get(s.category)?.push(s)
  }
  for (const [, arr] of byCat) arr.sort((a, b) => b.totalAmount - a.totalAmount)

  const pendingCount = (cat: StopCategory) =>
    stops.filter((s) => s.category === cat && s.state === "PENDING").length

  const answeredCount = stops.filter((s) => s.state !== "PENDING").length
  const totalPending = CATEGORIES.reduce((n, c) => n + pendingCount(c.key), 0)

  // B-03: pick the default tab so the user lands on a populated page rather
  // than "No items in this category." Pre-fix: 47 deposit STOPs would render
  // as "Merchant (0) — No items" because Merchant was hard-coded as default.
  // New rule: highest pending-count category wins; ties prefer the order in
  // CATEGORIES (Merchant > Transfer > Deposit > §274(d) > Period Gap).
  // initialCategory wins (URL ?cat=X deep-link from Risk fix-it). Otherwise
  // the highest-pending-count category — see B-03 above.
  const defaultTab: StopCategory =
    (initialCategory && CATEGORIES.find((c) => c.key === initialCategory)?.key) ||
    CATEGORIES.reduce<{ key: StopCategory; n: number }>(
      (best, c) => {
        const n = pendingCount(c.key)
        return n > best.n ? { key: c.key, n } : best
      },
      { key: "MERCHANT", n: 0 },
    ).key

  const autoBusy = activeRun !== null

  return (
    <FormLinesContext.Provider value={{ lines: formLines, label: formLineLabel }}>
    <div className="space-y-4">
      {/* Floating progress panel — shows live "X of N · resolved · skipped" while
          a run is in flight, then a green ✓ summary when it completes. */}
      <FloatingProgress
        active={activeRun}
        progress={progress as { phase?: string; processed?: number; total?: number; label?: string }}
        errorMessage={lastError}
        recentResults={lastResult ? [{
          ok: lastResult.errors === 0,
          // Match the persistent panel labels: the new flow is review-first
          // ("auto-applied / pending review") not write-now
          // ("resolved / skipped"). The numbers come from the same shape
          // mapping the polling tick already does in onAutoResolve above.
          label: "AI proposals",
          detail: (() => {
            const head = `${lastResult.resolved} auto-applied · ${lastResult.skipped} pending review · ${lastResult.errors} errors`
            const bd = (lastResult as { skipBreakdown?: Record<string, number> }).skipBreakdown
            if (!bd) return head
            const parts = Object.entries(bd)
              .sort((a, b) => b[1] - a[1])
              .map(([reason, n]) => (n > 0 ? `${n} ${reason}` : reason))
              .join(", ")
            return parts ? `${head} (${parts})` : head
          })(),
        }] : []}
      />

      {/* Persistent "last run" panel — survives the page reload that the
          floating chip doesn't. Labels swap based on which kind of run
          produced the latest entry: AUTO_RESOLVE_STOPS uses
          "resolved/skipped/errors"; GENERATE_AI_PROPOSALS uses
          "auto-applied / pending review / errors" — same numbers, but
          the labels match what the run actually does. */}
      {lastAutoSummary && lastAutoSummary.result && (
        <div className="rounded border bg-muted/20 p-3 text-sm space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium">
              {lastAutoSummary.kind === "GENERATE_AI_PROPOSALS"
                ? "Last AI proposal run"
                : "Last auto-resolve run"}
            </span>
            <span className="text-xs text-muted-foreground">
              {new Date(lastAutoSummary.startedAt).toLocaleString()} ·{" "}
              {lastAutoSummary.status}
              {lastAutoSummary.lastError ? ` · ${lastAutoSummary.lastError.slice(0, 80)}` : ""}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">
            {(() => {
              const r = lastAutoSummary.result!
              const isProposal = lastAutoSummary.kind === "GENERATE_AI_PROPOSALS"
              const head = isProposal
                ? `${r.resolved ?? 0} auto-applied · ${r.skipped ?? 0} pending review · ${r.errors ?? 0} errors`
                : `${r.resolved ?? 0} resolved · ${r.skipped ?? 0} skipped · ${r.errors ?? 0} errors`
              const bd = r.skipBreakdown
              if (!bd) return head
              const parts = Object.entries(bd)
                .sort((a, b) => b[1] - a[1])
                .map(([reason, n]) => (n > 0 ? `${n} ${reason}` : reason))
                .join(", ")
              return parts ? `${head} (${parts})` : head
            })()}
          </div>
          {lastAutoSummary.result.details && lastAutoSummary.result.details.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-muted-foreground hover:text-foreground">
                Per-stop detail ({lastAutoSummary.result.details.length})
              </summary>
              <ul className="mt-2 space-y-0.5 max-h-48 overflow-auto pl-4 list-disc">
                {lastAutoSummary.result.details.slice(0, 100).map((d, i) => (
                  <li key={i} className={d.status === "resolved" ? "text-green-600" : d.status === "error" ? "text-red-500" : "text-amber-500"}>
                    <span className="font-mono">{d.merchantKey.slice(0, 32)}</span> · {d.code} · {Math.round(d.confidence * 100)}% · {d.status}
                    {d.reason ? ` (${d.reason})` : ""}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {/* Pending-proposals banner — only shows when proposals from a prior
          generation run are waiting. Lets the CPA find /review even if they
          navigated away from the post-generation auto-redirect. */}
      {pendingProposalsCount > 0 && (
        <div className="rounded border border-blue-500/30 bg-blue-500/10 px-4 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-sm">
            <span className="font-medium">AI has {pendingProposalsCount} recommendation{pendingProposalsCount === 1 ? "" : "s"} waiting for your review.</span>
            <span className="text-muted-foreground ml-2">High-confidence picks were already auto-applied — these need your call.</span>
          </div>
          <a
            href={`/years/${year}/stops/review`}
            className="text-sm font-semibold text-blue-600 hover:underline"
          >
            Review and approve →
          </a>
        </div>
      )}

      {/* Auto-resolve banner */}
      <div className="flex items-center justify-between gap-4 border rounded p-3 bg-muted/30 flex-wrap">
        <div className="text-sm flex items-center gap-3 flex-wrap">
          <span className="font-medium">{totalPending} pending stops</span>
          <span className="text-muted-foreground">— AI (Sonnet) drafts a proposal for every pending stop using your prior similar resolutions; review on the next page before any classifications land in the ledger.</span>
          {answeredCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAnswered((v) => !v)}
              className="text-xs underline text-muted-foreground hover:text-foreground"
            >
              {showAnswered
                ? `Hide ${answeredCount} answered`
                : `Show ${answeredCount} answered`}
            </button>
          )}
        </div>
        <div className="flex gap-2">
          <ArchiveSupersededButton
            year={year}
            disabled={autoBusy || totalPending === 0}
          />
          <Button size="sm" disabled={autoBusy || totalPending === 0} onClick={onAutoResolve}>
            {autoBusy ? "Generating…" : "Generate AI recommendations"}
          </Button>
        </div>
      </div>
    <Tabs defaultValue={defaultTab} className="w-full">
      <TabsList className="grid w-full grid-cols-5">
        {CATEGORIES.map((c) => (
          <TabsTrigger key={c.key} value={c.key}>
            {c.label} ({pendingCount(c.key)})
          </TabsTrigger>
        ))}
      </TabsList>
      {CATEGORIES.map((c) => (
        <TabsContent key={c.key} value={c.key} className="space-y-3 mt-4">
          {(byCat.get(c.key) ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">No items in this category.</p>
          ) : (
            (byCat.get(c.key) ?? []).map((s) => <StopCard key={s.id} stop={s} />)
          )}
        </TabsContent>
      ))}
    </Tabs>
    </div>
    </FormLinesContext.Provider>
  )
}

/**
 * "Archive superseded STOPs" button — clears legacy STOPs whose underlying
 * transactions now have a current Classification (i.e. the autonomous CPA
 * agent has already decided them). Use after running the agent if the
 * inline archival hook didn't fire (Atif's prod ledger surfaced this case).
 */
function ArchiveSupersededButton({
  year,
  disabled,
}: {
  year: number
  disabled: boolean
}) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ archived: number; skipped: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="outline"
        disabled={busy || disabled}
        onClick={async () => {
          setBusy(true)
          setError(null)
          try {
            const r = await archiveSupersededStops(year)
            setResult(r)
            // Reload so counts on this page update from the server-rendered version.
            setTimeout(() => window.location.reload(), 800)
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e))
          } finally {
            setBusy(false)
          }
        }}
        title="Archive STOPs whose transactions are already classified by the autonomous agent"
      >
        {busy ? "Archiving…" : "Archive superseded"}
      </Button>
      {result && (
        <span className="text-[11px] text-muted-foreground">
          {result.archived} archived · {result.skipped} skipped
        </span>
      )}
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </div>
  )
}

function StopCard({ stop }: { stop: SerializedStop }) {
  const [open, setOpen] = useState(stop.state === "PENDING")
  // For PENDING stops the form is the body of the card. For ANSWERED /
  // DEFERRED stops the body shows a prior-answer summary by default; clicking
  // "Edit answer" reveals the form so the user can correct a mistake.
  const [editing, setEditing] = useState(stop.state === "PENDING")

  // Deep-link target: ledger rows with an open STOP link to /stops#stop-<id>,
  // and the browser will scroll this anchor into view. The scroll-margin-top
  // accommodates the year-stepper bar above (Tier 3.10).
  return (
    <Card id={`stop-${stop.id}`} style={{ scrollMarginTop: 80 }}>
      <CardHeader className="cursor-pointer" onClick={() => setOpen(!open)}>
        <div className="flex items-center justify-between gap-2">
          <CardTitle className="text-base">
            {stop.merchantKey ?? (stop.affected[0]?.merchantRaw ?? "STOP")}{" "}
            <span className="text-sm font-normal text-muted-foreground">
              · {fmtUSD(stop.totalAmount, { cents: true })} · {stop.affected.length} txn
              {stop.affected.length !== 1 ? "s" : ""}
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            {stop.answeredAt && stop.state === "ANSWERED" && (
              <span className="text-xs text-muted-foreground hidden sm:inline">
                {stop.answeredAt.slice(0, 10)}
              </span>
            )}
            <Badge variant={stop.state === "PENDING" ? "default" : "secondary"}>
              {stop.state}
            </Badge>
          </div>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <p className="text-sm">{stop.question}</p>
          <AffectedTable rows={stop.affected} />
          {stop.state === "PENDING" ? (
            <AnswerForm stop={stop} prior={null} />
          ) : (
            <AnsweredBody
              stop={stop}
              editing={editing}
              onToggle={() => setEditing((v) => !v)}
            />
          )}
        </CardContent>
      )}
    </Card>
  )
}

/**
 * Renders the body of an ANSWERED / DEFERRED stop. Default state shows a
 * one-line summary of the prior answer + an "Edit answer" button. Clicking
 * Edit reveals the same AnswerForm a PENDING stop shows, prefilled from
 * the prior userAnswer (best-effort — AI auto-resolved answers don't match
 * the StopAnswer shape and fall back to defaults).
 */
function AnsweredBody({
  stop,
  editing,
  onToggle,
}: {
  stop: SerializedStop
  editing: boolean
  onToggle: () => void
}) {
  const prior = parsePriorAnswer(stop)
  const summary = priorAnswerSummary(stop)

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-muted/30 p-3 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 text-xs">
          <p className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">
            Prior answer
          </p>
          <p className="mt-1 text-sm">{summary}</p>
          {stop.answeredAt && (
            <p className="text-[11px] text-muted-foreground mt-1">
              recorded {stop.answeredAt.replace("T", " ").slice(0, 16)} UTC
            </p>
          )}
        </div>
        <Button size="sm" variant={editing ? "outline" : "default"} onClick={onToggle}>
          {editing ? "Cancel" : "Edit answer"}
        </Button>
      </div>
      {editing && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-3 space-y-2">
          <p className="text-[11px] text-blue-500 font-semibold uppercase tracking-wide">
            Editing prior answer
          </p>
          <AnswerForm stop={stop} prior={prior} />
        </div>
      )}
    </div>
  )
}

/**
 * Try to coerce stop.userAnswer back to a StopAnswer for prefilling. AI
 * auto-resolve writes a different shape ({autoResolved: true, code, ...})
 * which we can't prefill; return null and the form will show fresh defaults.
 */
function parsePriorAnswer(stop: SerializedStop): StopAnswer | null {
  const raw = stop.userAnswer
  if (!raw || typeof raw !== "object") return null
  const kind = (raw as { kind?: string }).kind
  if (
    kind === "merchant" ||
    kind === "transfer" ||
    kind === "deposit" ||
    kind === "section_274d"
  ) {
    return raw as unknown as StopAnswer
  }
  return null
}

/**
 * Best-effort one-line description of the prior answer for the summary
 * card. Falls back to "Auto-resolved by AI" or "Answered manually" when
 * the JSON shape doesn't match a known StopAnswer.
 */
function priorAnswerSummary(stop: SerializedStop): string {
  const raw = stop.userAnswer as Record<string, unknown> | null
  if (raw && raw.autoResolved === true) {
    const code = typeof raw.code === "string" ? raw.code : "—"
    const conf = typeof raw.confidence === "number" ? raw.confidence : null
    return conf != null
      ? `Auto-resolved by AI as ${code} (${(conf * 100).toFixed(0)}% confidence)`
      : `Auto-resolved by AI as ${code}`
  }
  const prior = parsePriorAnswer(stop)
  if (!prior) return "Answered (prior shape not recognized)"
  switch (prior.kind) {
    case "merchant":
      return `${prior.choice}${prior.scheduleCLine ? ` · Sch C ${prior.scheduleCLine}` : ""}${prior.other ? ` · "${prior.other}"` : ""}`
    case "transfer":
      return `${prior.choice}${prior.payeeName ? ` · ${prior.payeeName}` : ""}${prior.purpose ? ` · ${prior.purpose}` : ""}`
    case "deposit":
      return `${prior.choice}${prior.other ? ` · "${prior.other}"` : ""}`
    case "section_274d":
      return `Attendees: ${prior.attendees} · ${prior.relationship} · ${prior.purpose}`
  }
}

function AffectedTable({ rows }: { rows: SerializedAffected[] }) {
  if (rows.length === 0) return null
  return (
    <div className="text-xs border rounded">
      <table className="w-full">
        <thead className="bg-muted/50">
          <tr>
            <th className="text-left p-2">Date</th>
            <th className="text-left p-2">Account</th>
            <th className="text-left p-2">Raw</th>
            <th className="text-right p-2">Amount</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 10).map((r) => (
            <tr key={r.id} className="border-t">
              <td className="p-2">{r.postedDate}</td>
              <td className="p-2">{r.accountNickname}</td>
              <td className="p-2 truncate max-w-xs">{r.merchantRaw}</td>
              <td className="p-2 text-right">{fmtUSD(r.amount, { cents: true })}</td>
            </tr>
          ))}
          {rows.length > 10 && (
            <tr>
              <td colSpan={4} className="p-2 text-muted-foreground italic">
                +{rows.length - 10} more
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

function AnswerForm({
  stop,
  prior,
}: {
  stop: SerializedStop
  prior: StopAnswer | null
}) {
  switch (stop.category) {
    case "MERCHANT":
      return <MerchantForm stop={stop} prior={prior?.kind === "merchant" ? prior : null} />
    case "TRANSFER":
      return <TransferForm stop={stop} prior={prior?.kind === "transfer" ? prior : null} />
    case "DEPOSIT":
      return <DepositForm stop={stop} prior={prior?.kind === "deposit" ? prior : null} />
    case "SECTION_274D":
      return <Section274dForm stop={stop} prior={prior?.kind === "section_274d" ? prior : null} />
    case "PERIOD_GAP":
      return <PeriodGapForm stop={stop} />
  }
}

function useSubmit(stopId: string) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const submit = (answer: StopAnswer, applyToSimilar: boolean) => {
    setError(null)
    start(async () => {
      try {
        await resolveStop(stopId, answer, applyToSimilar)
        // revalidatePath in the action marks the cache stale; router.refresh
        // forces THIS tab to re-fetch the server-rendered tree so the
        // ledger / stops counts update without a hard reload.
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }
  const defer = () => {
    setError(null)
    start(async () => {
      try {
        await deferStop(stopId)
        router.refresh()
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }
  return { pending, error, submit, defer }
}

type MerchantChoice = "ALL_BUSINESS" | "DURING_TRIPS" | "MIXED_50" | "PERSONAL" | "OTHER"
const MERCHANT_CHOICE_LABEL: Record<MerchantChoice, string> = {
  ALL_BUSINESS: "All business 100%",
  DURING_TRIPS: "Business during confirmed trips only",
  MIXED_50: "Mixed 50/50",
  PERSONAL: "Personal",
  OTHER: "Other — explain",
}

function MerchantForm({
  stop,
  prior,
}: {
  stop: SerializedStop
  prior: Extract<StopAnswer, { kind: "merchant" }> | null
}) {
  // Initial choice precedence: prior (re-answer) > AI suggestion > unselected.
  // We deliberately do NOT fall back to "ALL_BUSINESS" — letting a user
  // accidentally click "Resolve" on a default they never read was the cause
  // of "All business 100%" creeping into rows the AI thought were personal.
  const aiMerchant = stop.aiSuggestion?.kind === "merchant" ? stop.aiSuggestion : null
  const initialChoice: MerchantChoice | null =
    prior?.choice ?? aiMerchant?.choice ?? null
  const [choice, setChoice] = useState<MerchantChoice | null>(initialChoice)
  // Pre-fill the "Other — explain" textarea from the AI's reasoning when
  // the AI chose OTHER (which is what NEEDS_CONTEXT now maps to). The
  // user can edit it before clicking Resolve.
  const aiOtherText = aiMerchant?.choice === "OTHER" ? aiMerchant.reasoning ?? "" : ""
  const [other, setOther] = useState(prior?.other ?? aiOtherText)
  const [line, setLine] = useState<string>(
    prior?.scheduleCLine ?? aiMerchant?.scheduleCLine ?? "",
  )
  const [applyToSimilar, setApplyToSimilar] = useState(true)
  const { pending, error, submit, defer } = useSubmit(stop.id)

  const ai = aiMerchant
  const showAiHint = ai && !prior // hide on re-answer of a previously-set stop

  return (
    <div className="space-y-3">
      {showAiHint && ai && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-xs">
          <span className="font-semibold text-blue-500 uppercase tracking-wide">AI suggests</span>{" "}
          <span className="text-foreground">{MERCHANT_CHOICE_LABEL[ai.choice]}</span>
          <span className="text-muted-foreground"> · {(ai.confidence * 100).toFixed(0)}% confidence</span>
          {ai.scheduleCLine && (
            <span className="text-muted-foreground"> · {ai.scheduleCLine}</span>
          )}
          {ai.reasoning && (
            <p className="mt-1 text-muted-foreground italic line-clamp-2" title={ai.reasoning}>
              {ai.reasoning}
            </p>
          )}
        </div>
      )}
      <RadioGroup
        value={choice ?? ""}
        onValueChange={(v) => setChoice(v as MerchantChoice)}
      >
        {(Object.entries(MERCHANT_CHOICE_LABEL) as [MerchantChoice, string][]).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={v} />
            {label}
          </label>
        ))}
      </RadioGroup>
      {choice === "OTHER" && (
        <Textarea
          placeholder="Explain…"
          value={other}
          onChange={(e) => setOther(e.target.value)}
        />
      )}
      <FormLineOverride value={line} onChange={setLine} />
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={applyToSimilar} onCheckedChange={setApplyToSimilar} />
        Apply to similar merchants (updates MerchantRule)
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending || choice === null || (choice === "OTHER" && !other.trim())}
          onClick={() =>
            choice !== null &&
            submit(
              {
                kind: "merchant",
                choice,
                other: other || undefined,
                scheduleCLine: line || undefined,
              },
              applyToSimilar
            )
          }
        >
          {pending ? "Resolving…" : choice === null ? "Pick an option" : "Resolve"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={defer}>
          Defer
        </Button>
      </div>
    </div>
  )
}

function FormLineOverride({
  value,
  onChange,
}: {
  value: string
  onChange: (v: string) => void
}) {
  const { lines, label } = useContext(FormLinesContext)
  // Surface a "(legacy)" tag if the prior answer's line isn't in the entity's
  // current allowlist (e.g. entity flipped from sole prop to S-Corp after
  // the stop was first answered) so the user can see and re-pick.
  const options = value && !lines.includes(value) ? [...lines, value] : lines
  return (
    <div className="space-y-1">
      <Label className="text-xs">Override {label.toLowerCase()} (optional)</Label>
      <select
        className="w-full border rounded p-2 text-sm bg-background"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">(use default for this code)</option>
        {options.map((l) => (
          <option key={l} value={l}>
            {l === value && !lines.includes(l) ? `${l} (legacy)` : l}
          </option>
        ))}
      </select>
    </div>
  )
}

type TransferChoice =
  | "PERSONAL"
  | "CONTRACTOR"
  | "SUPPLIER"
  | "CHARGEBACK"
  | "OWNER_EQUITY"
  | "LOAN"
  | "OTHER"

// Order matters: the radios render in this order, and the most-common
// answers for the cases we see in production (supplier wires, chargebacks,
// owner equity movements) sit near the top.
const TRANSFER_CHOICE_LABEL: Record<TransferChoice, string> = {
  SUPPLIER: "Supplier payment / inventory (WRITE_OFF_COGS)",
  CHARGEBACK: "Bounced check / chargeback — reverses prior income",
  OWNER_EQUITY: "Owner equity — transfer to/from owner's external account",
  CONTRACTOR: "Contractor (business)",
  LOAN: "Loan proceeds / repayment",
  PERSONAL: "Personal (household)",
  OTHER: "Other — explain",
}

function TransferForm({
  stop,
  prior,
}: {
  stop: SerializedStop
  prior: Extract<StopAnswer, { kind: "transfer" }> | null
}) {
  // Initial choice precedence: prior (re-answer) > AI suggestion > unselected.
  // The AI hint is now produced by the centralized deriveAiSuggestion (Wise
  // top-up → LOAN, Pocketsflow → CONTRACTOR, Apple Cash → PERSONAL) plus
  // any persisted Sonnet decision below the auto-resolve threshold. Hint
  // confidence is shown so the user knows when to second-guess the default.
  const aiTransfer = stop.aiSuggestion?.kind === "transfer" ? stop.aiSuggestion : null
  const initialChoice: TransferChoice | null =
    prior?.choice ?? aiTransfer?.choice ?? null
  const [choice, setChoice] = useState<TransferChoice | null>(initialChoice)
  const [payeeName, setPayeeName] = useState(
    prior?.payeeName ?? aiTransfer?.payeeName ?? "",
  )
  const [purpose, setPurpose] = useState(
    prior?.purpose ?? aiTransfer?.purpose ?? "",
  )
  // Pre-fill "Other — explain" textarea from the AI's reasoning when the
  // AI mapped this stop to OTHER (i.e. NEEDS_CONTEXT or unmapped code).
  const aiOtherText = aiTransfer?.choice === "OTHER" ? aiTransfer.reasoning ?? "" : ""
  const [other, setOther] = useState(prior?.other ?? aiOtherText)
  const { pending, error, submit, defer } = useSubmit(stop.id)

  const showAiHint = aiTransfer && !prior

  return (
    <div className="space-y-3">
      {showAiHint && aiTransfer && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-xs">
          <span className="font-semibold text-blue-500 uppercase tracking-wide">AI suggests</span>{" "}
          <span className="text-foreground">{TRANSFER_CHOICE_LABEL[aiTransfer.choice]}</span>
          <span className="text-muted-foreground"> · {(aiTransfer.confidence * 100).toFixed(0)}% confidence</span>
          {aiTransfer.reasoning && (
            <p className="mt-1 text-muted-foreground italic line-clamp-2" title={aiTransfer.reasoning}>
              {aiTransfer.reasoning}
            </p>
          )}
        </div>
      )}
      <RadioGroup
        value={choice ?? ""}
        onValueChange={(v) => setChoice(v as TransferChoice)}
      >
        {(Object.entries(TRANSFER_CHOICE_LABEL) as [TransferChoice, string][]).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={v} />
            {label}
          </label>
        ))}
      </RadioGroup>
      {(choice === "CONTRACTOR" || choice === "SUPPLIER") && (
        <div className="space-y-2">
          <Input placeholder="Payee name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
          <Input
            placeholder={
              choice === "SUPPLIER"
                ? "Purpose (inventory category, PO #, etc.)"
                : "Purpose (services rendered)"
            }
            value={purpose}
            onChange={(e) => setPurpose(e.target.value)}
          />
        </div>
      )}
      {choice === "OTHER" && (
        <Textarea placeholder="Explain…" value={other} onChange={(e) => setOther(e.target.value)} />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending || choice === null}
          onClick={() =>
            choice !== null &&
            submit(
              { kind: "transfer", choice, payeeName, purpose, other: other || undefined },
              false
            )
          }
        >
          {pending ? "Resolving…" : choice === null ? "Pick an option" : "Resolve"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={defer}>
          Defer
        </Button>
      </div>
    </div>
  )
}

type DepositChoice =
  | "CLIENT"
  | "PLATFORM_1099"
  | "W2"
  | "OWNER_CONTRIB"
  | "GIFT"
  | "LOAN"
  | "REFUND"
  | "OTHER"
const DEPOSIT_CHOICE_LABEL: Record<DepositChoice, string> = {
  CLIENT: "Client payment",
  PLATFORM_1099: "1099 platform payout",
  W2: "W-2 paycheck",
  OWNER_CONTRIB: "Owner contribution",
  GIFT: "Gift",
  LOAN: "Loan proceeds",
  REFUND: "Vendor refund",
  OTHER: "Other — explain",
}

function DepositForm({
  stop,
  prior,
}: {
  stop: SerializedStop
  prior: Extract<StopAnswer, { kind: "deposit" }> | null
}) {
  // Initial choice precedence: prior (re-answer) > AI suggestion > unselected.
  // The AI hint is now produced by deriveAiSuggestion — Stripe/eBay/PayPal
  // payouts surface as CLIENT / PLATFORM_1099, refund/reversal patterns
  // surface as REFUND. Without an AI signal we still leave the radio blank
  // so a returned-deposit row can't be one accidental click away from
  // gross receipts.
  const aiDeposit = stop.aiSuggestion?.kind === "deposit" ? stop.aiSuggestion : null
  const initialChoice: DepositChoice | null =
    prior?.choice ?? aiDeposit?.choice ?? null
  const [choice, setChoice] = useState<DepositChoice | null>(initialChoice)
  // Pre-fill "Other — explain" textarea from the AI's reasoning when the
  // AI mapped this stop to OTHER (i.e. NEEDS_CONTEXT or unmapped code).
  const aiOtherText = aiDeposit?.choice === "OTHER" ? aiDeposit.reasoning ?? "" : ""
  const [other, setOther] = useState(prior?.other ?? aiOtherText)
  const { pending, error, submit, defer } = useSubmit(stop.id)

  const showAiHint = aiDeposit && !prior

  return (
    <div className="space-y-3">
      {showAiHint && aiDeposit && (
        <div className="rounded-md border border-blue-500/30 bg-blue-500/5 p-2 text-xs">
          <span className="font-semibold text-blue-500 uppercase tracking-wide">AI suggests</span>{" "}
          <span className="text-foreground">{DEPOSIT_CHOICE_LABEL[aiDeposit.choice]}</span>
          <span className="text-muted-foreground"> · {(aiDeposit.confidence * 100).toFixed(0)}% confidence</span>
          {aiDeposit.reasoning && (
            <p className="mt-1 text-muted-foreground italic line-clamp-2" title={aiDeposit.reasoning}>
              {aiDeposit.reasoning}
            </p>
          )}
        </div>
      )}
      <RadioGroup
        value={choice ?? ""}
        onValueChange={(v) => setChoice(v as DepositChoice)}
      >
        {(Object.entries(DEPOSIT_CHOICE_LABEL) as [DepositChoice, string][]).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={v} />
            {label}
          </label>
        ))}
      </RadioGroup>
      {choice === "OTHER" && (
        <Textarea placeholder="Explain…" value={other} onChange={(e) => setOther(e.target.value)} />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending || choice === null}
          onClick={() =>
            choice !== null &&
            submit({ kind: "deposit", choice, other: other || undefined }, false)
          }
        >
          {pending ? "Resolving…" : choice === null ? "Pick an option" : "Resolve"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={defer}>
          Defer
        </Button>
      </div>
    </div>
  )
}

function Section274dForm({
  stop,
  prior,
}: {
  stop: SerializedStop
  prior: Extract<StopAnswer, { kind: "section_274d" }> | null
}) {
  const [attendees, setAttendees] = useState(prior?.attendees ?? "")
  const [relationship, setRelationship] = useState<
    "CLIENT" | "PROSPECT" | "VENDOR" | "EMPLOYEE" | "OTHER"
  >(prior?.relationship ?? "CLIENT")
  const [purpose, setPurpose] = useState(prior?.purpose ?? "")
  const [outcome, setOutcome] = useState(prior?.outcome ?? "")
  const { pending, error, submit, defer } = useSubmit(stop.id)

  const valid = attendees.trim() && purpose.trim()

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <Label className="text-xs">Attendee(s) — required</Label>
        <Input value={attendees} onChange={(e) => setAttendees(e.target.value)} placeholder="Name(s)" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Business relationship</Label>
        <select
          className="w-full border rounded p-2 text-sm bg-background"
          value={relationship}
          onChange={(e) => setRelationship(e.target.value as typeof relationship)}
        >
          <option value="CLIENT">Client</option>
          <option value="PROSPECT">Prospect</option>
          <option value="VENDOR">Vendor</option>
          <option value="EMPLOYEE">Employee</option>
          <option value="OTHER">Other</option>
        </select>
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Purpose — required</Label>
        <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="Discussed…" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs">Outcome (optional)</Label>
        <Input value={outcome} onChange={(e) => setOutcome(e.target.value)} />
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending || !valid}
          onClick={() =>
            submit(
              { kind: "section_274d", attendees, relationship, purpose, outcome: outcome || undefined },
              false
            )
          }
        >
          {pending ? "Resolving…" : "Resolve"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={defer}>
          Defer
        </Button>
      </div>
    </div>
  )
}

function PeriodGapForm({ stop }: { stop: SerializedStop }) {
  const { pending, error, defer } = useSubmit(stop.id)
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Period gaps must be resolved by uploading the missing statement on the Upload page.
      </p>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button variant="outline" disabled={pending} onClick={defer}>
        {pending ? "Deferring…" : "Defer"}
      </Button>
    </div>
  )
}
