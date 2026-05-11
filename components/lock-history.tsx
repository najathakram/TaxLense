"use client"

/**
 * Lock-history chain — surfaces the sequence of TAXYEAR_LOCKED /
 * TAXYEAR_UNLOCKED AuditEvents for a tax year so the CPA can see how
 * many times the year has been re-opened, who did it, and what hash
 * each lock produced.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export interface LockHistoryEvent {
  occurredAt: string
  eventType: "TAXYEAR_LOCKED" | "TAXYEAR_UNLOCKED"
  rationale: string | null
  hash: string | null
  actor: string
}

interface Props {
  events: LockHistoryEvent[]
}

export function LockHistory({ events }: Props) {
  if (events.length === 0) {
    return null
  }
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">
          Lock history{" "}
          <span className="text-xs font-normal text-muted-foreground">
            ({events.length} event{events.length === 1 ? "" : "s"})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-xs">
        {events.map((e, i) => (
          <div key={i} className="flex items-start gap-3 border-l-2 pl-3 py-1" style={{
            borderColor: e.eventType === "TAXYEAR_LOCKED" ? "rgb(34 197 94)" : "rgb(244 63 94)",
          }}>
            <Badge
              variant={e.eventType === "TAXYEAR_LOCKED" ? "default" : "destructive"}
              className="text-[9px]"
            >
              {e.eventType === "TAXYEAR_LOCKED" ? "LOCKED" : "UNLOCKED"}
            </Badge>
            <div className="flex-1 min-w-0">
              <div className="text-muted-foreground">
                {e.occurredAt} · by {e.actor}
              </div>
              {e.rationale && <div className="italic mt-0.5">&ldquo;{e.rationale}&rdquo;</div>}
              {e.hash && (
                <div className="font-mono text-[10px] mt-0.5 truncate">
                  hash: {e.hash.slice(0, 32)}…
                </div>
              )}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
