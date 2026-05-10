/**
 * TaxLens v2 — pure formatting + status helpers.
 *
 * IMPORTANT: this file has NO "use client" directive. It must remain importable
 * from server components — they can call these functions during SSR. The
 * companion file `primitives.tsx` is `"use client"` because it ships interactive
 * components (Switch, Drawer, Banner with form actions, etc.); marking that file
 * client makes ALL its exports client-only, so functions called from server
 * components must live here.
 */

// ───────── Format helpers ────────────────────────────────────────────
// Currency + number formatting moved to lib/format/currency.ts (B-01).
// Re-exported here so existing v2-component imports keep working.

export { fmtUSD, fmtNum, fmtUSDFromCents } from "@/lib/format/currency"

export function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—"
  const dt = typeof d === "string" ? new Date(d) : d
  return dt.toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" })
}

export function fmtDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—"
  const dt = typeof d === "string" ? new Date(d) : d
  return dt.toLocaleString("en-US", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false })
}

export function relTime(d: Date | string | null | undefined): string {
  if (!d) return "—"
  const ms = Date.now() - new Date(d).getTime()
  const m = Math.floor(ms / 60000)
  const h = Math.floor(ms / 3600000)
  const days = Math.floor(ms / 86400000)
  if (m < 1) return "just now"
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (days < 30) return `${days}d ago`
  return fmtDate(d)
}

// ───────── Avatar helpers ────────────────────────────────────────────

export function avatarHue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
}

// ───────── Status / stage mappers ────────────────────────────────────

export type StatusKey =
  | "CREATED" | "INGESTION" | "CLASSIFICATION" | "REVIEW" | "LOCKED" | "ARCHIVED"
  | "BLOCKER" | "PENDING" | "READY" | "DEADLINE"
  | "OPEN" | "ANSWERED" | "RESOLVED" | "DEFERRED"
  | "active" | "inactive"
  | "LOW" | "MODERATE" | "HIGH" | "CRITICAL"

/** Map a TaxYear status string to a Pill key. */
export function statusKey(status: string): StatusKey {
  // CLASSIFICATION was missing from this allowlist — meaning every Pill that
  // routed through statusKey rendered as CREATED for years actively being
  // classified. Spotted on /clients on the post-B-02 deploy: the row pill
  // said "CREATED" while the breadcrumb said "CLASSIFICATION".
  if (
    status === "CREATED" ||
    status === "INGESTION" ||
    status === "CLASSIFICATION" ||
    status === "REVIEW" ||
    status === "LOCKED" ||
    status === "ARCHIVED"
  ) {
    return status as StatusKey
  }
  return "CREATED"
}

/** Compute the stage progress for a TaxYear given its status. */
export function stageProgress(status: string): { ingest: number; process: number; review: number; deliver: number } {
  switch (status) {
    case "LOCKED":   return { ingest: 100, process: 100, review: 100, deliver: 100 }
    case "REVIEW":   return { ingest: 100, process: 100, review:  60, deliver:   0 }
    case "INGESTION":return { ingest:  60, process:  20, review:   0, deliver:   0 }
    default:         return { ingest:  10, process:   0, review:   0, deliver:   0 }
  }
}
