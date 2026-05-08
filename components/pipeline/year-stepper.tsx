import Link from "next/link"
import type { TaxYearStatus } from "@/app/generated/prisma/client"

interface Props {
  year: number
  stage: TaxYearStatus
  /** Substage hint — when classification is done but STOPs are pending, push
   *  the visual "active" segment to Review even though TaxYearStatus is still
   *  CLASSIFICATION. Without this the stepper underreports progress. */
  pendingStops?: number
  classifiedTx?: number
  totalTx?: number
}

type SegmentState = "done" | "active" | "upcoming"

interface Segment {
  key: string
  label: string
  href: string
  state: SegmentState
}

/**
 * Horizontal 4-step nav rendered at the top of every /years/[year] page.
 * Replaces the sidebar's INGEST/PROCESS/REVIEW/DELIVER groupings as the
 * primary wayfinding cue — sidebar stays as secondary nav for power users.
 *
 * Stages and what they mean:
 *   1. Ingest    — upload + coverage
 *   2. Classify  — pipeline (run autonomous agent or step through manually)
 *   3. Review    — stops queue + ledger + risk dashboard
 *   4. Finalize  — lock + download (collapsed into /finalize in Tier 3.9)
 *
 * The active segment is computed from the derived TaxYearStatus + stop
 * pendingness. CLASSIFICATION with everything classified but stops still
 * pending is shown as Review-active (visual progress) even though the
 * underlying status hasn't yet flipped to REVIEW (which requires stops==0).
 */
export function YearStepper({
  year,
  stage,
  pendingStops = 0,
  classifiedTx = 0,
  totalTx = 0,
}: Props) {
  const yearBase = `/years/${year}`

  const allClassified = totalTx > 0 && classifiedTx >= totalTx

  // Map (stage, sub-state) onto the active segment index. Indices: 0 Ingest,
  // 1 Classify, 2 Review, 3 Finalize.
  let activeIdx: number
  if (stage === "LOCKED" || stage === "ARCHIVED") {
    activeIdx = 3
  } else if (stage === "REVIEW") {
    activeIdx = 2
  } else if (stage === "CLASSIFICATION") {
    // Pull active to Review when classification is done and only STOPs remain.
    activeIdx = allClassified && pendingStops > 0 ? 2 : 1
  } else if (stage === "INGESTION" || stage === "CREATED") {
    activeIdx = 0
  } else {
    activeIdx = 0
  }

  const segments: Segment[] = [
    {
      key: "ingest",
      label: "Ingest",
      href: `${yearBase}/upload`,
      state: activeIdx > 0 ? "done" : activeIdx === 0 ? "active" : "upcoming",
    },
    {
      key: "classify",
      label: "Classify",
      href: `${yearBase}/pipeline`,
      state: activeIdx > 1 ? "done" : activeIdx === 1 ? "active" : "upcoming",
    },
    {
      key: "review",
      label: "Review",
      href: pendingStops > 0 ? `${yearBase}/stops` : `${yearBase}/ledger`,
      state: activeIdx > 2 ? "done" : activeIdx === 2 ? "active" : "upcoming",
    },
    {
      key: "finalize",
      label: "Finalize",
      href: `${yearBase}/finalize`,
      state: activeIdx === 3 ? (stage === "LOCKED" ? "done" : "active") : "upcoming",
    },
  ]

  return (
    <nav
      aria-label="Tax year progress"
      className="flex items-center gap-1 sm:gap-2 px-6 py-3 border-b border-border bg-background/40 backdrop-blur"
    >
      {segments.map((seg, i) => (
        <span key={seg.key} className="flex items-center gap-1 sm:gap-2 flex-1 sm:flex-initial">
          <SegmentLink seg={seg} index={i + 1} />
          {i < segments.length - 1 && <Connector state={seg.state} />}
        </span>
      ))}
    </nav>
  )
}

function SegmentLink({ seg, index }: { seg: Segment; index: number }) {
  const stateClass = {
    done: "bg-emerald-500/15 text-emerald-500 border-emerald-500/30 hover:bg-emerald-500/20",
    active: "bg-blue-500/20 text-blue-500 border-blue-500/40 hover:bg-blue-500/25",
    upcoming: "bg-muted/40 text-muted-foreground border-border hover:bg-muted/60",
  }[seg.state]

  return (
    <Link
      href={seg.href}
      className={`flex items-center gap-2 px-2 sm:px-3 py-1.5 rounded-full border text-xs font-medium transition-colors ${stateClass}`}
      aria-current={seg.state === "active" ? "step" : undefined}
    >
      <span
        className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-semibold border ${
          seg.state === "done"
            ? "bg-emerald-500/30 border-emerald-500/40"
            : seg.state === "active"
              ? "bg-blue-500/30 border-blue-500/40"
              : "bg-muted border-border"
        }`}
        aria-hidden
      >
        {seg.state === "done" ? "✓" : index}
      </span>
      <span className="hidden sm:inline">{seg.label}</span>
    </Link>
  )
}

function Connector({ state }: { state: SegmentState }) {
  return (
    <span
      aria-hidden
      className={`flex-1 h-px min-w-3 ${state === "done" ? "bg-emerald-500/40" : "bg-border"}`}
    />
  )
}
