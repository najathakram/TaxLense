// @vitest-environment jsdom
/**
 * Session 5 — Ledger virtualization perf test
 *
 * Renders a minimal virtualized table with 2000 rows and asserts that
 * TanStack Virtual keeps the DOM row count small and initial render
 * stays under budget. Mirrors the structure used by LedgerClient.
 *
 * We don't import LedgerClient here because its server-action imports
 * pull in next-auth, which requires a Next.js runtime at test time.
 */

import { describe, it, expect } from "vitest"
import { render, cleanup } from "@testing-library/react"
import "@testing-library/jest-dom/vitest"
import { useRef } from "react"
import { useVirtualizer } from "@tanstack/react-virtual"

interface Row {
  id: string
  date: string
  merchant: string
  amount: number
}

function synthRows(n: number): Row[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `tx_${i}`,
    date: `2025-${String((i % 12) + 1).padStart(2, "0")}-01`,
    merchant: `MERCHANT ${i}`,
    amount: 100 + i,
  }))
}

function VirtualList({ rows }: { rows: Row[] }) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
  })
  return (
    <div ref={scrollRef} style={{ height: 600, overflow: "auto" }}>
      <div style={{ height: virtualizer.getTotalSize(), position: "relative" }}>
        {virtualizer.getVirtualItems().map((v) => {
          const r = rows[v.index]!
          return (
            <div
              key={r.id}
              data-testid="ledger-row"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: v.size,
                transform: `translateY(${v.start}px)`,
              }}
            >
              {r.date} {r.merchant} ${r.amount}
            </div>
          )
        })}
      </div>
    </div>
  )
}

describe("Ledger virtualization perf", () => {
  it("renders 2000 synthetic rows with DOM under 200 row nodes", () => {
    const rows = synthRows(2000)
    const start = performance.now()
    const { container } = render(<VirtualList rows={rows} />)
    const elapsed = performance.now() - start

    const rowEls = container.querySelectorAll('[data-testid="ledger-row"]')
    expect(rowEls.length).toBeLessThan(200)
    expect(elapsed).toBeLessThan(2000)

    cleanup()
  })
})
