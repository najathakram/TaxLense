/**
 * TaxLens v2 — UI primitives translated from design-brief/v2-handoff/v2-app.jsx.
 * Bloomberg-meets-iOS aesthetic: translucent glass cards, status pills,
 * progress arcs, segmented controls, iOS toggles.
 *
 * All colors use the CSS vars defined in app/globals.css.
 */
"use client"

import { type CSSProperties, type ReactNode, useMemo } from "react"

// ───────── Status pills ──────────────────────────────────────────────

type StatusKey =
  | "CREATED" | "INGESTION" | "REVIEW" | "LOCKED" | "ARCHIVED"
  | "BLOCKER" | "PENDING" | "READY" | "DEADLINE"
  | "OPEN" | "ANSWERED" | "RESOLVED" | "DEFERRED"
  | "active" | "inactive"
  | "LOW" | "MODERATE" | "HIGH" | "CRITICAL"

const STATUS_MAP: Record<string, { label: string; color: string; bg: string; dot: string }> = {
  CREATED:   { label: "CREATED",   color: "var(--fg-3)",      bg: "rgba(91,98,113,0.18)",   dot: "○" },
  INGESTION: { label: "INGESTION", color: "var(--tl-blue)",   bg: "rgba(122,166,255,0.16)", dot: "◐" },
  REVIEW:    { label: "REVIEW",    color: "var(--tl-amber)",  bg: "rgba(244,196,81,0.14)",  dot: "◑" },
  LOCKED:    { label: "LOCKED",    color: "var(--tl-green)",  bg: "rgba(52,201,138,0.14)",  dot: "●" },
  ARCHIVED:  { label: "ARCHIVED",  color: "var(--fg-3)",      bg: "rgba(91,98,113,0.18)",   dot: "·" },
  BLOCKER:   { label: "BLOCKER",   color: "var(--tl-red)",    bg: "rgba(255,107,107,0.14)", dot: "●" },
  PENDING:   { label: "PENDING",   color: "var(--tl-amber)",  bg: "rgba(244,196,81,0.14)",  dot: "●" },
  READY:     { label: "READY",     color: "var(--tl-green)",  bg: "rgba(52,201,138,0.14)",  dot: "●" },
  DEADLINE:  { label: "DEADLINE",  color: "var(--tl-orange)", bg: "rgba(255,154,87,0.14)",  dot: "◆" },
  OPEN:      { label: "OPEN",      color: "var(--tl-amber)",  bg: "rgba(244,196,81,0.14)",  dot: "●" },
  ANSWERED:  { label: "ANSWERED",  color: "var(--tl-green)",  bg: "rgba(52,201,138,0.14)",  dot: "✓" },
  RESOLVED:  { label: "RESOLVED",  color: "var(--tl-green)",  bg: "rgba(52,201,138,0.14)",  dot: "✓" },
  DEFERRED:  { label: "DEFERRED",  color: "var(--fg-3)",      bg: "rgba(91,98,113,0.18)",   dot: "·" },
  active:    { label: "ACTIVE",    color: "var(--tl-green)",  bg: "rgba(52,201,138,0.14)",  dot: "●" },
  inactive:  { label: "INACTIVE",  color: "var(--fg-3)",      bg: "rgba(91,98,113,0.18)",   dot: "○" },
  LOW:       { label: "LOW",       color: "var(--tl-green)",  bg: "rgba(52,201,138,0.14)",  dot: "●" },
  MODERATE:  { label: "MODERATE",  color: "var(--tl-amber)",  bg: "rgba(244,196,81,0.14)",  dot: "●" },
  HIGH:      { label: "HIGH",      color: "var(--tl-orange)", bg: "rgba(255,154,87,0.14)",  dot: "●" },
  CRITICAL:  { label: "CRITICAL",  color: "var(--tl-red)",    bg: "rgba(255,107,107,0.14)", dot: "●" },
}

export function Pill({ s, children }: { s: StatusKey | string; children?: ReactNode }) {
  const m = STATUS_MAP[s] ?? { color: "var(--fg-2)", bg: "rgba(255,255,255,0.06)", dot: "·", label: String(s) }
  return (
    <span className="tl-pill" style={{ color: m.color, background: m.bg }}>
      <span style={{ fontSize: 10 }}>{m.dot}</span>
      {children ?? m.label}
    </span>
  )
}

// ───────── Risk score bar ────────────────────────────────────────────

export function Risk({ score }: { score: number | null | undefined }) {
  if (score == null || score === 0) return <span style={{ color: "var(--fg-3)" }}>—</span>
  const c =
    score <= 5 ? "var(--tl-green)"
    : score <= 10 ? "var(--tl-amber)"
    : score <= 20 ? "var(--tl-orange)"
    : "var(--tl-red)"
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 32, height: 4, borderRadius: 999, background: "rgba(255,255,255,0.08)", position: "relative" }}>
        <span style={{ position: "absolute", inset: 0, width: `${Math.min(100, score * 4)}%`, background: c, borderRadius: 999 }} />
      </span>
      <span className="num" style={{ color: c, fontWeight: 600, fontSize: 12 }}>{score}</span>
    </span>
  )
}

// ───────── Avatar ────────────────────────────────────────────────────

function avatarHue(s: string): number {
  let h = 0
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return h % 360
}
function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
}

export function Avi({ name, email, size = 28 }: { name: string; email?: string; size?: number }) {
  const hue = avatarHue(email ?? name)
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: size,
        height: size,
        borderRadius: size,
        background: `linear-gradient(135deg, oklch(0.46 0.10 ${hue}), oklch(0.32 0.08 ${(hue + 30) % 360}))`,
        color: "white",
        fontSize: Math.round(size * 0.36),
        fontWeight: 700,
        letterSpacing: 0.4,
        flexShrink: 0,
        boxShadow: "0 2px 6px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.18)",
      }}
    >
      {initials(name)}
    </span>
  )
}

// ───────── Button ────────────────────────────────────────────────────

type BtnKind = "default" | "primary" | "ghost" | "purple" | "danger" | "accent2"

export function Btn({
  children,
  kind = "default",
  onClick,
  disabled,
  icon,
  style,
  size = "md",
  type,
  asChild,
}: {
  children: ReactNode
  kind?: BtnKind
  onClick?: (e: React.MouseEvent) => void
  disabled?: boolean
  icon?: ReactNode
  style?: CSSProperties
  size?: "sm" | "md"
  type?: "button" | "submit"
  asChild?: boolean
}) {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: size === "sm" ? "5px 11px" : "7px 14px",
    fontSize: size === "sm" ? 12 : 13,
    fontWeight: 600,
    borderRadius: 999,
    transition: "all 160ms ease",
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    border: "0",
  }
  const skins: Record<BtnKind, CSSProperties> = {
    default: { background: "rgba(255,255,255,0.08)", color: "var(--fg)", border: "1px solid var(--hairline)" },
    primary: {
      background: "linear-gradient(180deg, #8fb6ff 0%, #6f9bff 100%)",
      color: "#0a1428",
      boxShadow: "0 4px 12px rgba(122,166,255,0.35), inset 0 1px 0 rgba(255,255,255,0.4)",
    },
    ghost:   { background: "transparent", color: "var(--fg-1)" },
    purple:  { background: "rgba(195,155,255,0.14)", color: "var(--tl-purple)", border: "1px solid rgba(195,155,255,0.32)" },
    danger:  { background: "rgba(255,107,107,0.14)", color: "var(--tl-red)",    border: "1px solid rgba(255,107,107,0.32)" },
    accent2: { background: "rgba(95,212,177,0.12)",  color: "var(--tl-accent-2)", border: "1px solid rgba(95,212,177,0.28)" },
  }
  return (
    <button
      type={type ?? "button"}
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...skins[kind], ...style }}
    >
      {icon}
      {children}
    </button>
  )
}

// ───────── Tag ───────────────────────────────────────────────────────

export function Tag({ children, color = "var(--fg-2)" }: { children: ReactNode; color?: string }) {
  return (
    <span
      style={{
        fontFamily: "var(--mono)",
        fontSize: 10,
        padding: "2px 8px",
        borderRadius: 999,
        background: "rgba(255,255,255,0.05)",
        color,
        border: `1px solid ${color}33`,
      }}
    >
      {children}
    </span>
  )
}

// ───────── Card (glass) ──────────────────────────────────────────────

export function Card({
  children,
  style,
  pad = 18,
  hoverable = false,
  onClick,
  className,
}: {
  children: ReactNode
  style?: CSSProperties
  pad?: number
  hoverable?: boolean
  onClick?: (e: React.MouseEvent) => void
  className?: string
}) {
  return (
    <div
      onClick={onClick}
      className={`glass${className ? " " + className : ""}`}
      style={{
        padding: pad,
        ...(hoverable ? { cursor: "pointer", transition: "transform 200ms ease, box-shadow 200ms ease" } : {}),
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// ───────── Section ───────────────────────────────────────────────────

export function Section({
  title,
  sub,
  right,
  children,
  pad = true,
}: {
  title?: ReactNode
  sub?: ReactNode
  right?: ReactNode
  children: ReactNode
  pad?: boolean
}) {
  return (
    <section className="fade-up" style={{ padding: pad ? "20px 28px 8px" : 0 }}>
      {(title || right) && (
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", marginBottom: 14 }}>
          <div>
            {sub && (
              <div
                style={{
                  fontFamily: "var(--mono)",
                  fontSize: 10,
                  color: "var(--fg-3)",
                  letterSpacing: 1.6,
                  textTransform: "uppercase",
                  marginBottom: 3,
                }}
              >
                {sub}
              </div>
            )}
            {title && <h2 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: -0.2 }}>{title}</h2>}
          </div>
          {right && <div style={{ display: "flex", gap: 8, alignItems: "center" }}>{right}</div>}
        </header>
      )}
      {children}
    </section>
  )
}

// ───────── KPI card ──────────────────────────────────────────────────

export function KPI({
  label,
  value,
  sub,
  accent,
}: {
  label: ReactNode
  value: ReactNode
  sub?: ReactNode
  accent?: string
}) {
  return (
    <Card pad={16} style={{ minWidth: 0, flex: 1 }}>
      <div
        style={{
          fontSize: 11,
          color: "var(--fg-3)",
          fontWeight: 600,
          letterSpacing: 0.3,
          textTransform: "uppercase",
          marginBottom: 6,
        }}
      >
        {label}
      </div>
      <div
        className="num"
        style={{
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: -0.5,
          color: accent ?? "var(--fg)",
          lineHeight: 1.1,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ fontSize: 11, color: "var(--fg-3)", marginTop: 4 }}>{sub}</div>}
    </Card>
  )
}

// ───────── Switch ────────────────────────────────────────────────────

export function Switch({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      className={`tl-switch ${on ? "on" : ""}`}
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
    />
  )
}

// ───────── Segmented control ─────────────────────────────────────────

export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ id: T; label: string; badge?: ReactNode }>
  onChange: (id: T) => void
}) {
  return (
    <div className="tl-seg">
      {options.map((o) => (
        <button key={o.id} className={value === o.id ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.label}
          {o.badge != null && <span style={{ marginLeft: 6, fontSize: 10, opacity: 0.7 }}>{o.badge}</span>}
        </button>
      ))}
    </div>
  )
}

// ───────── Progress arc ──────────────────────────────────────────────

export function ProgressArc({ pct, size = 56, label }: { pct: number; size?: number; label?: ReactNode }) {
  const r = (size - 8) / 2
  const c = 2 * Math.PI * r
  const off = c * (1 - pct / 100)
  const color = pct === 100 ? "var(--tl-green)" : pct >= 60 ? "var(--tl-accent)" : "var(--tl-amber)"
  return (
    <div style={{ position: "relative", width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.08)" strokeWidth={4} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={4}
          fill="none"
          strokeDasharray={c}
          strokeDashoffset={off}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 600ms ease" }}
        />
      </svg>
      <div
        style={{
          position: "absolute",
          inset: 0,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 11,
          fontWeight: 700,
          fontFamily: "var(--mono)",
          color,
        }}
      >
        {label ?? `${pct}%`}
      </div>
    </div>
  )
}

// ───────── Format helpers ────────────────────────────────────────────

export function fmtUSD(n: number | null | undefined, opts: { cents?: boolean } = {}): string {
  if (n == null || isNaN(n)) return "—"
  const sign = n < 0 ? "-" : ""
  const abs = Math.abs(n)
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: opts.cents ? 2 : 0,
    maximumFractionDigits: opts.cents ? 2 : 0,
  })
  return `${sign}$${s}`
}

export function fmtNum(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US")
}

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

// ───────── Drawer ────────────────────────────────────────────────────

export function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: ReactNode
  children: ReactNode
}) {
  if (!open) return null
  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        backdropFilter: "blur(6px)",
        WebkitBackdropFilter: "blur(6px)",
        zIndex: 50,
        animation: "fadeUp 200ms",
      }}
    >
      <aside
        onClick={(e) => e.stopPropagation()}
        className="glass-strong"
        style={{
          position: "absolute",
          right: 14,
          top: 14,
          bottom: 14,
          width: 460,
          borderRadius: 18,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--hairline)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700 }}>{title}</div>
          <button
            onClick={onClose}
            style={{
              width: 30,
              height: 30,
              borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              border: 0,
              cursor: "pointer",
              color: "var(--fg)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
            }}
          >
            ✕
          </button>
        </div>
        <div style={{ flex: 1, overflow: "auto" }}>{children}</div>
      </aside>
    </div>
  )
}

// ───────── Banner (impersonation) ────────────────────────────────────

export function Banner({
  tone,
  children,
  exitAction,
  exitLabel,
}: {
  tone: "admin" | "cpa"
  children: ReactNode
  exitAction: string | (() => Promise<void> | void)
  exitLabel: string
}) {
  const isAdmin = tone === "admin"
  const c = isAdmin ? "var(--tl-purple)" : "var(--tl-amber)"
  const bg = isAdmin
    ? "linear-gradient(90deg, rgba(195,155,255,0.18), rgba(195,155,255,0.08))"
    : "linear-gradient(90deg, rgba(244,196,81,0.18), rgba(244,196,81,0.08))"
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "8px 22px",
        background: bg,
        borderBottom: `1px solid ${isAdmin ? "rgba(195,155,255,0.22)" : "rgba(244,196,81,0.22)"}`,
        fontSize: 12,
        color: c,
        fontWeight: 600,
        letterSpacing: 0.2,
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span
          className="tl-pill"
          style={{
            background: isAdmin ? "rgba(195,155,255,0.16)" : "rgba(244,196,81,0.16)",
            color: c,
            border: `1px solid ${isAdmin ? "rgba(195,155,255,0.4)" : "rgba(244,196,81,0.4)"}`,
            fontSize: 10,
            letterSpacing: 1.2,
          }}
        >
          {isAdmin ? "◆ ADMIN" : "● CPA"}
        </span>
        <span>{children}</span>
      </div>
      {typeof exitAction === "string" ? (
        <a
          href={exitAction}
          className="tl-pill"
          style={{
            background: "rgba(0,0,0,0.2)",
            color: c,
            border: `1px solid ${isAdmin ? "rgba(195,155,255,0.4)" : "rgba(244,196,81,0.4)"}`,
            fontSize: 11,
            padding: "4px 12px",
            cursor: "pointer",
            textDecoration: "none",
          }}
        >
          {exitLabel}
        </a>
      ) : (
        <BannerExit action={exitAction} color={c} isAdmin={isAdmin}>
          {exitLabel}
        </BannerExit>
      )}
    </div>
  )
}

function BannerExit({
  action,
  color,
  isAdmin,
  children,
}: {
  action: () => Promise<void> | void
  color: string
  isAdmin: boolean
  children: ReactNode
}) {
  return (
    <form action={action as unknown as string}>
      <button
        type="submit"
        className="tl-pill"
        style={{
          background: "rgba(0,0,0,0.2)",
          color,
          border: `1px solid ${isAdmin ? "rgba(195,155,255,0.4)" : "rgba(244,196,81,0.4)"}`,
          fontSize: 11,
          padding: "4px 12px",
          cursor: "pointer",
        }}
      >
        {children}
      </button>
    </form>
  )
}

// ───────── Misc helpers ──────────────────────────────────────────────

export { initials, avatarHue }

/** Map a TaxYear status to a Pill key. */
export function statusKey(status: string): StatusKey {
  if (status === "CREATED" || status === "INGESTION" || status === "REVIEW" || status === "LOCKED" || status === "ARCHIVED") {
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

// Tiny no-op so `useMemo` import isn't dropped — it'll be useful for downstream files.
export function _voidUseMemo() {
  // eslint-disable-next-line react-hooks/rules-of-hooks
  return useMemo(() => null, [])
}
