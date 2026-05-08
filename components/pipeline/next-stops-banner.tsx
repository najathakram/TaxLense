import Link from "next/link"
import { Button } from "@/components/ui/button"

interface Props {
  year: number
  pendingStops: number
  classified: number
  totalTx: number
}

/**
 * Sticky banner shown when classification is complete but there are still
 * pending STOPs blocking the lock. Renders on both the year overview and the
 * pipeline page so the user always knows the next action without having to
 * scan the sidebar for the "94" badge.
 *
 * Hidden when there are no pending stops or the year hasn't reached
 * classified == total yet (the user has earlier work to do first).
 */
export function NextStopsBanner({ year, pendingStops, classified, totalTx }: Props) {
  if (pendingStops <= 0) return null
  if (totalTx === 0) return null
  if (classified < totalTx) return null

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-4 py-3 flex items-center justify-between gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <div
          aria-hidden
          className="inline-flex items-center justify-center w-8 h-8 rounded-full bg-amber-500/20 text-amber-500 text-base font-semibold shrink-0"
        >
          !
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {pendingStops} transaction{pendingStops === 1 ? "" : "s"} need your call
          </p>
          <p className="text-xs text-muted-foreground">
            Classification is complete — resolve STOPs to unlock the lock + finalize step.
          </p>
        </div>
      </div>
      <Button asChild size="sm" variant="default" className="shrink-0">
        <Link href={`/years/${year}/stops`}>Resolve STOPs →</Link>
      </Button>
    </div>
  )
}
