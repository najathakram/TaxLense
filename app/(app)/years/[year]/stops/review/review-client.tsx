"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { fmtUSD } from "@/lib/format/currency"
import { approveProposals, overrideAutoApproved } from "./actions"
import type { StopAnswer } from "@/lib/stops/derive"

export interface SerializedAffected {
  id: string
  postedDate: string
  accountNickname: string | null
  merchantRaw: string
  amount: number
}

export interface SerializedProposal {
  id: string
  category: string
  state: string
  question: string
  merchantKey: string
  totalAmount: number
  affected: SerializedAffected[]
  proposal: {
    answer: StopAnswer | null
    code: string
    businessPct: number
    scheduleCLine: string | null
    confidence: number
    reasoning: string
    ircCitations: string[]
    priorCases: Array<{
      stopId: string
      merchantSnippet: string
      resolvedAs: { code: string; businessPct: number; scheduleCLine: string | null }
      resolvedAt: string
      similarity: number
      year: number
    }>
    generatedAt: string | null
    autoApplied: boolean
    citedPriorCaseId: string | null
  }
}

// Confidence-band styling — green ≥0.85, amber 0.55-0.84, red <0.55.
function confidenceColor(c: number): string {
  if (c >= 0.85) return "text-green-600"
  if (c >= 0.55) return "text-amber-500"
  return "text-red-500"
}
function confidenceBg(c: number): string {
  if (c >= 0.85) return "bg-green-500/10 border-green-500/30"
  if (c >= 0.55) return "bg-amber-500/10 border-amber-500/30"
  return "bg-red-500/10 border-red-500/30"
}

export function ReviewClient({
  year,
  pending,
  autoApproved,
}: {
  year: number
  pending: SerializedProposal[]
  autoApproved: SerializedProposal[]
}) {
  const router = useRouter()
  const [pendingTx, startTransition] = useTransition()
  // Default-checked: every pending proposal is selected for one-click "Approve all".
  const [selected, setSelected] = useState<Set<string>>(new Set(pending.map((p) => p.id)))
  const [showAutoApproved, setShowAutoApproved] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)

  const allSelected = selected.size === pending.length && pending.length > 0
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(pending.map((p) => p.id)))
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onApproveSelected() {
    if (selected.size === 0) return
    startTransition(async () => {
      const res = await approveProposals(year, [...selected])
      const head = `${res.approved} approved · ${res.errors} error${res.errors === 1 ? "" : "s"}`
      setFeedback(head)
      router.refresh()
    })
  }

  function onOverride(stopId: string, newAnswer: StopAnswer) {
    startTransition(async () => {
      await overrideAutoApproved(year, stopId, newAnswer)
      setFeedback(`Overridden — re-classified.`)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6 pb-24">
      {feedback && (
        <div className="rounded border border-green-500/30 bg-green-500/10 px-4 py-2 text-sm text-green-600">
          {feedback}
        </div>
      )}

      {/* Pending review section */}
      <section className="space-y-3">
        <div className="flex items-baseline justify-between flex-wrap gap-2">
          <h2 className="text-lg font-semibold">
            Pending your review · {pending.length}
          </h2>
          {pending.length > 0 && (
            <button
              type="button"
              onClick={toggleAll}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              {allSelected ? "Deselect all" : "Select all"}
            </button>
          )}
        </div>

        {pending.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">
            Every proposal was auto-approved at high confidence. Scroll to the section below to review or override them.
          </p>
        ) : (
          pending.map((p) => (
            <PendingCard
              key={p.id}
              proposal={p}
              checked={selected.has(p.id)}
              onToggle={() => toggleOne(p.id)}
            />
          ))
        )}
      </section>

      {/* Auto-approved section */}
      {autoApproved.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-baseline justify-between flex-wrap gap-2">
            <h2 className="text-lg font-semibold">
              Auto-approved · {autoApproved.length} <span className="text-xs text-muted-foreground font-normal">(≥85% confidence)</span>
            </h2>
            <button
              type="button"
              onClick={() => setShowAutoApproved((v) => !v)}
              className="text-xs text-muted-foreground hover:text-foreground underline"
            >
              {showAutoApproved ? "Hide" : "Show & override"}
            </button>
          </div>
          {showAutoApproved && (
            <div className="space-y-2">
              {autoApproved.map((p) => (
                <AutoApprovedCard
                  key={p.id}
                  proposal={p}
                  onOverride={(answer) => onOverride(p.id, answer)}
                  disabled={pendingTx}
                />
              ))}
            </div>
          )}
        </section>
      )}

      {/* Sticky footer — only when there's something to approve */}
      {pending.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background/95 backdrop-blur px-6 py-3 flex items-center justify-between gap-4">
          <span className="text-sm text-muted-foreground">
            {selected.size} of {pending.length} selected
          </span>
          <Button
            size="lg"
            disabled={pendingTx || selected.size === 0}
            onClick={onApproveSelected}
          >
            {pendingTx
              ? "Applying…"
              : `✓ Approve ${selected.size} proposal${selected.size === 1 ? "" : "s"}`}
          </Button>
        </div>
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// PendingCard — one row per stop awaiting CPA review.
// ────────────────────────────────────────────────────────────────────────

function PendingCard({
  proposal,
  checked,
  onToggle,
}: {
  proposal: SerializedProposal
  checked: boolean
  onToggle: () => void
}) {
  const p = proposal.proposal
  const cBand = confidenceBg(p.confidence)
  const cColor = confidenceColor(p.confidence)
  const aff = proposal.affected[0]

  return (
    <div className={`rounded-lg border p-4 ${checked ? "border-blue-500/40 bg-blue-500/5" : ""}`}>
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={checked}
          onChange={onToggle}
          className="mt-1 h-4 w-4"
        />
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-sm truncate max-w-md">{proposal.merchantKey}</span>
            <Badge variant="outline" className="text-xs">{proposal.category}</Badge>
            <span className="text-xs text-muted-foreground">{aff?.postedDate ?? ""}</span>
            <span className="text-xs text-muted-foreground">{aff?.accountNickname ?? ""}</span>
            <span className="ml-auto font-mono text-sm">{fmtUSD(proposal.totalAmount, { cents: true })}</span>
          </div>

          <div className={`rounded border px-3 py-2 text-sm ${cBand}`}>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-semibold ${cColor}`}>AI proposes:</span>
              <span className="font-mono">{p.code}</span>
              {p.scheduleCLine && (
                <span className="text-xs text-muted-foreground">→ {p.scheduleCLine}</span>
              )}
              {p.businessPct > 0 && p.businessPct < 100 && (
                <span className="text-xs text-muted-foreground">@ {p.businessPct}%</span>
              )}
              <span className={`ml-auto text-xs font-mono ${cColor}`}>
                {Math.round(p.confidence * 100)}% confidence
              </span>
            </div>
            {p.reasoning && (
              <p className="text-xs text-muted-foreground mt-1.5">{p.reasoning}</p>
            )}
            {p.priorCases.length > 0 && (
              <div className="text-xs text-muted-foreground mt-2 space-y-0.5">
                <div className="font-medium text-foreground/80">
                  Anchored on {p.priorCases.length} prior case{p.priorCases.length === 1 ? "" : "s"}:
                </div>
                {p.priorCases.slice(0, 3).map((pc) => (
                  <div key={pc.stopId} className="pl-3">
                    · <span className="font-mono">{pc.merchantSnippet.slice(0, 32)}</span> → {pc.resolvedAs.code} <span className="text-foreground/40">({Math.round(pc.similarity * 100)}% match · {pc.year})</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Per-row override is intentionally NOT in V1 — keeps the review
              screen scannable. Power users can still navigate to /stops and
              edit the radio choice manually. We can add inline edit in
              Phase 4 once the basic flow is in place. */}
        </div>
      </div>
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// AutoApprovedCard — stops that already auto-applied, with "Override" CTA.
// ────────────────────────────────────────────────────────────────────────

function AutoApprovedCard({
  proposal,
  onOverride,
  disabled,
}: {
  proposal: SerializedProposal
  onOverride: (newAnswer: StopAnswer) => void
  disabled: boolean
}) {
  const [showOverride, setShowOverride] = useState(false)
  const p = proposal.proposal
  const aff = proposal.affected[0]

  return (
    <div className="rounded border bg-muted/10 px-3 py-2 text-sm">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-green-600 text-xs">✓</span>
        <span className="font-mono text-xs truncate max-w-md">{proposal.merchantKey}</span>
        <Badge variant="outline" className="text-xs">{proposal.category}</Badge>
        <span className="text-xs text-muted-foreground">{aff?.postedDate ?? ""}</span>
        <span className="ml-auto font-mono text-xs">{fmtUSD(proposal.totalAmount, { cents: true })}</span>
        <span className="font-mono text-xs">{p.code}</span>
        <span className="text-xs text-green-600">{Math.round(p.confidence * 100)}%</span>
        <button
          type="button"
          onClick={() => setShowOverride((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground underline"
          disabled={disabled}
        >
          {showOverride ? "Cancel" : "Override"}
        </button>
      </div>
      {showOverride && (
        <OverrideForm
          category={proposal.category}
          onSubmit={(newAnswer) => {
            setShowOverride(false)
            onOverride(newAnswer)
          }}
          disabled={disabled}
        />
      )}
    </div>
  )
}

// ────────────────────────────────────────────────────────────────────────
// OverrideForm — minimal radio-group per category.
// ────────────────────────────────────────────────────────────────────────

function OverrideForm({
  category,
  onSubmit,
  disabled,
}: {
  category: string
  onSubmit: (newAnswer: StopAnswer) => void
  disabled: boolean
}) {
  const [choice, setChoice] = useState<string>("")
  const opts = optionsFor(category)

  return (
    <div className="mt-2 pl-6 space-y-2">
      <div className="space-y-1">
        {opts.map((o) => (
          <label key={o.value} className="flex items-center gap-2 text-xs">
            <input
              type="radio"
              name={`override-${Math.random()}`}
              value={o.value}
              checked={choice === o.value}
              onChange={() => setChoice(o.value)}
              className="h-3 w-3"
            />
            {o.label}
          </label>
        ))}
      </div>
      <Button
        size="sm"
        disabled={disabled || !choice}
        onClick={() => {
          const ans = buildAnswer(category, choice)
          if (ans) onSubmit(ans)
        }}
      >
        Apply override
      </Button>
    </div>
  )
}

function optionsFor(category: string): Array<{ value: string; label: string }> {
  switch (category) {
    case "MERCHANT":
      return [
        { value: "ALL_BUSINESS", label: "All business" },
        { value: "DURING_TRIPS", label: "Only during trips" },
        { value: "MIXED_50", label: "Mixed (50% business)" },
        { value: "PERSONAL", label: "Personal" },
      ]
    case "TRANSFER":
      return [
        { value: "PERSONAL", label: "Personal transfer" },
        { value: "CONTRACTOR", label: "Contractor payment" },
        { value: "LOAN", label: "Loan / wallet move" },
      ]
    case "DEPOSIT":
      return [
        { value: "CLIENT", label: "Client payment" },
        { value: "PLATFORM_1099", label: "1099 platform payout" },
        { value: "OWNER_CONTRIB", label: "Owner contribution" },
        { value: "GIFT", label: "Gift" },
        { value: "LOAN", label: "Loan proceeds" },
        { value: "REFUND", label: "Vendor refund" },
      ]
    default:
      return []
  }
}

function buildAnswer(category: string, choice: string): StopAnswer | null {
  if (category === "MERCHANT") {
    if (["ALL_BUSINESS", "DURING_TRIPS", "MIXED_50", "PERSONAL"].includes(choice)) {
      return { kind: "merchant", choice: choice as "ALL_BUSINESS" | "DURING_TRIPS" | "MIXED_50" | "PERSONAL" }
    }
  }
  if (category === "TRANSFER") {
    // Extended 2026-05-22 with SUPPLIER / CHARGEBACK / OWNER_EQUITY so the
    // review screen can surface the same options as the resolve form.
    if (
      ["PERSONAL", "CONTRACTOR", "SUPPLIER", "CHARGEBACK", "OWNER_EQUITY", "LOAN"].includes(choice)
    ) {
      return {
        kind: "transfer",
        choice: choice as
          | "PERSONAL"
          | "CONTRACTOR"
          | "SUPPLIER"
          | "CHARGEBACK"
          | "OWNER_EQUITY"
          | "LOAN",
      }
    }
  }
  if (category === "DEPOSIT") {
    if (["CLIENT", "PLATFORM_1099", "OWNER_CONTRIB", "GIFT", "LOAN", "REFUND"].includes(choice)) {
      return { kind: "deposit", choice: choice as "CLIENT" | "PLATFORM_1099" | "OWNER_CONTRIB" | "GIFT" | "LOAN" | "REFUND" }
    }
  }
  return null
}
