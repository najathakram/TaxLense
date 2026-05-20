"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { confirmLock, unlockTaxYear } from "./actions"

/**
 * Lock + unlock client. Shared by /years/[year]/lock and the lock section of
 * /years/[year]/finalize.
 *
 * RELOCK_VERIFY drift handling: when a prior locked snapshot exists and the
 * proposed snapshot has drift over threshold, confirmLock throws
 * DriftApprovalRequiredError. The client catches that, surfaces a textarea so
 * the user can type a rationale, and re-submits with `driftAck` populated. The
 * rationale lands on the new TAXYEAR_LOCKED.afterState.driftAck and on a paired
 * RELOCK_DRIFT_APPROVED AuditEvent.
 *
 * Why this lives client-side: server actions can't open a dialog mid-call.
 * The two-step confirm (`I understand` → `Confirm lock`) was already a
 * client-state machine; this adds a third optional state when drift is caught.
 */

const isDriftApprovalError = (e: unknown): boolean => {
  if (!e) return false
  const msg = e instanceof Error ? e.message : String(e)
  const name = e instanceof Error ? e.name : ""
  return name === "DriftApprovalRequiredError" || /drift.*approval required/i.test(msg)
}

export function LockClient({ mode, year }: { mode: "lock" | "unlock"; year: number }) {
  const [pending, startTransition] = useTransition()
  const [rationale, setRationale] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const [needsDriftAck, setNeedsDriftAck] = useState(false)
  const [driftRationale, setDriftRationale] = useState("")

  if (mode === "lock") {
    return (
      <div className="space-y-2">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!confirmed ? (
          <Button variant="destructive" onClick={() => setConfirmed(true)} disabled={pending}>
            I understand — lock tax year {year}
          </Button>
        ) : needsDriftAck ? (
          <div className="space-y-2">
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
              <p className="font-medium text-amber-500">Drift detected vs prior locked snapshot</p>
              <p className="mt-1 text-foreground/80">
                One or more Schedule C lines, gross receipts, or total deductions changed by more than
                the threshold (15% per line, 10% for gross receipts, 15% for total deductions). Type a
                rationale explaining the changes — it lands on the audit trail as your acknowledgement.
              </p>
            </div>
            <label className="text-sm font-medium">Drift acknowledgement (required, ≥20 chars)</label>
            <Textarea
              value={driftRationale}
              onChange={(e) => setDriftRationale(e.target.value)}
              placeholder="e.g. Bounced check $4,372.01 + chargeback $1,050 recoded PERSONAL per CPA_AUDIT findings — phantom Line 27a deductions removed; 5 NEEDS_CONTEXT inflows reclassified PERSONAL to unblock A13."
              rows={4}
            />
            <div className="flex gap-2">
              <Button
                variant="destructive"
                disabled={pending || driftRationale.trim().length < 20}
                onClick={() =>
                  startTransition(async () => {
                    setError(null)
                    try {
                      await confirmLock(year, { driftAck: driftRationale.trim() })
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e))
                    }
                  })
                }
              >
                {pending ? "Locking…" : "Confirm lock with drift acknowledgement"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setNeedsDriftAck(false)
                  setConfirmed(false)
                  setDriftRationale("")
                }}
                disabled={pending}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                startTransition(async () => {
                  setError(null)
                  try {
                    await confirmLock(year)
                  } catch (e) {
                    if (isDriftApprovalError(e)) {
                      // RELOCK_VERIFY thresholds exceeded — collect rationale and retry.
                      setNeedsDriftAck(true)
                      return
                    }
                    setError(e instanceof Error ? e.message : String(e))
                  }
                })
              }
            >
              {pending ? "Locking…" : "Confirm lock"}
            </Button>
            <Button variant="outline" onClick={() => setConfirmed(false)} disabled={pending}>Cancel</Button>
          </div>
        )}
      </div>
    )
  }

  // unlock
  return (
    <div className="space-y-2">
      <label className="text-sm font-medium">Unlock rationale (required, ≥10 chars)</label>
      <Textarea
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
        placeholder="Describe why you're unlocking (e.g., late-arriving receipt changes classification)."
        rows={3}
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button
        variant="destructive"
        disabled={pending || rationale.trim().length < 10}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            try {
              await unlockTaxYear(year, rationale)
              setRationale("")
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e))
            }
          })
        }
      >
        {pending ? "Unlocking…" : "Unlock tax year"}
      </Button>
    </div>
  )
}
