/**
 * Unit tests for lib/stops/aiSuggestion.ts — the AI-default derivation
 * the STOPs page uses to pre-select a radio choice.
 *
 * Covers:
 *  - MERCHANT category derives from MerchantRule code + businessPctDefault
 *  - TRANSFER heuristics (Wise → LOAN, Pocketsflow → CONTRACTOR, Apple Cash → PERSONAL)
 *  - DEPOSIT heuristics (Stripe/PayPal → PLATFORM_1099, eBay → CLIENT, refund → REFUND)
 *  - Persisted aiSuggestion JSON wins over rule mapping / heuristic
 *  - Untrusted persisted shape returns null (sanitization)
 */

import { describe, it, expect } from "vitest"
import {
  deriveAiSuggestion,
  aiSuggestionFromResolution,
} from "../lib/stops/aiSuggestion"
import type { MerchantRule, StopItem } from "../app/generated/prisma/client"

function makeStop(overrides: Partial<StopItem & { merchantRule: MerchantRule | null }> = {}) {
  const base: StopItem & { merchantRule: MerchantRule | null } = {
    id: "stop_1",
    taxYearId: "ty_1",
    merchantRuleId: null,
    category: "MERCHANT",
    question: "Q?",
    context: {},
    transactionIds: [],
    state: "PENDING",
    userAnswer: null,
    answeredAt: null,
    aiSuggestion: null,
    merchantRule: null,
    ...overrides,
  } as StopItem & { merchantRule: MerchantRule | null }
  return base
}

function makeRule(overrides: Partial<MerchantRule> = {}): MerchantRule {
  return {
    id: "rule_1",
    taxYearId: "ty_1",
    merchantKey: "TEST",
    code: "WRITE_OFF",
    scheduleCLine: "Line 27a Other Expenses",
    businessPctDefault: 100,
    appliesTripOverride: false,
    ircCitations: ["§162"],
    evidenceTierDefault: 3,
    confidence: 0.9,
    reasoning: "test",
    requiresHumanInput: false,
    humanQuestion: null,
    isConfirmed: false,
    originalSample: null,
    totalTransactions: 1,
    totalAmount: { toString: () => "100" } as never,
    ...overrides,
  } as MerchantRule
}

describe("deriveAiSuggestion — MERCHANT", () => {
  it("WRITE_OFF rule with 100% business → ALL_BUSINESS", () => {
    const stop = makeStop({
      category: "MERCHANT",
      merchantRule: makeRule({ code: "WRITE_OFF", businessPctDefault: 100 }),
    })
    const s = deriveAiSuggestion(stop)
    expect(s?.kind).toBe("merchant")
    expect(s && s.kind === "merchant" && s.choice).toBe("ALL_BUSINESS")
  })

  it("WRITE_OFF rule with 50% business → MIXED_50", () => {
    const stop = makeStop({
      category: "MERCHANT",
      merchantRule: makeRule({ code: "WRITE_OFF", businessPctDefault: 50 }),
    })
    const s = deriveAiSuggestion(stop)
    expect(s && s.kind === "merchant" && s.choice).toBe("MIXED_50")
  })

  it("PERSONAL rule → PERSONAL", () => {
    const stop = makeStop({
      category: "MERCHANT",
      merchantRule: makeRule({ code: "PERSONAL", businessPctDefault: 0 }),
    })
    const s = deriveAiSuggestion(stop)
    expect(s && s.kind === "merchant" && s.choice).toBe("PERSONAL")
  })

  it("BIZ_INCOME rule (not a deductible code) → null", () => {
    const stop = makeStop({
      category: "MERCHANT",
      merchantRule: makeRule({ code: "BIZ_INCOME" }),
    })
    expect(deriveAiSuggestion(stop)).toBeNull()
  })
})

describe("deriveAiSuggestion — TRANSFER heuristics", () => {
  it("Wise top-up pattern → LOAN", () => {
    const stop = makeStop({
      category: "TRANSFER",
      context: { merchant: "WISE US INC DES:WISE ID:TrnWise INDN:Sa Wholesale LLC" },
    })
    const s = deriveAiSuggestion(stop)
    expect(s?.kind).toBe("transfer")
    expect(s && s.kind === "transfer" && s.choice).toBe("LOAN")
  })

  it("Pocketsflow → CONTRACTOR", () => {
    const stop = makeStop({
      category: "TRANSFER",
      context: { merchant: "Pocketsflow DES:TRANSFER ID:ST-X INDN:KIRSTEN HATCH" },
    })
    const s = deriveAiSuggestion(stop)
    expect(s && s.kind === "transfer" && s.choice).toBe("CONTRACTOR")
  })

  it("Apple Cash → PERSONAL", () => {
    const stop = makeStop({
      category: "TRANSFER",
      context: { merchant: "Apple Cash transfer" },
    })
    const s = deriveAiSuggestion(stop)
    expect(s && s.kind === "transfer" && s.choice).toBe("PERSONAL")
  })

  it("Unrecognized merchant → null (no nudge into wrong default)", () => {
    const stop = makeStop({
      category: "TRANSFER",
      context: { merchant: "RANDOM ACH PAYEE" },
    })
    expect(deriveAiSuggestion(stop)).toBeNull()
  })
})

describe("deriveAiSuggestion — DEPOSIT heuristics", () => {
  it("Stripe payout → PLATFORM_1099", () => {
    const stop = makeStop({
      category: "DEPOSIT",
      context: { merchant: "STRIPE Transfer from Sa Wholesale LLC" },
    })
    const s = deriveAiSuggestion(stop)
    expect(s?.kind).toBe("deposit")
    expect(s && s.kind === "deposit" && s.choice).toBe("PLATFORM_1099")
  })

  it("eBay payout → CLIENT", () => {
    const stop = makeStop({
      category: "DEPOSIT",
      context: { merchant: "EBAY COM Payments from Sa Wholesale LLC" },
    })
    const s = deriveAiSuggestion(stop)
    // eBay matches the marketplace pattern; PayPal/Stripe/Amazon route to PLATFORM_1099,
    // others (eBay) route to CLIENT.
    expect(s && s.kind === "deposit" && s.choice).toBe("CLIENT")
  })

  it("Refund/reversal pattern → REFUND", () => {
    const stop = makeStop({
      category: "DEPOSIT",
      context: { merchant: "REFUND from XYZ" },
    })
    const s = deriveAiSuggestion(stop)
    expect(s && s.kind === "deposit" && s.choice).toBe("REFUND")
  })
})

describe("deriveAiSuggestion — persisted aiSuggestion overrides everything", () => {
  it("persisted Sonnet decision wins over rule-derived choice", () => {
    const persisted = {
      kind: "merchant",
      choice: "PERSONAL",
      confidence: 0.6,
      reasoning: "Sonnet flagged this as personal even though the rule says WRITE_OFF.",
      scheduleCLine: null,
    }
    const stop = makeStop({
      category: "MERCHANT",
      merchantRule: makeRule({ code: "WRITE_OFF", businessPctDefault: 100 }),
      aiSuggestion: persisted as never,
    })
    const s = deriveAiSuggestion(stop)
    expect(s && s.kind === "merchant" && s.choice).toBe("PERSONAL")
  })

  it("malformed persisted JSON falls through to derivation", () => {
    const stop = makeStop({
      category: "MERCHANT",
      merchantRule: makeRule({ code: "WRITE_OFF", businessPctDefault: 100 }),
      aiSuggestion: { kind: "bogus", choice: "MADE_UP" } as never,
    })
    const s = deriveAiSuggestion(stop)
    // Falls back to MerchantRule derivation
    expect(s && s.kind === "merchant" && s.choice).toBe("ALL_BUSINESS")
  })
})

describe("aiSuggestionFromResolution", () => {
  it("MERCHANT + WRITE_OFF + 100% → ALL_BUSINESS", () => {
    const s = aiSuggestionFromResolution(
      "MERCHANT",
      "WRITE_OFF",
      100,
      "Line 27a Other Expenses",
      0.6,
      "test",
    )
    expect(s && s.kind === "merchant" && s.choice).toBe("ALL_BUSINESS")
  })

  it("DEPOSIT + BIZ_INCOME → CLIENT", () => {
    const s = aiSuggestionFromResolution("DEPOSIT", "BIZ_INCOME", 100, null, 0.6, "test")
    expect(s && s.kind === "deposit" && s.choice).toBe("CLIENT")
  })

  it("TRANSFER + WRITE_OFF → CONTRACTOR (supplier payment via Wise)", () => {
    const s = aiSuggestionFromResolution("TRANSFER", "WRITE_OFF", 100, null, 0.6, "test")
    expect(s && s.kind === "transfer" && s.choice).toBe("CONTRACTOR")
  })

  it("TRANSFER + TRANSFER → LOAN", () => {
    const s = aiSuggestionFromResolution("TRANSFER", "TRANSFER", 0, null, 0.6, "test")
    expect(s && s.kind === "transfer" && s.choice).toBe("LOAN")
  })

  it("Unknown category → null", () => {
    expect(aiSuggestionFromResolution("PERIOD_GAP", "WRITE_OFF", 100, null, 0.6, "")).toBeNull()
  })
})
