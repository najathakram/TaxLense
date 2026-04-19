"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { confirmLock, unlockTaxYear } from "./actions"

export function LockClient({ mode, year }: { mode: "lock" | "unlock"; year: number }) {
  const [pending, startTransition] = useTransition()
  const [rationale, setRationale] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [confirmed, setConfirmed] = useState(false)

  if (mode === "lock") {
    return (
      <div className="space-y-2">
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!confirmed ? (
          <Button variant="destructive" onClick={() => setConfirmed(true)} disabled={pending}>
            I understand — lock tax year {year}
          </Button>
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
