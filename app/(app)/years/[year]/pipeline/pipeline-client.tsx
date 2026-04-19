"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import {
  runNormalizeMerchants,
  runMatchTransfers,
  runMatchPayments,
  runMatchRefunds,
  runMerchantAI,
  runApplyRules,
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
}

interface PipelineClientProps {
  year: number
  initial: PipelineStats
}

interface StepResult {
  label: string
  detail: string
  ok: boolean
}

export function PipelineClient({ year, initial }: PipelineClientProps) {
  const [stats, setStats] = useState(initial)
  const [results, setResults] = useState<StepResult[]>([])
  const [isPending, startTransition] = useTransition()

  function addResult(label: string, detail: string, ok: boolean) {
    setResults((prev) => [...prev, { label, detail, ok }])
  }

  function run(action: () => Promise<unknown>, label: string) {
    startTransition(async () => {
      try {
        const result = await action()
        addResult(label, JSON.stringify(result, null, 0), true)
        // Refresh stats — server component will revalidate on next render
        window.location.reload()
      } catch (err) {
        addResult(label, String(err), false)
      }
    })
  }

  const steps = [
    {
      id: "normalize",
      label: "1. Normalize Merchants",
      description: "Strip processor prefixes, trailing city/state, reference numbers",
      action: () => runNormalizeMerchants(year),
      stat: `${stats.normalizedTx} / ${stats.totalTx} normalized`,
    },
    {
      id: "transfers",
      label: "2. Match Transfers",
      description: "Pair outflow/inflow across accounts (±5 days, same amount)",
      action: () => runMatchTransfers(year),
      stat: `${stats.transferPairs} transfer pairs`,
    },
    {
      id: "payments",
      label: "3. Match Card Payments",
      description: 'Pair "Payment Thank You" with checking outflow',
      action: () => runMatchPayments(year),
      stat: `${stats.paymentPairs} payment pairs`,
    },
    {
      id: "refunds",
      label: "4. Match Refunds",
      description: "Pair credit card refunds to prior charges (90-day window)",
      action: () => runMatchRefunds(year),
      stat: `${stats.refundPairs} refund pairs`,
    },
    {
      id: "ai",
      label: "5. Run Merchant AI",
      description: "Call Sonnet 4.6 in batches of 25 — classify unique merchants",
      action: () => runMerchantAI(year),
      stat: `${stats.merchantRules} rules`,
    },
    {
      id: "apply",
      label: "6. Apply Rules",
      description: "Stamp Classification rows; apply trip overrides",
      action: () => runApplyRules(year),
      stat: `${stats.classified} classified, ${stats.stops} STOPs`,
    },
  ]

  return (
    <div className="space-y-6">
      {/* Stats overview */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total transactions" value={stats.totalTx} />
        <StatCard label="Classified" value={stats.classified} />
        <StatCard label="Merchant rules" value={stats.merchantRules} />
        <StatCard label="STOPs pending" value={stats.stops} />
      </div>

      {/* Step buttons */}
      <div className="space-y-3">
        {steps.map((step) => (
          <Card key={step.id}>
            <CardContent className="flex items-center justify-between py-4 gap-4">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm">{step.label}</p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
              <Badge variant="outline" className="text-xs shrink-0">
                {step.stat}
              </Badge>
              <Button
                size="sm"
                variant="outline"
                disabled={isPending}
                onClick={() => run(step.action, step.label)}
              >
                {isPending ? "Running…" : "Run"}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

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
