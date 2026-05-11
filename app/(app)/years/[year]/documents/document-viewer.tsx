"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { LineagePanel, type LineageRow } from "./[kind]/lineage-panel"

interface SpecMeta {
  slug: string
  displayName: string
  shortName: string
  group: "TAX" | "ACCOUNTING" | "WORKFLOW"
  authority: string
  requiresLock: boolean
}

interface Status {
  slug: string
  hasReport: boolean
  generatedAt: Date | null
  isStale: boolean
}

interface Props {
  year: number
  isLocked: boolean
  entityType: string
  activeSlug: string
  activeSpec: SpecMeta
  activeStatus: Status
  sidebarSlugs: string[]
  sidebarStatuses: Status[]
  sidebarMeta: Record<
    string,
    { displayName: string; shortName: string; group: "TAX" | "ACCOUNTING" | "WORKFLOW" }
  >
  /** Lineage rows for the active doc — populated for TAX-group docs only. */
  lineage?: LineageRow[]
  lineageFormName?: string
}

const GROUP_LABEL: Record<"TAX" | "ACCOUNTING" | "WORKFLOW", string> = {
  TAX: "Tax forms",
  ACCOUNTING: "Accounting",
  WORKFLOW: "Workflow",
}

export function DocumentViewer({
  year,
  isLocked,
  entityType,
  activeSlug,
  activeSpec,
  activeStatus,
  sidebarSlugs,
  sidebarStatuses,
  sidebarMeta,
  lineage,
  lineageFormName,
}: Props) {
  const statusBySlug = Object.fromEntries(sidebarStatuses.map((s) => [s.slug, s]))

  // Group slugs by their group for the left rail
  const grouped: Record<string, string[]> = { TAX: [], ACCOUNTING: [], WORKFLOW: [] }
  for (const s of sidebarSlugs) {
    const m = sidebarMeta[s]
    if (m) grouped[m.group].push(s)
  }

  const cannotPreview = activeSpec.requiresLock && !isLocked
  const pdfUrl = cannotPreview
    ? null
    : `/api/years/${year}/documents/${activeSpec.slug}/pdf?inline=1`
  const downloadUrl = `/api/years/${year}/documents/${activeSpec.slug}/pdf?inline=0`

  return (
    <div className="flex h-[calc(100vh-72px)] overflow-hidden">
      {/* Left rail */}
      <aside className="w-72 border-r overflow-y-auto bg-muted/10">
        <div className="p-4 border-b">
          <h2 className="text-sm font-semibold">Documents — TY {year}</h2>
          <p className="text-xs text-muted-foreground mt-1">{entityType}</p>
        </div>
        {(["TAX", "ACCOUNTING", "WORKFLOW"] as const).map((group) => {
          const items = grouped[group]
          if (!items.length) return null
          return (
            <div key={group} className="py-2">
              <div className="px-4 py-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {GROUP_LABEL[group]}
              </div>
              {items.map((slug) => {
                const meta = sidebarMeta[slug]
                const st = statusBySlug[slug]
                const isActive = slug === activeSlug
                return (
                  <Link
                    key={slug}
                    href={`/years/${year}/documents/${slug}`}
                    className={`block px-4 py-2 text-xs hover:bg-muted/30 ${isActive ? "bg-accent text-accent-foreground font-medium" : ""}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="truncate">{meta?.shortName ?? slug}</span>
                      {st?.isStale ? (
                        <Badge variant="outline" className="text-[9px] ml-1">stale</Badge>
                      ) : st?.hasReport ? (
                        <Badge variant="default" className="text-[9px] ml-1">✓</Badge>
                      ) : null}
                    </div>
                  </Link>
                )
              })}
            </div>
          )
        })}
      </aside>

      {/* Main viewer */}
      <main className="flex-1 overflow-y-auto">
        <div className="p-6 space-y-4">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-xl font-bold">{activeSpec.displayName}</h1>
              <p className="text-xs text-muted-foreground mt-1">{activeSpec.authority}</p>
              {activeStatus.generatedAt && (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Last generated: {activeStatus.generatedAt.toISOString().slice(0, 19).replace("T", " ")}
                  {activeStatus.isStale && (
                    <span className="ml-2 text-amber-600">• Stale — re-generate</span>
                  )}
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {!cannotPreview && (
                <a href={downloadUrl} download>
                  <Button variant="outline" size="sm">Download PDF</Button>
                </a>
              )}
              <Link href={`/years/${year}/finalize#download`}>
                <Button variant="ghost" size="sm">All artifacts →</Button>
              </Link>
            </div>
          </div>

          {cannotPreview && (
            <Alert>
              <AlertDescription>
                This document requires the tax year to be LOCKED before generation.
                Resolve the lock-blockers in <Link href={`/years/${year}/finalize`} className="underline">Finalize</Link> first.
              </AlertDescription>
            </Alert>
          )}

          {pdfUrl && (
            <Card>
              <CardContent className="p-0">
                <iframe
                  src={pdfUrl}
                  className="w-full"
                  style={{ height: "calc(100vh - 380px)", border: 0 }}
                  title={activeSpec.displayName}
                />
              </CardContent>
            </Card>
          )}

          {lineage && lineage.length > 0 && lineageFormName && (
            <LineagePanel year={year} rows={lineage} formName={lineageFormName} />
          )}
        </div>
      </main>
    </div>
  )
}
