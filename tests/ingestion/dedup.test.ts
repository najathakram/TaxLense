/**
 * TaxLens — Deduplication helper tests
 */

import { describe, it, expect } from "vitest"
import { fileHash, transactionKey } from "@/lib/parsers/dedup"

describe("fileHash", () => {
  it("returns a 64-char hex string (SHA-256)", () => {
    const buf = Buffer.from("hello world")
    const hash = fileHash(buf)
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("same bytes → same hash", () => {
    const buf = Buffer.from("test content")
    expect(fileHash(buf)).toBe(fileHash(buf))
  })

  it("different bytes → different hash", () => {
    const a = fileHash(Buffer.from("content a"))
    const b = fileHash(Buffer.from("content b"))
    expect(a).not.toBe(b)
  })
})

describe("transactionKey", () => {
  const accountId = "acct_abc123"
  const date = new Date(2025, 0, 5) // Jan 5 2025 local
  const amount = 129.99
  const merchant = "AMAZON.COM"

  it("returns a 64-char hex string", () => {
    const key = transactionKey(accountId, date, amount, merchant)
    expect(key).toMatch(/^[0-9a-f]{64}$/)
  })

  it("same inputs → same key (deterministic)", () => {
    const k1 = transactionKey(accountId, date, amount, merchant)
    const k2 = transactionKey(accountId, date, amount, merchant)
    expect(k1).toBe(k2)
  })

  it("different accountId → different key", () => {
    const k1 = transactionKey("acct_1", date, amount, merchant)
    const k2 = transactionKey("acct_2", date, amount, merchant)
    expect(k1).not.toBe(k2)
  })

  it("different amount → different key", () => {
    const k1 = transactionKey(accountId, date, 100.00, merchant)
    const k2 = transactionKey(accountId, date, 100.01, merchant)
    expect(k1).not.toBe(k2)
  })

  it("merchant casing is normalised (case-insensitive)", () => {
    const k1 = transactionKey(accountId, date, amount, "AMAZON.COM")
    const k2 = transactionKey(accountId, date, amount, "amazon.com")
    expect(k1).toBe(k2)
  })

  it("merchant leading/trailing whitespace is normalised", () => {
    const k1 = transactionKey(accountId, date, amount, "AMAZON.COM")
    const k2 = transactionKey(accountId, date, amount, "  AMAZON.COM  ")
    expect(k1).toBe(k2)
  })

  it("uses integer cents (avoids float drift: 129.99 ≠ 129.989999...)", () => {
    // 129.99 * 100 = 12999 (rounded) — key must be stable
    const k1 = transactionKey(accountId, date, 129.99, merchant)
    const k2 = transactionKey(accountId, date, 129.99000000001, merchant)
    // Very small drift should round to same cents
    expect(k1).toBe(k2)
  })
})
