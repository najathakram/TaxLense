/**
 * Idempotency receipts — Tier 2.8.
 *
 * Pure function that turns a completed PipelineRun row into a small "what
 * actually happened" summary the pipeline page renders under each step's
 * Run button. Deliberately read-only: the existing PipelineRun.result JSON
 * stays as the raw library return value; this layer projects it into a
 * uniform shape the UI can render the same way for every step.
 *
 * Why "receipt": the user's mental model is "I clicked Run — what did I
 * just buy?" The shape mirrors that — changed/unchanged/skipped — instead
 * of forcing every callsite to remember the lib's bespoke field names.
 */

import type { PipelineRunKind } from "@/app/generated/prisma/client"

export interface Receipt {
  changed: number
  unchanged: number | null
  skipped: number | null
  /** Short human-readable line. e.g. "536 normalized · 0 left to do". */
  summary: string
  durationMs: number
  finishedAt: Date
}

interface RunInput {
  kind: PipelineRunKind
  status: string
  startedAt: Date | string
  finishedAt: Date | string | null
  result: unknown
}

interface ReceiptCtx {
  /** Total non-duplicate transactions for the year. Optional — used when the
   *  raw result doesn't carry it (e.g. the pairing functions). */
  totalTx?: number
}

export function buildReceipt(run: RunInput, ctx: ReceiptCtx = {}): Receipt | null {
  if (run.status !== "DONE" || !run.finishedAt) return null

  const startedAt = run.startedAt instanceof Date ? run.startedAt : new Date(run.startedAt)
  const finishedAt =
    run.finishedAt instanceof Date ? run.finishedAt : new Date(run.finishedAt)
  const durationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime())

  const result = (run.result ?? {}) as Record<string, unknown>
  const totalTx = ctx.totalTx ?? null

  switch (run.kind) {
    case "NORMALIZE_MERCHANTS": {
      const updated = num(result.updated)
      const unchanged = totalTx != null ? Math.max(0, totalTx - updated) : null
      return {
        changed: updated,
        unchanged,
        skipped: null,
        summary:
          updated === 0
            ? "No changes — every merchant was already normalized."
            : `${updated} merchant${updated === 1 ? "" : "s"} normalized`,
        durationMs,
        finishedAt,
      }
    }

    case "MATCH_TRANSFERS":
    case "MATCH_PAYMENTS":
    case "MATCH_REFUNDS": {
      const paired = num(result.paired)
      const stopItemsCreated = num(result.stopItemsCreated, 0)
      return {
        changed: paired,
        unchanged: null,
        skipped: stopItemsCreated > 0 ? stopItemsCreated : null,
        summary:
          paired === 0
            ? "No new pairs found."
            : `${paired} pair${paired === 1 ? "" : "s"} matched${stopItemsCreated > 0 ? ` · ${stopItemsCreated} STOP${stopItemsCreated === 1 ? "" : "s"} raised` : ""}`,
        durationMs,
        finishedAt,
      }
    }

    case "MERCHANT_AI": {
      const rulesCreated = num(result.rulesCreated)
      const stopsGenerated = num(result.stopsGenerated, 0)
      const merchantsProcessed = num(result.merchantsProcessed)
      return {
        changed: rulesCreated,
        unchanged: Math.max(0, merchantsProcessed - rulesCreated - stopsGenerated),
        skipped: stopsGenerated > 0 ? stopsGenerated : null,
        summary:
          rulesCreated === 0
            ? "No new merchant rules created."
            : `${rulesCreated} rule${rulesCreated === 1 ? "" : "s"} created · ${merchantsProcessed} merchant${merchantsProcessed === 1 ? "" : "s"} reviewed${stopsGenerated > 0 ? ` · ${stopsGenerated} STOP${stopsGenerated === 1 ? "" : "s"}` : ""}`,
        durationMs,
        finishedAt,
      }
    }

    case "APPLY_RULES": {
      const classified = num(result.classified)
      const tripOverrides = num(result.tripOverrides, 0)
      const skipped = num(result.skipped, 0)
      const stopsFromAssertionsCreated = num(result.stopsFromAssertionsCreated, 0)
      return {
        changed: classified,
        unchanged: skipped,
        skipped: stopsFromAssertionsCreated > 0 ? stopsFromAssertionsCreated : null,
        summary:
          classified === 0
            ? "No changes — every transaction already had a current classification."
            : `${classified} classified${tripOverrides > 0 ? ` · ${tripOverrides} trip override${tripOverrides === 1 ? "" : "s"}` : ""}${skipped > 0 ? ` · ${skipped} skipped` : ""}`,
        durationMs,
        finishedAt,
      }
    }

    case "RESIDUAL_AI": {
      const classified = num(result.classified)
      const escalated = num(result.escalated)
      const candidates = num(result.candidates)
      return {
        changed: classified,
        unchanged: Math.max(0, candidates - classified - escalated),
        skipped: escalated > 0 ? escalated : null,
        summary:
          candidates === 0
            ? "No residual candidates found."
            : `${classified} classified${escalated > 0 ? ` · ${escalated} escalated to STOPs` : ""} of ${candidates} candidate${candidates === 1 ? "" : "s"}`,
        durationMs,
        finishedAt,
      }
    }

    case "BULK_CLASSIFY": {
      const autoApplied = num(result.autoApplied)
      const stopsCreated = num(result.stopsCreated)
      const processed = num(result.processed)
      return {
        changed: autoApplied,
        unchanged: Math.max(0, processed - autoApplied - stopsCreated),
        skipped: stopsCreated > 0 ? stopsCreated : null,
        summary:
          processed === 0
            ? "No NEEDS_CONTEXT rows to classify."
            : `${autoApplied} auto-applied${stopsCreated > 0 ? ` · ${stopsCreated} STOP${stopsCreated === 1 ? "" : "s"} created` : ""} of ${processed}`,
        durationMs,
        finishedAt,
      }
    }

    case "AUTO_RESOLVE_STOPS": {
      const resolved = num(result.resolved)
      const skipped = num(result.skipped)
      const errors = num(result.errors)
      return {
        changed: resolved,
        unchanged: null,
        skipped: skipped + errors,
        summary:
          resolved === 0 && skipped === 0
            ? "No pending STOPs to resolve."
            : `${resolved} resolved${skipped > 0 ? ` · ${skipped} below confidence` : ""}${errors > 0 ? ` · ${errors} error${errors === 1 ? "" : "s"}` : ""}`,
        durationMs,
        finishedAt,
      }
    }

    case "EXTRACT_REPASS": {
      const reExtracted = num(result.reExtracted ?? result.imports ?? result.processed)
      return {
        changed: reExtracted,
        unchanged: null,
        skipped: null,
        summary:
          reExtracted === 0
            ? "No low-confidence imports found."
            : `${reExtracted} import${reExtracted === 1 ? "" : "s"} re-extracted`,
        durationMs,
        finishedAt,
      }
    }

    case "CPA_AGENT": {
      const rowsClassified = num(result.rowsClassified)
      const rowsConsidered = num(result.rowsConsidered)
      const rowsLeftAsPersonal = num(result.rowsLeftAsPersonal, 0)
      return {
        changed: rowsClassified,
        unchanged: Math.max(0, rowsConsidered - rowsClassified),
        skipped: rowsLeftAsPersonal > 0 ? rowsLeftAsPersonal : null,
        summary:
          rowsConsidered === 0
            ? "No transactions to classify."
            : `${rowsClassified} classified${rowsLeftAsPersonal > 0 ? ` · ${rowsLeftAsPersonal} left as PERSONAL` : ""} of ${rowsConsidered}`,
        durationMs,
        finishedAt,
      }
    }

    default: {
      // Fallback for kinds added later — show a generic summary so the UI
      // doesn't lie. Better than throwing here, since the receipt is purely
      // informational.
      return {
        changed: 0,
        unchanged: null,
        skipped: null,
        summary: `${run.kind} completed`,
        durationMs,
        finishedAt,
      }
    }
  }
}

/** Format a duration as "1h 4m" / "27s" / "350ms" — used for the "ran 2m ago" trailer. */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  const totalSec = Math.round(ms / 1000)
  if (totalSec < 60) return `${totalSec}s`
  const m = Math.floor(totalSec / 60)
  const s = totalSec % 60
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`
  const h = Math.floor(m / 60)
  const remM = m % 60
  return remM > 0 ? `${h}h ${remM}m` : `${h}h`
}

/** Format a date as "2m ago" / "3h ago" / "Mar 5". */
export function formatRelative(when: Date, now: Date = new Date()): string {
  const ms = now.getTime() - when.getTime()
  if (ms < 60_000) return "just now"
  const min = Math.round(ms / 60_000)
  if (min < 60) return `${min}m ago`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h ago`
  const days = Math.round(hr / 24)
  if (days < 7) return `${days}d ago`
  return when.toISOString().slice(0, 10)
}

function num(value: unknown, fallback: number = 0): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return fallback
}
