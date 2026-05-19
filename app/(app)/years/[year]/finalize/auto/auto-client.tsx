"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { runAutoCpaFinalize } from "./actions"

interface StageResult {
  preCleanup?: unknown
  cpaAudit?: unknown
  cohanSweep?: unknown
  substantiationQueue?: unknown
  errors?: Array<{ stage: string; message: string }>
}

export function AutoFinalizeClient({ year, taxYearStatus }: { year: number; taxYearStatus: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<StageResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  function run() {
    setError(null)
    setResult(null)
    setRunning(true)
    startTransition(async () => {
      try {
        const r = await runAutoCpaFinalize(year)
        setResult(r)
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err))
      } finally {
        setRunning(false)
        router.refresh()
      }
    })
  }

  const isLocked = taxYearStatus === "LOCKED"

  return (
    <Card>
      <CardHeader>
        <CardTitle>Run Auto-CPA</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLocked && (
          <div className="text-sm text-orange-200 bg-orange-500/10 p-3 rounded">
            This tax year is LOCKED. Unlock it from <a className="underline" href={`/years/${year}/lock`}>/lock</a>{" "}
            before running auto-CPA — findings and Cohan promotions can only be applied to an unlocked year.
          </div>
        )}

        <Button onClick={run} disabled={isPending || isLocked} size="lg">
          {running ? "Running 4 stages — this takes 60–120s…" : "Run Auto-CPA Finalize"}
        </Button>

        {error && (
          <div className="text-sm text-red-300 bg-red-500/10 p-3 rounded">
            Error: {error}
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <h3 className="font-medium">Stage results</h3>
            <div className="space-y-1 text-sm">
              <StageRow name="PRE_CLEANUP" data={result.preCleanup} />
              <StageRow name="CPA_AUDIT" data={result.cpaAudit} />
              <StageRow name="COHAN_SWEEP" data={result.cohanSweep} />
              <StageRow name="SUBSTANTIATION_QUEUE" data={result.substantiationQueue} />
            </div>
            {result.errors && result.errors.length > 0 && (
              <div className="text-sm text-red-300 bg-red-500/10 p-3 rounded space-y-1">
                <div className="font-medium">Errors:</div>
                {result.errors.map((e, i) => (
                  <div key={i}>
                    {e.stage}: {e.message}
                  </div>
                ))}
              </div>
            )}
            <div className="pt-3">
              <a href={`/years/${year}/findings`} className="underline text-sm">
                → Review findings
              </a>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function StageRow({ name, data }: { name: string; data: unknown }) {
  if (data == null) {
    return (
      <div className="flex justify-between font-mono text-xs">
        <span>{name}</span>
        <span className="text-muted-foreground">skipped (error)</span>
      </div>
    )
  }
  return (
    <details>
      <summary className="cursor-pointer flex justify-between font-mono text-xs">
        <span>{name}</span>
        <span className="text-green-300">ok</span>
      </summary>
      <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-x-auto">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  )
}
