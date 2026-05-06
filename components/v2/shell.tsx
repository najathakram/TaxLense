/**
 * TaxLens v2 shell — TopBar + Sidebar + ContextBar.
 * Used by app/(app)/layout.tsx and app/(admin)/layout.tsx.
 */
"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import type { CSSProperties, ReactNode } from "react"
import { Avi } from "./primitives"

// ───────── TopBar ─────────────────────────────────────────────────────

interface TopBarProps {
  /** Logged-in user's display name */
  userName: string
  /** Logged-in user's email */
  userEmail: string
  /** Tier of the logged-in user — drives badge color & search placeholder */
  tier: "ADMIN" | "CPA" | "CLIENT"
  /** True when admin is currently impersonating a CPA */
  impersonatingCpa?: boolean
  /** Logo link target */
  logoHref: string
}

export function TopBar({ userName, userEmail, tier, impersonatingCpa, logoHref }: TopBarProps) {
  const isAdmin = tier === "ADMIN"
  const pillColor = isAdmin ? "var(--tl-purple)" : impersonatingCpa ? "var(--tl-amber)" : "var(--fg-3)"
  const pillLabel = isAdmin ? "SUPER ADMIN" : impersonatingCpa ? "CPA · IMPERSONATED" : tier
  return (
    <header
      style={{
        display: "flex",
        alignItems: "center",
        height: 56,
        padding: "0 18px",
        gap: 14,
        flexShrink: 0,
        position: "relative",
        zIndex: 5,
        borderBottom: "1px solid var(--hairline)",
        background: "rgba(11,13,18,0.55)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
      }}
    >
      <Link href={logoHref} style={{ display: "flex", alignItems: "center", gap: 10, textDecoration: "none", color: "inherit" }}>
        <div
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            background: "linear-gradient(135deg, #7aa6ff 0%, #c39bff 100%)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontWeight: 800,
            color: "#0a1428",
            fontSize: 15,
            boxShadow: "0 4px 14px rgba(122,166,255,0.4), inset 0 1px 0 rgba(255,255,255,0.4)",
          }}
        >
          T
        </div>
        <span style={{ fontSize: 16, fontWeight: 700, letterSpacing: -0.3 }}>TaxLens</span>
      </Link>
      <div
        className="glass"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "7px 14px",
          flex: 1,
          maxWidth: 520,
          borderRadius: 999,
          marginLeft: 12,
        }}
      >
        <span style={{ color: "var(--fg-3)" }}>⌕</span>
        <span style={{ fontSize: 13, color: "var(--fg-3)", flex: 1 }}>
          {isAdmin ? "Search CPAs, clients, audit events…" : "Search clients, years, documents…"}
        </span>
        <span
          style={{
            fontFamily: "var(--mono)",
            fontSize: 10,
            padding: "2px 7px",
            borderRadius: 6,
            background: "rgba(255,255,255,0.06)",
            color: "var(--fg-2)",
          }}
        >
          ⌘K
        </span>
      </div>
      <div style={{ flex: 1 }} />
      <div
        className="glass"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "5px 14px 5px 6px",
          borderRadius: 999,
          ...(isAdmin
            ? { borderColor: "rgba(195,155,255,0.4)", background: "rgba(195,155,255,0.08)" }
            : impersonatingCpa
            ? { borderColor: "rgba(244,196,81,0.4)", background: "rgba(244,196,81,0.08)" }
            : {}),
        }}
      >
        <Avi name={userName} email={userEmail} size={28} />
        <div style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 9, fontWeight: 600, letterSpacing: 1.2, color: pillColor }}>{pillLabel}</div>
          <div style={{ fontSize: 13, fontWeight: 600 }}>{userName}</div>
        </div>
      </div>
    </header>
  )
}

// ───────── Sidebar ────────────────────────────────────────────────────

export interface SidebarItem {
  label: ReactNode
  href: string
  badge?: ReactNode | { text: ReactNode; color: string; bg: string }
  accent?: string
  indent?: number
  active?: boolean
}

export interface SidebarGroup {
  label?: ReactNode
  items: SidebarItem[]
}

export function Sidebar({ groups, footerEmail, signOutAction }: {
  groups: SidebarGroup[]
  footerEmail: string
  signOutAction: () => Promise<void>
}) {
  const pathname = usePathname() ?? ""
  return (
    <aside
      style={{
        width: 248,
        flexShrink: 0,
        padding: 12,
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        overflow: "auto",
      }}
    >
      <div
        className="glass-strong"
        style={{ padding: 6, display: "flex", flexDirection: "column", flex: 1, borderRadius: 18 }}
      >
        {groups.map((g, i) => (
          <Group key={i} label={g.label}>
            {g.items.map((it, j) => (
              <SidebarLink key={j} item={it} pathname={pathname} />
            ))}
          </Group>
        ))}
        <div style={{ flex: 1 }} />
        <div
          style={{
            padding: "10px 14px",
            fontSize: 11,
            color: "var(--fg-3)",
            borderTop: "1px solid var(--hairline)",
          }}
        >
          <div className="mono">{footerEmail}</div>
          <form action={signOutAction}>
            <button
              type="submit"
              style={{
                marginTop: 4,
                color: "var(--fg-2)",
                background: "transparent",
                border: 0,
                cursor: "pointer",
                padding: 0,
              }}
            >
              sign out →
            </button>
          </form>
        </div>
      </div>
    </aside>
  )
}

function Group({ label, children }: { label?: ReactNode; children: ReactNode }) {
  return (
    <div style={{ padding: "10px 8px 6px" }}>
      {label && (
        <div
          style={{
            padding: "4px 14px 6px",
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: 1.4,
            color: "var(--fg-3)",
            textTransform: "uppercase",
          }}
        >
          {label}
        </div>
      )}
      {children}
    </div>
  )
}

function SidebarLink({ item, pathname }: { item: SidebarItem; pathname: string }) {
  const active = item.active ?? (pathname === item.href || pathname.startsWith(item.href + "/"))
  const indent = item.indent ?? 0
  const baseStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    width: "100%",
    padding: `8px 12px 8px ${12 + indent * 14}px`,
    borderRadius: 10,
    fontSize: 13,
    fontWeight: 500,
    color: active ? "var(--fg)" : "var(--fg-1)",
    background: active ? "rgba(255,255,255,0.07)" : "transparent",
    transition: "background 160ms ease",
    marginBottom: 1,
    textDecoration: "none",
  }
  return (
    <Link href={item.href} style={baseStyle}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0, overflow: "hidden" }}>
        {item.accent && (
          <span
            style={{
              width: 6,
              height: 6,
              borderRadius: 6,
              background: item.accent,
              flexShrink: 0,
            }}
          />
        )}
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.label}</span>
      </span>
      {item.badge != null && (
        typeof item.badge === "object" && item.badge !== null && "text" in (item.badge as object) ? (
          <span
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 999,
              background: (item.badge as { bg: string }).bg,
              color: (item.badge as { color: string }).color,
              fontWeight: 700,
            }}
          >
            {(item.badge as { text: ReactNode }).text}
          </span>
        ) : (
          <span
            style={{
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.08)",
              color: "var(--fg-1)",
              fontWeight: 700,
            }}
          >
            {item.badge as ReactNode}
          </span>
        )
      )}
    </Link>
  )
}
