"use client"

/**
 * Risk-signal acknowledgement button (B-23 UI).
 *
 * Only renders for signals listed in OVERRIDABLE_SIGNALS — currently just
 * INCOME_SHORT. Click opens a textarea dialog; submitting writes to
 * TaxYear.acceptedRiskOverrides via confirmRiskOverride. Already-acked
 * signals show "Acknowledged" + an Undo link that calls clearRiskOverride.
 *
 * Why this is a separate component: the Risk page is fully server-rendered
 * and can't host a useState dialog inline.
 */

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { confirmRiskOverride, clearRiskOverride } from "../lock/actions"

export const OVERRIDABLE_SIGNALS: ReadonlySet<string> = new Set([
  "INCOME_SHORT",
])

export function RiskOverrideButton({
  year,
  signalId,
  acked,
  ackedRationale,
}: {
  year: number
  signalId: string
  acked: boolean
  ackedRationale?: string | null
}) {
  const [open, setOpen] = useState(false)
  const [rationale, setRationale] = useState("")
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (acked) {
    return (
      <div className="flex items-center gap-2 text-xs">
        <Badge variant="secondary">Acknowledged</Badge>
        {ackedRationale && (
          <span className="text-muted-foreground italic max-w-xs truncate" title={ackedRationale}>
            "{ackedRationale}"
          </span>
        )}
        <button
          className="text-blue-600 underline"
          disabled={pending}
          onClick={() => {
            startTransition(async () => {
              try {
                await clearRiskOverride(year, signalId)
              } catch (e) {
                setError(e instanceof Error ? e.message : String(e))
              }
            })
          }}
        >
          {pending ? "…" : "Undo"}
        </button>
        {error && <span className="text-red-500">{error}</span>}
      </div>
    )
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        Confirm variance →
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Acknowledge {signalId}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Confirming this signal will mute it from the risk dashboard and unblock the lock if
              it was the only blocker. The acknowledgement and your rationale are written to the
              audit log.
            </p>
            <Textarea
              placeholder="Why is this variance expected? (e.g. 'Q4 1099-K from Pocketsflow lands Jan 2026 — variance is timing only')"
              value={rationale}
              onChange={(e) => setRationale(e.target.value)}
              minLength={10}
              rows={4}
            />
            {error && <p className="text-xs text-red-500">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
              Cancel
            </Button>
            <Button
              disabled={pending || rationale.trim().length < 10}
              onClick={() => {
                setError(null)
                startTransition(async () => {
                  try {
                    await confirmRiskOverride(year, signalId, rationale.trim())
                    setOpen(false)
                    setRationale("")
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                  }
                })
              }}
            >
              {pending ? "Saving…" : "Confirm"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
