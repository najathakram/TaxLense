"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { fmtUSD } from "@/lib/format/currency"
import {
  humanizeProposedAction,
  deriveAlternatives,
  type ProposedAction,
} from "@/lib/findings/humanize"
import {
  acceptFindingAction,
  acceptFindingWithOverrideAction,
  acceptFindingWithInstructionAction,
  dismissFindingAction,
  acceptAllAutoFixableAction,
  applyFindingsAction,
} from "./actions"

const severityColor: Record<string, string> = {
  CRITICAL: "bg-red-500 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-yellow-500 text-black",
  LOW: "bg-blue-500 text-white",
  COSMETIC: "bg-gray-500 text-white",
}

const kindBadge: Record<ProposedAction["kind"], { label: string; className: string }> = {
  RECLASSIFY: { label: "Reclassify", className: "bg-blue-500/20 text-blue-200" },
  STOP: { label: "Create STOP", className: "bg-amber-500/20 text-amber-200" },
  BLOCK: { label: "Block lock", className: "bg-red-500/20 text-red-200" },
  NOTE: { label: "Workpaper note", className: "bg-gray-500/20 text-gray-200" },
}

interface ProposedFinding {
  id: string
  severity: string
  category: string
  title: string
  rationale: string
  autoFixable: boolean
  proposedAction: ProposedAction
  citedTxns: Array<{ id: string; merchant: string; date: string; amount: number }>
}

export function FindingsClient({
  year,
  proposed,
  accepted,
  applied,
  autoFixableCount,
}: {
  year: number
  proposed: ProposedFinding[]
  accepted: number
  applied: number
  autoFixableCount: number
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [dismissingId, setDismissingId] = useState<string | null>(null)
  const [dismissRationale, setDismissRationale] = useState("")
  const [otherDialogFor, setOtherDialogFor] = useState<ProposedFinding | null>(null)
  const [otherInstruction, setOtherInstruction] = useState("")
  const [feedback, setFeedback] = useState<string | null>(null)

  function handleAccept(id: string) {
    startTransition(async () => {
      await acceptFindingAction(year, id)
      router.refresh()
    })
  }

  function handleAcceptAlternative(
    id: string,
    override: ProposedAction,
    label: string
  ) {
    startTransition(async () => {
      await acceptFindingWithOverrideAction(year, id, override, label)
      setFeedback(`Accepted with override: ${label}`)
      router.refresh()
    })
  }

  function handleOtherSubmit() {
    if (!otherDialogFor) return
    const trimmed = otherInstruction.trim()
    if (trimmed.length < 5) {
      setFeedback("Custom instruction must be at least 5 characters.")
      return
    }
    const finding = otherDialogFor
    startTransition(async () => {
      await acceptFindingWithInstructionAction(
        year,
        finding.id,
        trimmed,
        finding.citedTxns.map((t) => t.id)
      )
      setFeedback(`Saved CPA instruction — will surface as a STOP on apply.`)
      setOtherDialogFor(null)
      setOtherInstruction("")
      router.refresh()
    })
  }

  function handleDismiss(id: string) {
    if (!dismissRationale.trim() || dismissRationale.trim().length < 5) {
      setFeedback("Dismiss rationale required (min 5 chars)")
      return
    }
    startTransition(async () => {
      await dismissFindingAction(year, id, dismissRationale)
      setDismissingId(null)
      setDismissRationale("")
      router.refresh()
    })
  }

  function handleAcceptAllAuto() {
    startTransition(async () => {
      const r = await acceptAllAutoFixableAction(year)
      setFeedback(`${r.accepted} auto-fixable findings accepted.`)
      router.refresh()
    })
  }

  function handleApplyAll() {
    startTransition(async () => {
      const r = await applyFindingsAction(year)
      setFeedback(
        `Applied ${r.applied} findings; ${r.superseded} superseded; ${r.rejected} rejected (§274(d) hard rail); ${r.errors.length} errors.`
      )
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      {feedback && (
        <Card className="bg-blue-500/10 border-blue-500">
          <CardContent className="py-3 text-sm">{feedback}</CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Batch actions</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2 flex-wrap">
          <Button
            onClick={handleAcceptAllAuto}
            disabled={isPending || autoFixableCount === 0}
          >
            Accept all auto-fixable ({autoFixableCount})
          </Button>
          <Button onClick={handleApplyAll} disabled={isPending || accepted === 0}>
            Apply {accepted} accepted finding{accepted === 1 ? "" : "s"}
          </Button>
          <div className="text-sm text-muted-foreground self-center">
            {applied} already applied
          </div>
        </CardContent>
      </Card>

      {proposed.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center text-muted-foreground">
            No pending findings. Run CPA_AUDIT or COHAN_SWEEP from the pipeline page to generate findings.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {proposed.map((f) => {
            const aggregateAmount = f.citedTxns.reduce(
              (s, t) => s + Math.abs(t.amount),
              0
            )
            const humanized = humanizeProposedAction(f.proposedAction, {
              txnCount: f.citedTxns.length,
              aggregateAmount,
            })
            const alternatives = deriveAlternatives(f.category, f.proposedAction)
            const badge = kindBadge[humanized.kind]
            return (
              <Card
                key={f.id}
                className="border-l-4"
                style={{ borderLeftColor: severityToHex(f.severity) }}
              >
                <CardHeader>
                  <div className="flex items-start justify-between gap-4">
                    <div className="space-y-1 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge className={severityColor[f.severity] ?? ""}>
                          {f.severity}
                        </Badge>
                        <Badge variant="outline">{f.category}</Badge>
                        <Badge className={badge.className}>{badge.label}</Badge>
                        {f.autoFixable && (
                          <Badge className="bg-green-500/20 text-green-200">
                            auto-fixable
                          </Badge>
                        )}
                      </div>
                      <CardTitle className="text-lg">{f.title}</CardTitle>
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <Button
                        size="sm"
                        onClick={() => handleAccept(f.id)}
                        disabled={isPending}
                      >
                        Accept
                      </Button>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                          >
                            More ▾
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-80">
                          <DropdownMenuLabel>Alternatives</DropdownMenuLabel>
                          {alternatives.length === 0 ? (
                            <DropdownMenuItem disabled>
                              <span className="text-xs text-muted-foreground">
                                No case-specific alternatives for this category.
                              </span>
                            </DropdownMenuItem>
                          ) : (
                            alternatives.map((alt) => (
                              <DropdownMenuItem
                                key={alt.label}
                                onSelect={() =>
                                  handleAcceptAlternative(
                                    f.id,
                                    alt.override,
                                    alt.label
                                  )
                                }
                                className="flex-col items-start gap-0.5"
                              >
                                <span className="font-medium">{alt.label}</span>
                                <span className="text-xs text-muted-foreground whitespace-normal">
                                  {alt.hint}
                                </span>
                              </DropdownMenuItem>
                            ))
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => {
                              setOtherDialogFor(f)
                              setOtherInstruction("")
                            }}
                            className="flex-col items-start gap-0.5"
                          >
                            <span className="font-medium">
                              Other… (write a custom instruction)
                            </span>
                            <span className="text-xs text-muted-foreground whitespace-normal">
                              Saves your text on the finding and surfaces it as
                              a STOP for the taxpayer / future review.
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onSelect={() => {
                              setDismissingId(f.id)
                              setDismissRationale("")
                            }}
                            className="text-destructive"
                          >
                            Dismiss…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm whitespace-pre-wrap">{f.rationale}</p>

                  {/* HUMAN-READABLE PROPOSED ACTION ---------------------------- */}
                  <div className="rounded border border-border bg-muted/40 p-3 space-y-1">
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      What "Accept" will do
                    </div>
                    <div className="text-sm font-medium">{humanized.summary}</div>
                    {humanized.bullets.length > 0 && (
                      <ul className="text-xs text-muted-foreground list-disc pl-5 space-y-0.5">
                        {humanized.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </div>

                  {/* RAW JSON (collapsed by default — kept for power users) ---- */}
                  <details>
                    <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                      Show raw proposedAction JSON
                    </summary>
                    <pre className="text-xs bg-muted p-3 rounded mt-2 overflow-x-auto">
                      {JSON.stringify(f.proposedAction, null, 2)}
                    </pre>
                  </details>

                  {f.citedTxns.length > 0 && (
                    <details>
                      <summary className="cursor-pointer text-sm font-medium">
                        Cited transactions ({f.citedTxns.length})
                      </summary>
                      <div className="mt-2 space-y-1 text-xs">
                        {f.citedTxns.slice(0, 20).map((t) => (
                          <div key={t.id} className="flex gap-3">
                            <span className="font-mono opacity-50">
                              {t.id.slice(0, 12)}
                            </span>
                            <span>{t.date}</span>
                            <span className="flex-1 truncate">{t.merchant}</span>
                            <span>{fmtUSD(t.amount, { cents: true })}</span>
                          </div>
                        ))}
                        {f.citedTxns.length > 20 && (
                          <div className="text-muted-foreground">
                            +{f.citedTxns.length - 20} more
                          </div>
                        )}
                      </div>
                    </details>
                  )}

                  {dismissingId === f.id && (
                    <div className="space-y-2 mt-3 p-3 bg-muted rounded">
                      <Textarea
                        placeholder="Rationale (min 5 chars) — why is this finding wrong or out-of-scope?"
                        value={dismissRationale}
                        onChange={(e) => setDismissRationale(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => handleDismiss(f.id)}
                          disabled={isPending}
                        >
                          Confirm dismiss
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setDismissingId(null)
                            setDismissRationale("")
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}

      {/* "Other…" custom-instruction dialog ----------------------------------- */}
      <Dialog
        open={otherDialogFor !== null}
        onOpenChange={(open) => {
          if (!open) {
            setOtherDialogFor(null)
            setOtherInstruction("")
          }
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Custom instruction</DialogTitle>
            <DialogDescription>
              Write what you actually want done with this finding. The
              instruction is stored verbatim and surfaces as a STOP carrying
              your text — no AI fabrication of a tax position.
            </DialogDescription>
          </DialogHeader>
          {otherDialogFor && (
            <div className="space-y-2">
              <div className="text-xs text-muted-foreground">
                Finding: <span className="font-medium">{otherDialogFor.title}</span>
              </div>
              <Textarea
                placeholder="e.g. 'These three Wise rows are inventory pre-payments for the November shipment — leave them in COGS but tag them with a substantiation note.'"
                value={otherInstruction}
                onChange={(e) => setOtherInstruction(e.target.value)}
                rows={6}
              />
              <div className="text-xs text-muted-foreground">
                Minimum 5 characters. Up to 500 characters are stored on the
                finding for the audit trail.
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => {
                setOtherDialogFor(null)
                setOtherInstruction("")
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleOtherSubmit}
              disabled={isPending || otherInstruction.trim().length < 5}
            >
              Save & accept
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function severityToHex(severity: string): string {
  switch (severity) {
    case "CRITICAL": return "#ef4444"
    case "HIGH":     return "#f97316"
    case "MEDIUM":   return "#eab308"
    case "LOW":      return "#3b82f6"
    case "COSMETIC": return "#6b7280"
    default:         return "#9ca3af"
  }
}
