import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import type { TaxYearStatus } from "@/app/generated/prisma/client"

interface Counts {
  totalTx: number
  classifiedTx: number
  pendingStops: number
}

interface Props {
  year: number
  stage: TaxYearStatus
  counts: Counts
  /** Lock metadata — only consumed when stage === "LOCKED". */
  lockedAt?: Date | null
  lockedSnapshotHash?: string | null
}

/**
 * Year-overview hero card. One source of truth for "what should I do next?"
 * across the 9-page year journey. The stage is the derived TaxYearStatus
 * computed by lib/taxYear/status.ts; the CTA, copy, and href are picked
 * from a small lookup table below so the same component renders for every
 * stage without conditional sprawl in the page itself.
 */
export function NextActionCard({
  year,
  stage,
  counts,
  lockedAt,
  lockedSnapshotHash,
}: Props) {
  const config = buildStageConfig({ year, stage, counts, lockedAt, lockedSnapshotHash })

  return (
    <Card className={`border-2 ${config.borderClass} ${config.bgClass}`}>
      <CardContent className="py-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-[280px]">
            <div className="flex items-center gap-2 mb-1.5">
              <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-semibold ${config.iconClass}`} aria-hidden>
                {config.icon}
              </span>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Next action · {config.stageLabel}
              </p>
            </div>
            <h2 className="text-lg font-semibold leading-snug">{config.title}</h2>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              {config.subtitle}
            </p>
            {config.metaLine && (
              <p className="text-xs text-muted-foreground/80 mt-2 font-mono break-all">
                {config.metaLine}
              </p>
            )}
          </div>
          <Button asChild size="lg" variant={config.buttonVariant} className="shrink-0">
            <Link href={config.href}>{config.cta} →</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

interface StageConfig {
  stageLabel: string
  icon: string
  iconClass: string
  borderClass: string
  bgClass: string
  buttonVariant: "default" | "outline" | "secondary"
  title: string
  subtitle: string
  metaLine: string | null
  cta: string
  href: string
}

function buildStageConfig({
  year,
  stage,
  counts,
  lockedAt,
  lockedSnapshotHash,
}: Props): StageConfig {
  const yearBase = `/years/${year}`

  if (stage === "LOCKED") {
    const lockedAtStr = lockedAt
      ? new Date(lockedAt).toISOString().slice(0, 10)
      : null
    return {
      stageLabel: "Locked",
      icon: "✓",
      iconClass: "bg-emerald-500/20 text-emerald-500",
      borderClass: "border-emerald-500/40",
      bgClass: "bg-gradient-to-br from-emerald-500/5 to-transparent",
      buttonVariant: "default",
      title: "Year is locked — download your tax package",
      subtitle:
        "The ledger is frozen. Generate the master ledger, financial statements, audit packet, and CPA tax package. Re-runs are reproducible against the snapshot hash below.",
      metaLine:
        lockedSnapshotHash
          ? `Locked ${lockedAtStr ?? "—"} · sha256:${lockedSnapshotHash.slice(0, 16)}…`
          : null,
      cta: "Download tax package",
      href: `${yearBase}/finalize#download`,
    }
  }

  if (stage === "REVIEW") {
    return {
      stageLabel: "Ready to lock",
      icon: "→",
      iconClass: "bg-blue-500/20 text-blue-500",
      borderClass: "border-blue-500/40",
      bgClass: "bg-gradient-to-br from-blue-500/5 to-transparent",
      buttonVariant: "default",
      title: "Classification complete — review & lock",
      subtitle:
        "Every transaction is classified and there are no pending STOPs. Walk the three-step finalize page (review risk → lock → download).",
      metaLine: `${counts.classifiedTx}/${counts.totalTx} classified · 0 stops pending`,
      cta: "Open finalize",
      href: `${yearBase}/finalize`,
    }
  }

  if (stage === "CLASSIFICATION") {
    if (counts.pendingStops > 0 && counts.classifiedTx >= counts.totalTx) {
      // Every row is classified, but STOPs remain — usually because the
      // user has answers to provide (deposit attribution, transfer
      // identity, §274(d) substantiation). B-09 wires auto-archive on every
      // classification commit, so legacy / superseded STOPs no longer need
      // a manual button click in steady state — the ones that remain are
      // genuinely waiting on user input.
      return {
        stageLabel: "Stops blocking lock",
        icon: "!",
        iconClass: "bg-amber-500/20 text-amber-500",
        borderClass: "border-amber-500/40",
        bgClass: "bg-gradient-to-br from-amber-500/5 to-transparent",
        buttonVariant: "default",
        title: `Resolve ${counts.pendingStops} STOP${counts.pendingStops === 1 ? "" : "s"} to unlock review`,
        subtitle:
          "Every transaction is classified — answer or defer the remaining STOPs (mostly deposit attribution and §274(d) substantiation) and the year is ready to lock.",
        metaLine: `${counts.classifiedTx}/${counts.totalTx} classified · ${counts.pendingStops} stop${counts.pendingStops === 1 ? "" : "s"} pending`,
        cta: "Resolve STOPs",
        href: `${yearBase}/stops`,
      }
    }
    const remaining = Math.max(0, counts.totalTx - counts.classifiedTx)
    return {
      stageLabel: "Classifying",
      icon: "⋯",
      iconClass: "bg-blue-500/20 text-blue-500",
      borderClass: "border-blue-500/40",
      bgClass: "bg-gradient-to-br from-blue-500/5 to-transparent",
      buttonVariant: "default",
      title: remaining > 0
        ? `Classify the remaining ${remaining} transaction${remaining === 1 ? "" : "s"}`
        : "Continue the classification pipeline",
      subtitle:
        "Run the autonomous CPA agent to finish classifying every transaction with IRC citations + evidence tier + confidence in one pass.",
      metaLine: `${counts.classifiedTx}/${counts.totalTx} classified${counts.pendingStops > 0 ? ` · ${counts.pendingStops} stop${counts.pendingStops === 1 ? "" : "s"} pending` : ""}`,
      cta: "Open pipeline",
      href: `${yearBase}/pipeline`,
    }
  }

  if (stage === "INGESTION") {
    return {
      stageLabel: "Ingesting",
      icon: "↑",
      iconClass: "bg-blue-500/20 text-blue-500",
      borderClass: "border-blue-500/40",
      bgClass: "bg-gradient-to-br from-blue-500/5 to-transparent",
      buttonVariant: "default",
      title: counts.totalTx === 0
        ? "Upload your first statement"
        : "Continue uploading or run the agent",
      subtitle: counts.totalTx === 0
        ? "Drop in PDF, CSV, or OFX statements for every account that touched this tax year. The parser de-dupes by hash + by transaction key, so re-uploading the same file is safe."
        : `${counts.totalTx} transactions ingested. Add more statements or jump to the pipeline to start classifying.`,
      metaLine: counts.totalTx > 0 ? `${counts.totalTx} transactions ingested` : null,
      cta: counts.totalTx === 0 ? "Upload statements" : "Continue uploading",
      href: `${yearBase}/upload`,
    }
  }

  if (stage === "ARCHIVED") {
    return {
      stageLabel: "Archived",
      icon: "▣",
      iconClass: "bg-muted text-muted-foreground",
      borderClass: "border-border",
      bgClass: "bg-muted/20",
      buttonVariant: "outline",
      title: "This year is archived",
      subtitle:
        "Read-only view. Reports are still available for download.",
      metaLine: null,
      cta: "Download artifacts",
      href: `${yearBase}/finalize#download`,
    }
  }

  // CREATED — empty year, never had an upload
  return {
    stageLabel: "New year",
    icon: "+",
    iconClass: "bg-blue-500/20 text-blue-500",
    borderClass: "border-blue-500/40",
    bgClass: "bg-gradient-to-br from-blue-500/5 to-transparent",
    buttonVariant: "default",
    title: "Get started — upload your first statement",
    subtitle:
      "Drop in a bank or card statement (PDF, CSV, or OFX). The parser will extract transactions and you can run the agent once everything's in.",
    metaLine: null,
    cta: "Upload statements",
    href: `${yearBase}/upload`,
  }
}
