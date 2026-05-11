"use client"

import { useMemo, useState, useTransition } from "react"
import {
  buildDeliverableList,
  buildComplianceFlags,
  summarizeDeliverables,
  type EntityType,
  type DeliverableContext,
  type DeliverableGroup,
} from "@/lib/forms/deliverables"
import type { LoadedDeliverableContext } from "@/lib/forms/loadDeliverableContext"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface Props {
  year: number
  isLocked: boolean
  context: LoadedDeliverableContext
}

const ENTITY_OPTIONS: Array<{ value: EntityType; label: string }> = [
  { value: "SOLE_PROP", label: "Sole Proprietor" },
  { value: "LLC_SINGLE", label: "Single-Member LLC (disregarded)" },
  { value: "S_CORP", label: "S-Corporation (Form 1120-S)" },
  { value: "LLC_MULTI", label: "Multi-Member LLC (Form 1065)" },
  { value: "C_CORP", label: "C-Corporation (Form 1120)" },
  { value: "PARTNERSHIP", label: "General Partnership (Form 1065)" },
]

const GROUP_LABELS: Record<DeliverableGroup, string> = {
  TAX: "Tax forms",
  ACCOUNTING: "Accounting statements",
  INFO_RETURN: "Information returns (1099 / W-2)",
  WORKFLOW: "Workflow & audit",
  STATE: "State filings",
}

export function DumpPanel({ year, isLocked, context: initialContext }: Props) {
  const [entityType, setEntityType] = useState<EntityType>(initialContext.defaultEntityType)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  // Reactive context — entity dropdown changes flow through buildDeliverableList
  // without a server round-trip.
  const ctx: DeliverableContext = useMemo(
    () => ({
      entityType,
      state: initialContext.state,
      taxYear: initialContext.taxYear,
      ledger: initialContext.ledger,
      owners: initialContext.owners,
      assertionsPass: initialContext.assertionsPass,
      skip1099s: initialContext.skip1099s,
      skip1099sReason: initialContext.skip1099sReason,
    }),
    [initialContext, entityType],
  )

  const deliverables = useMemo(() => buildDeliverableList(ctx), [ctx])
  const flags = useMemo(() => buildComplianceFlags(ctx), [ctx])
  const summary = useMemo(() => summarizeDeliverables(deliverables), [deliverables])

  const triggeredItems = deliverables.filter((d) => d.triggered)
  const skippedItems = deliverables.filter((d) => !d.triggered)
  const totalBlockers = summary.blockerCount
  const entityChanged = entityType !== initialContext.defaultEntityType

  const canGenerate = isLocked && totalBlockers === 0 && ctx.assertionsPass

  function generate() {
    setError(null)
    setInfo(null)
    startTransition(async () => {
      try {
        const res = await fetch(
          `/api/years/${year}/dump?entity=${encodeURIComponent(entityType)}`,
          { method: "POST" },
        )
        if (!res.ok) {
          const txt = await res.text().catch(() => "")
          setError(txt || `Dump failed (${res.status})`)
          return
        }
        // Stream the ZIP via blob → click an anchor
        const blob = await res.blob()
        const url = URL.createObjectURL(blob)
        const a = document.createElement("a")
        a.href = url
        const cd = res.headers.get("content-disposition") ?? ""
        const m = /filename="([^"]+)"/.exec(cd)
        a.download = m?.[1] ?? `dump-${year}.zip`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        setInfo(`Generated ${triggeredItems.length} document${triggeredItems.length === 1 ? "" : "s"} for ${entityType}.`)
      } catch (e) {
        setError(e instanceof Error ? e.message : "Network error")
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Entity selector */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Final Document Dump</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm font-medium">Filing as:</label>
            <select
              className="border rounded px-3 py-1.5 text-sm bg-background"
              value={entityType}
              onChange={(e) => setEntityType(e.target.value as EntityType)}
            >
              {ENTITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
            {entityChanged && (
              <Badge variant="outline" className="text-xs">
                ⚠ Entity differs from profile ({initialContext.defaultEntityType})
              </Badge>
            )}
          </div>

          <div className="text-sm text-muted-foreground">
            This will generate{" "}
            <span className="font-semibold text-foreground">
              {triggeredItems.length} document{triggeredItems.length === 1 ? "" : "s"}
            </span>{" "}
            keyed to <span className="font-mono">{entityType}</span>.
            {totalBlockers > 0 && (
              <span className="text-destructive">
                {" "}{totalBlockers} blocker{totalBlockers === 1 ? "" : "s"} preventing generation.
              </span>
            )}
            {!ctx.assertionsPass && (
              <span className="text-destructive">
                {" "}Lock-assertions are failing — resolve in steps 1–2 first.
              </span>
            )}
          </div>

          {/* Per-group sections */}
          {(["TAX", "ACCOUNTING", "INFO_RETURN", "WORKFLOW", "STATE"] as const).map((group) => {
            const items = summary.byGroup[group]
            if (!items.length) return null
            const triggeredInGroup = items.filter((i) => i.triggered)
            const skippedInGroup = items.filter((i) => !i.triggered)
            return (
              <details key={group} open className="border rounded">
                <summary className="cursor-pointer px-3 py-2 text-sm font-medium bg-muted/30 flex items-center justify-between">
                  <span>{GROUP_LABELS[group]}</span>
                  <span className="text-xs text-muted-foreground">
                    {triggeredInGroup.length} included
                    {skippedInGroup.length > 0 && ` · ${skippedInGroup.length} skipped`}
                  </span>
                </summary>
                <ul className="text-sm divide-y">
                  {triggeredInGroup.map((d) => (
                    <li key={d.formId} className="px-3 py-2 flex items-start gap-2">
                      <span className="mt-0.5">{d.required ? "•" : "○"}</span>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium">{d.displayName}</div>
                        {d.formRevision && (
                          <div className="text-xs text-muted-foreground">{d.formRevision}</div>
                        )}
                        {d.blockers.length > 0 && (
                          <ul className="mt-1 space-y-0.5">
                            {d.blockers.map((b, i) => (
                              <li key={i} className="text-xs text-destructive">
                                ⚠ {b}
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                          {d.authority}
                        </div>
                      </div>
                    </li>
                  ))}
                  {skippedInGroup.map((d) => (
                    <li key={d.formId} className="px-3 py-2 flex items-start gap-2 opacity-60">
                      <span className="mt-0.5">⊘</span>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm">
                          <span className="line-through">{d.displayName}</span>
                        </div>
                        {d.skipReason && (
                          <div className="text-xs text-muted-foreground">{d.skipReason}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </details>
            )
          })}

          {/* Compliance flags (informational) */}
          {flags.length > 0 && (
            <details className="border rounded">
              <summary className="cursor-pointer px-3 py-2 text-sm font-medium bg-muted/30">
                Compliance flags ({flags.length})
              </summary>
              <ul className="text-xs divide-y">
                {flags.map((f) => (
                  <li
                    key={f.id}
                    className={`px-3 py-2 ${f.severity === "warning" ? "text-amber-700 dark:text-amber-300" : ""}`}
                  >
                    <div>{f.message}</div>
                    <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {f.authority}
                    </div>
                  </li>
                ))}
              </ul>
            </details>
          )}

          {error && (
            <Alert variant="destructive">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
          {info && (
            <Alert>
              <AlertDescription>{info}</AlertDescription>
            </Alert>
          )}

          <div className="flex items-center justify-between pt-2 border-t">
            <div className="text-xs text-muted-foreground">
              {!isLocked && "Lock the year (step 2) to enable dump generation."}
              {isLocked && !ctx.assertionsPass && "Re-run assertions after resolving blockers."}
              {isLocked && ctx.assertionsPass && totalBlockers === 0 &&
                `Ready to generate ${triggeredItems.length} document${triggeredItems.length === 1 ? "" : "s"}.`}
            </div>
            <Button
              onClick={generate}
              disabled={!canGenerate || isPending}
              size="sm"
            >
              {isPending ? "Generating…" : `Generate dump (${triggeredItems.length} docs)`}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
