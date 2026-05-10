"use client"

/**
 * ⌘K / Ctrl+K universal search modal (B-15).
 *
 * Pre-fix: the bar in the top app shell was a `<span>` with no input and no
 * handler. Now it opens a modal that searches clients (CPA tier),
 * tax years, and transactions; each result is keyboard-navigable.
 */

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { search, type SearchResults } from "@/lib/search"
import { fmtUSD } from "@/lib/format/currency"

export function SearchModal({
  isAdmin,
  open: externalOpen,
  onOpenChange,
}: {
  isAdmin: boolean
  /** When provided, the modal is fully controlled and ⌘K listening lives
   *  in the parent. When omitted, the modal manages its own state and
   *  registers a global ⌘K listener itself. */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = externalOpen ?? internalOpen
  const setOpen = (v: boolean) => {
    if (onOpenChange) onOpenChange(v)
    if (externalOpen === undefined) setInternalOpen(v)
  }
  const [q, setQ] = useState("")
  const [results, setResults] = useState<SearchResults>({ clients: [], years: [], transactions: [] })
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const router = useRouter()

  // ⌘K / Ctrl+K opens the modal. Esc closes.
  // Skip the global open-handler if the parent is already listening
  // (externalOpen passed in).
  useEffect(() => {
    if (externalOpen !== undefined) return
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen(true)
      } else if (e.key === "Escape") {
        setOpen(false)
      }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [externalOpen])

  useEffect(() => {
    if (open && inputRef.current) inputRef.current.focus()
  }, [open])

  // Debounced server search.
  useEffect(() => {
    if (!open) return
    if (q.trim().length < 2) {
      setResults({ clients: [], years: [], transactions: [] })
      setActive(0)
      return
    }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const r = await search(q)
        if (!cancelled) {
          setResults(r)
          setActive(0)
        }
      } catch {
        if (!cancelled) setResults({ clients: [], years: [], transactions: [] })
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [q, open])

  const flat = [
    ...results.clients.map((r) => ({ kind: r.kind, key: r.id, href: `/clients/${r.id}`, primary: r.name, secondary: r.email })),
    ...results.years.map((r) => ({ kind: r.kind, key: r.taxYearId, href: `/years/${r.year}`, primary: `${r.year} · ${r.ownerName}`, secondary: r.status })),
    ...results.transactions.map((r) => ({
      kind: r.kind,
      key: r.id,
      href: `/years/${r.year}/ledger?tx=${r.id}`,
      primary: r.merchantNormalized ?? r.merchantRaw,
      secondary: `${r.postedDate} · ${fmtUSD(r.amountNormalized < 0 ? -r.amountNormalized : -r.amountNormalized, { cents: true, signed: true })}${r.code ? ` · ${r.code}` : ""}`,
    })),
  ]

  function commit(idx: number) {
    const item = flat[idx]
    if (!item) return
    setOpen(false)
    setQ("")
    router.push(item.href)
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((a) => Math.min(a + 1, Math.max(0, flat.length - 1)))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === "Enter" && flat.length > 0) {
      e.preventDefault()
      commit(active)
    }
  }

  if (!open) return null

  return (
    <div
      role="dialog"
      aria-label="Search"
      onClick={() => setOpen(false)}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        zIndex: 50,
        display: "flex",
        justifyContent: "center",
        alignItems: "flex-start",
        paddingTop: "10vh",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "70vh",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
          borderRadius: 16,
          background: "var(--bg-1)",
          border: "1px solid var(--hairline)",
          boxShadow: "0 12px 60px rgba(0,0,0,0.4)",
        }}
      >
        <div
          style={{
            padding: "14px 16px",
            display: "flex",
            alignItems: "center",
            gap: 10,
            borderBottom: "1px solid var(--hairline)",
          }}
        >
          <span style={{ color: "var(--fg-3)", fontSize: 16 }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={
              isAdmin
                ? "Search CPAs, clients, years, transactions…"
                : "Search clients, years, transactions…"
            }
            style={{
              flex: 1,
              background: "transparent",
              border: 0,
              outline: 0,
              fontSize: 15,
              color: "var(--fg-1)",
            }}
          />
          <span style={{ fontSize: 11, color: "var(--fg-3)" }}>↵ to open · esc to close</span>
        </div>
        <div style={{ overflowY: "auto", padding: 8 }}>
          {q.trim().length < 2 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
              Type at least 2 characters.
            </div>
          )}
          {q.trim().length >= 2 && flat.length === 0 && (
            <div style={{ padding: 24, textAlign: "center", color: "var(--fg-3)", fontSize: 13 }}>
              No matches.
            </div>
          )}
          {flat.map((item, i) => (
            <button
              key={`${item.kind}:${item.key}`}
              onMouseEnter={() => setActive(i)}
              onClick={() => commit(i)}
              style={{
                display: "flex",
                width: "100%",
                gap: 10,
                padding: "10px 12px",
                borderRadius: 8,
                background: i === active ? "rgba(255,255,255,0.06)" : "transparent",
                border: 0,
                cursor: "pointer",
                textAlign: "left",
                color: "var(--fg-1)",
              }}
            >
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                  color: "var(--fg-3)",
                  textTransform: "uppercase",
                  width: 64,
                  paddingTop: 2,
                  flexShrink: 0,
                }}
              >
                {item.kind === "txn" ? "TXN" : item.kind === "year" ? "YEAR" : "CLIENT"}
              </span>
              <span style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.primary}
                </div>
                <div style={{ fontSize: 11, color: "var(--fg-3)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {item.secondary}
                </div>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
