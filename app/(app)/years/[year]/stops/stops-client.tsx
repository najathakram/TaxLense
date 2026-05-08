"use client"

import { useEffect, useRef, useState, useTransition } from "react"
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
import { SCHEDULE_C_LINES } from "@/lib/classification/constants"
import { resolveStop, deferStop, type StopAnswer } from "./actions"
import { runAutoResolveStops, getPipelineRunStatus } from "@/app/(app)/years/[year]/pipeline/actions"
import { FloatingProgress } from "@/components/pipeline/floating-progress"

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
}

const CATEGORIES: { key: StopCategory; label: string }[] = [
  { key: "MERCHANT", label: "Merchant" },
  { key: "TRANSFER", label: "Transfer" },
  { key: "DEPOSIT", label: "Deposit" },
  { key: "SECTION_274D", label: "§274(d)" },
  { key: "PERIOD_GAP", label: "Period Gap" },
]

const POLL_MS = 2_000

export function StopsClient({ year, stops }: { year: number; stops: SerializedStop[] }) {
  const [activeRun, setActiveRun] = useState<{ runId: string; label: string } | null>(null)
  const [progress, setProgress] = useState<Record<string, unknown>>({})
  const [lastError, setLastError] = useState<string | null>(null)
  const [lastResult, setLastResult] = useState<{ resolved: number; skipped: number; errors: number } | null>(null)
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
        const r = (status.result as { resolved?: number; skipped?: number; errors?: number } | null) ?? null
        if (r) setLastResult({ resolved: r.resolved ?? 0, skipped: r.skipped ?? 0, errors: r.errors ?? 0 })
        setActiveRun(null)
        setTimeout(() => window.location.reload(), 250)
      } else if (status.status === "FAILED") {
        setLastError(status.lastError ?? "Auto-resolve failed.")
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
      const handle = await runAutoResolveStops(year)
      setActiveRun({ runId: handle.runId, label: "Auto-resolving STOPs" })
    } catch (e) {
      setLastError(e instanceof Error ? e.message : String(e))
    }
  }

  const byCat = new Map<StopCategory, SerializedStop[]>()
  for (const c of CATEGORIES) byCat.set(c.key, [])
  for (const s of stops) byCat.get(s.category)?.push(s)
  for (const [, arr] of byCat) arr.sort((a, b) => b.totalAmount - a.totalAmount)

  const pendingCount = (cat: StopCategory) =>
    byCat.get(cat)?.filter((s) => s.state === "PENDING").length ?? 0

  const totalPending = CATEGORIES.reduce((n, c) => n + pendingCount(c.key), 0)

  const autoBusy = activeRun !== null

  return (
    <div className="space-y-4">
      {/* Floating progress panel — shows live "X of N · resolved · skipped" while
          a run is in flight, then a green ✓ summary when it completes. */}
      <FloatingProgress
        active={activeRun}
        progress={progress as { phase?: string; processed?: number; total?: number; label?: string }}
        errorMessage={lastError}
        recentResults={lastResult ? [{
          ok: lastResult.errors === 0,
          label: "Auto-resolve",
          detail: `${lastResult.resolved} resolved · ${lastResult.skipped} skipped · ${lastResult.errors} errors`,
        }] : []}
      />

      {/* Auto-resolve banner */}
      <div className="flex items-center justify-between gap-4 border rounded p-3 bg-muted/30">
        <div className="text-sm">
          <span className="font-medium">{totalPending} pending stops</span>
          <span className="text-muted-foreground ml-2">— AI (Sonnet) will auto-resolve high-confidence items (≥85%)</span>
        </div>
        <Button size="sm" disabled={autoBusy || totalPending === 0} onClick={onAutoResolve}>
          {autoBusy ? "Resolving…" : "Auto-resolve with AI"}
        </Button>
      </div>
    <Tabs defaultValue="MERCHANT" className="w-full">
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
  )
}

function StopCard({ stop }: { stop: SerializedStop }) {
  const [open, setOpen] = useState(stop.state === "PENDING")
  const disabled = stop.state !== "PENDING"

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
              · ${stop.totalAmount.toFixed(2)} · {stop.affected.length} txn
              {stop.affected.length !== 1 ? "s" : ""}
            </span>
          </CardTitle>
          <Badge variant={stop.state === "PENDING" ? "default" : "secondary"}>{stop.state}</Badge>
        </div>
      </CardHeader>
      {open && (
        <CardContent className="space-y-4">
          <p className="text-sm">{stop.question}</p>
          <AffectedTable rows={stop.affected} />
          {!disabled && <AnswerForm stop={stop} />}
        </CardContent>
      )}
    </Card>
  )
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
              <td className="p-2 text-right">${r.amount.toFixed(2)}</td>
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

function AnswerForm({ stop }: { stop: SerializedStop }) {
  switch (stop.category) {
    case "MERCHANT":
      return <MerchantForm stop={stop} />
    case "TRANSFER":
      return <TransferForm stop={stop} />
    case "DEPOSIT":
      return <DepositForm stop={stop} />
    case "SECTION_274D":
      return <Section274dForm stop={stop} />
    case "PERIOD_GAP":
      return <PeriodGapForm stop={stop} />
  }
}

function useSubmit(stopId: string) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const submit = (answer: StopAnswer, applyToSimilar: boolean) => {
    setError(null)
    start(async () => {
      try {
        await resolveStop(stopId, answer, applyToSimilar)
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
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      }
    })
  }
  return { pending, error, submit, defer }
}

function MerchantForm({ stop }: { stop: SerializedStop }) {
  const [choice, setChoice] = useState<"ALL_BUSINESS" | "DURING_TRIPS" | "MIXED_50" | "PERSONAL" | "OTHER">("ALL_BUSINESS")
  const [other, setOther] = useState("")
  const [line, setLine] = useState<string>("")
  const [applyToSimilar, setApplyToSimilar] = useState(true)
  const { pending, error, submit, defer } = useSubmit(stop.id)

  return (
    <div className="space-y-3">
      <RadioGroup value={choice} onValueChange={(v) => setChoice(v as typeof choice)}>
        {[
          ["ALL_BUSINESS", "All business 100%"],
          ["DURING_TRIPS", "Business during confirmed trips only"],
          ["MIXED_50", "Mixed 50/50"],
          ["PERSONAL", "Personal"],
          ["OTHER", "Other — explain"],
        ].map(([v, label]) => (
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
      <div className="space-y-1">
        <Label className="text-xs">Override Schedule C line (optional)</Label>
        <select
          className="w-full border rounded p-2 text-sm bg-background"
          value={line}
          onChange={(e) => setLine(e.target.value)}
        >
          <option value="">(use default for this code)</option>
          {SCHEDULE_C_LINES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <Switch checked={applyToSimilar} onCheckedChange={setApplyToSimilar} />
        Apply to similar merchants (updates MerchantRule)
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending || (choice === "OTHER" && !other.trim())}
          onClick={() =>
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
          {pending ? "Resolving…" : "Resolve"}
        </Button>
        <Button variant="outline" disabled={pending} onClick={defer}>
          Defer
        </Button>
      </div>
    </div>
  )
}

function TransferForm({ stop }: { stop: SerializedStop }) {
  const [choice, setChoice] = useState<"PERSONAL" | "CONTRACTOR" | "LOAN" | "OTHER">("PERSONAL")
  const [payeeName, setPayeeName] = useState("")
  const [purpose, setPurpose] = useState("")
  const [other, setOther] = useState("")
  const { pending, error, submit, defer } = useSubmit(stop.id)

  return (
    <div className="space-y-3">
      <RadioGroup value={choice} onValueChange={(v) => setChoice(v as typeof choice)}>
        {[
          ["PERSONAL", "Personal (household)"],
          ["CONTRACTOR", "Contractor (business)"],
          ["LOAN", "Loan proceeds / repayment"],
          ["OTHER", "Other — explain"],
        ].map(([v, label]) => (
          <label key={v} className="flex items-center gap-2 text-sm">
            <RadioGroupItem value={v} />
            {label}
          </label>
        ))}
      </RadioGroup>
      {choice === "CONTRACTOR" && (
        <div className="space-y-2">
          <Input placeholder="Payee name" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} />
          <Input placeholder="Purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} />
        </div>
      )}
      {choice === "OTHER" && (
        <Textarea placeholder="Explain…" value={other} onChange={(e) => setOther(e.target.value)} />
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="flex gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            submit(
              { kind: "transfer", choice, payeeName, purpose, other: other || undefined },
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

function DepositForm({ stop }: { stop: SerializedStop }) {
  const [choice, setChoice] = useState<
    "CLIENT" | "PLATFORM_1099" | "W2" | "OWNER_CONTRIB" | "GIFT" | "LOAN" | "REFUND" | "OTHER"
  >("CLIENT")
  const [other, setOther] = useState("")
  const { pending, error, submit, defer } = useSubmit(stop.id)

  return (
    <div className="space-y-3">
      <RadioGroup value={choice} onValueChange={(v) => setChoice(v as typeof choice)}>
        {[
          ["CLIENT", "Client payment"],
          ["PLATFORM_1099", "1099 platform payout"],
          ["W2", "W-2 paycheck"],
          ["OWNER_CONTRIB", "Owner contribution"],
          ["GIFT", "Gift"],
          ["LOAN", "Loan proceeds"],
          ["REFUND", "Vendor refund"],
          ["OTHER", "Other — explain"],
        ].map(([v, label]) => (
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
          disabled={pending}
          onClick={() => submit({ kind: "deposit", choice, other: other || undefined }, false)}
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

function Section274dForm({ stop }: { stop: SerializedStop }) {
  const [attendees, setAttendees] = useState("")
  const [relationship, setRelationship] = useState<
    "CLIENT" | "PROSPECT" | "VENDOR" | "EMPLOYEE" | "OTHER"
  >("CLIENT")
  const [purpose, setPurpose] = useState("")
  const [outcome, setOutcome] = useState("")
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
