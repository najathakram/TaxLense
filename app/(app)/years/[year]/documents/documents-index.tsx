"use client"

import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"

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
  slugs: string[]
  statuses: Status[]
  registry: Record<string, SpecMeta>
}

export function DocumentsIndex({ year, slugs, statuses, registry }: Props) {
  const statusBySlug = Object.fromEntries(statuses.map((s) => [s.slug, s]))
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Documents — TY {year}</h1>
      <p className="text-sm text-muted-foreground">
        Click any document to preview the rendered PDF in-browser. Stale docs
        regenerate on click.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {slugs.map((s) => {
          const m = registry[s]
          const st = statusBySlug[s]
          if (!m) return null
          return (
            <Link key={s} href={`/years/${year}/documents/${s}`}>
              <Card className="hover:bg-accent/50 transition cursor-pointer">
                <CardContent className="p-4">
                  <div className="font-medium text-sm">{m.displayName}</div>
                  <div className="text-xs text-muted-foreground mt-1">{m.authority}</div>
                  <div className="text-[10px] mt-2">
                    {st?.isStale ? "stale" : st?.hasReport ? "generated" : "not generated yet"}
                  </div>
                </CardContent>
              </Card>
            </Link>
          )
        })}
      </div>
    </div>
  )
}
