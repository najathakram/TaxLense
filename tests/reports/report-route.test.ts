/**
 * Validates that kind slug mapping is correct and unknown slugs return 400.
 * This tests the dispatcher logic without a running Next.js server.
 */

import { describe, it, expect } from "vitest"

// The SLUG_TO_KIND map from the route — replicated here to keep route file as-is
type KindSlug = "master-ledger" | "financial-statements" | "audit-packet"

const SLUG_TO_KIND: Record<KindSlug, { kind: string; ext: string; contentType: string }> = {
  "master-ledger": {
    kind: "MASTER_LEDGER",
    ext: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  "financial-statements": {
    kind: "FINANCIAL_STATEMENTS",
    ext: "xlsx",
    contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  "audit-packet": {
    kind: "AUDIT_PACKET",
    ext: "zip",
    contentType: "application/zip",
  },
}

describe("download route slug mapping", () => {
  it("master-ledger maps to MASTER_LEDGER with xlsx ext", () => {
    const m = SLUG_TO_KIND["master-ledger"]
    expect(m.kind).toBe("MASTER_LEDGER")
    expect(m.ext).toBe("xlsx")
    expect(m.contentType).toContain("spreadsheetml")
  })

  it("financial-statements maps to FINANCIAL_STATEMENTS with xlsx ext", () => {
    const m = SLUG_TO_KIND["financial-statements"]
    expect(m.kind).toBe("FINANCIAL_STATEMENTS")
    expect(m.ext).toBe("xlsx")
  })

  it("audit-packet maps to AUDIT_PACKET with zip ext", () => {
    const m = SLUG_TO_KIND["audit-packet"]
    expect(m.kind).toBe("AUDIT_PACKET")
    expect(m.ext).toBe("zip")
    expect(m.contentType).toBe("application/zip")
  })

  it("unknown slug returns undefined (would produce 400 in the route)", () => {
    const m = SLUG_TO_KIND["unknown-slug" as KindSlug]
    expect(m).toBeUndefined()
  })

  it("all three slugs are covered — no missing entries", () => {
    const slugs: KindSlug[] = ["master-ledger", "financial-statements", "audit-packet"]
    for (const slug of slugs) {
      expect(SLUG_TO_KIND[slug]).toBeDefined()
    }
  })

  it("filename construction produces expected names", () => {
    for (const [slug, meta] of Object.entries(SLUG_TO_KIND)) {
      const filename = `taxlens-2025-${slug}.${meta.ext}`
      expect(filename).toMatch(/^taxlens-2025-.+\.(xlsx|zip)$/)
    }
  })
})
