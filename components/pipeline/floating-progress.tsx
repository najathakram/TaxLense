"use client"

import type { CSSProperties } from "react"

const PHASE_LABELS: Record<string, string> = {
  normalize_merchants: "Normalizing merchants",
  match_transfers: "Matching transfers",
  match_payments: "Matching card payments",
  match_refunds: "Matching refunds",
  merchant_ai: "Classifying merchants (Sonnet)",
  apply_rules: "Applying rules",
  residual_ai: "Reviewing residual transactions (Sonnet)",
  bulk_classify: "Bulk classifying (Sonnet)",
  auto_resolve_stops: "Auto-resolving STOPs (Sonnet)",
  cpa_agent: "Running autonomous CPA agent",
}

const PHASE_TONE: Record<string, string> = {
  normalize_merchants: "var(--tl-fg-3, #94a3b8)",
  match_transfers: "var(--tl-fg-3, #94a3b8)",
  match_payments: "var(--tl-fg-3, #94a3b8)",
  match_refunds: "var(--tl-fg-3, #94a3b8)",
  apply_rules: "var(--tl-accent-2, #5fd4b1)",
  merchant_ai: "var(--tl-accent, #7aa6ff)",
  residual_ai: "var(--tl-accent, #7aa6ff)",
  bulk_classify: "var(--tl-accent, #7aa6ff)",
  auto_resolve_stops: "var(--tl-accent, #7aa6ff)",
  cpa_agent: "var(--tl-accent, #7aa6ff)",
}

export interface FloatingProgressProps {
  /** When null, the panel is hidden. */
  active: { runId: string; label: string } | null
  /** Latest progress payload from the PipelineRun row. */
  progress: { phase?: string; processed?: number; total?: number; label?: string } | null
  /** Set when status === FAILED so the user sees the failure inline. */
  errorMessage?: string | null
  /** Recent results — last 3 lines pinned so the user has visible feedback after a quick run. */
  recentResults?: Array<{ ok: boolean; label: string; detail: string }>
}

export function FloatingProgress({ active, progress, errorMessage, recentResults }: FloatingProgressProps) {
  if (!active && !errorMessage && (!recentResults || recentResults.length === 0)) {
    return null
  }

  const phase = (progress?.phase ?? "").toLowerCase()
  const phaseLabel = PHASE_LABELS[phase] ?? active?.label ?? "Working"
  const tone = PHASE_TONE[phase] ?? "var(--tl-accent, #7aa6ff)"
  const total = progress?.total ?? 0
  const processed = Math.min(progress?.processed ?? 0, total)
  const pct = total > 0 ? Math.round((processed / total) * 100) : null
  const detail = progress?.label

  return (
    <div
      style={{
        position: "fixed",
        right: 24,
        bottom: 24,
        width: 360,
        maxWidth: "calc(100vw - 48px)",
        zIndex: 9999,
        borderRadius: 14,
        background: "rgba(20, 24, 34, 0.94)",
        backdropFilter: "blur(14px) saturate(160%)",
        border: "1px solid rgba(255,255,255,0.08)",
        boxShadow: "0 12px 48px rgba(0,0,0,0.45), inset 0 1px 0 rgba(255,255,255,0.06)",
        color: "rgba(248,250,252,0.96)",
        padding: 16,
        fontFamily: "var(--sans, system-ui)",
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
          {active ? (
            <span style={{ ...spinnerStyle, borderTopColor: tone }} aria-label="Working" />
          ) : errorMessage ? (
            <span style={{ ...iconStyle, color: "var(--tl-red, #ff6b6b)" }}>!</span>
          ) : (
            <span style={{ ...iconStyle, color: "var(--tl-green, #34c98a)" }}>✓</span>
          )}
          <span style={{ fontWeight: 700, fontSize: 13, letterSpacing: -0.1, color: tone, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {active ? phaseLabel : errorMessage ? "Run failed" : "Last run completed"}
          </span>
        </div>
        {active && pct !== null && (
          <span className="num" style={{ fontFamily: "var(--mono, monospace)", fontSize: 12, color: "rgba(248,250,252,0.7)" }}>
            {pct}%
          </span>
        )}
      </div>

      {active && (
        <>
          <div
            style={{
              height: 6,
              borderRadius: 999,
              background: "rgba(255,255,255,0.06)",
              overflow: "hidden",
              marginTop: 12,
              position: "relative",
            }}
          >
            {pct === null ? (
              <span
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "30%",
                  background: `linear-gradient(90deg, transparent, ${tone}, transparent)`,
                  animation: "tl-progress-indet 1.2s linear infinite",
                }}
              />
            ) : (
              <span
                style={{
                  display: "block",
                  height: "100%",
                  width: `${pct}%`,
                  background: `linear-gradient(90deg, ${tone} 0%, color-mix(in srgb, ${tone} 70%, white) 100%)`,
                  transition: "width 200ms ease-out",
                }}
              />
            )}
          </div>
          {detail && (
            <div
              className="mono"
              style={{
                marginTop: 10,
                fontSize: 11,
                fontFamily: "var(--mono, monospace)",
                color: "rgba(248,250,252,0.62)",
                lineHeight: 1.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={detail}
            >
              {detail}
            </div>
          )}
          {total > 0 && (
            <div className="mono" style={{ marginTop: 4, fontSize: 10, fontFamily: "var(--mono, monospace)", color: "rgba(248,250,252,0.45)" }}>
              {processed} / {total}
            </div>
          )}
        </>
      )}

      {!active && errorMessage && (
        <div
          className="mono"
          style={{
            marginTop: 10,
            fontSize: 11,
            fontFamily: "var(--mono, monospace)",
            color: "var(--tl-red, #ff6b6b)",
            lineHeight: 1.5,
            wordBreak: "break-word",
          }}
        >
          {errorMessage}
        </div>
      )}

      {!active && !errorMessage && recentResults && recentResults.length > 0 && (
        <div style={{ marginTop: 12, display: "grid", gap: 4 }}>
          {recentResults.slice(-3).map((r, i) => (
            <div
              key={i}
              className="mono"
              style={{
                fontSize: 11,
                fontFamily: "var(--mono, monospace)",
                color: r.ok ? "var(--tl-green, #34c98a)" : "var(--tl-red, #ff6b6b)",
                lineHeight: 1.5,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
              title={r.detail}
            >
              {r.ok ? "✓" : "✗"} {r.label}
            </div>
          ))}
        </div>
      )}

      <style>{`
        @keyframes tl-progress-indet {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  )
}

const spinnerStyle: CSSProperties = {
  display: "inline-block",
  width: 14,
  height: 14,
  borderRadius: "50%",
  border: "2px solid rgba(255,255,255,0.12)",
  borderTopColor: "currentColor",
  animation: "tl-spin 0.9s linear infinite",
  flexShrink: 0,
}

const iconStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 14,
  height: 14,
  borderRadius: "50%",
  background: "rgba(255,255,255,0.06)",
  fontSize: 10,
  fontWeight: 700,
  flexShrink: 0,
}
