/**
 * AI-default derivation for STOP items — covers MERCHANT, TRANSFER, and
 * DEPOSIT categories (§274(d) and PERIOD_GAP intentionally fall through
 * with `null` because their forms either require structured user input
 * the AI can't fabricate, or are resolved out-of-band by uploading the
 * missing statement).
 *
 * Two source signals, in this priority order:
 *   1. `stop.aiSuggestion` — JSON written by autoResolveStops or the
 *      DEPOSIT-stop materialization path. This is the strongest signal:
 *      it's the model's own choice, even when below the auto-resolve
 *      confidence threshold (so the user gets a one-click default
 *      instead of four blank radios).
 *   2. Heuristic fallbacks — for stops the AI hasn't seen yet, project
 *      what we *can* say from the merchant string + transaction shape:
 *       · TRANSFER: "WISE", "TOPUP", payment-rail patterns → LOAN choice
 *         (= TRANSFER code, biz pct 0). Pocketsflow with a contractor name
 *         we recognize → CONTRACTOR.
 *       · DEPOSIT: marketplace processor names (eBay/Stripe/Square/PayPal)
 *         → CLIENT/PLATFORM_1099 (= BIZ_INCOME).
 *
 * Heuristics are tagged with a confidence band (0.55–0.75 for inference,
 * 0.85+ for AI-persisted) so the UI can show "AI suggests …" with the
 * right hedging language.
 */

import type { MerchantRule, StopItem } from "@/app/generated/prisma/client"

export type MerchantChoice =
  | "ALL_BUSINESS"
  | "DURING_TRIPS"
  | "MIXED_50"
  | "PERSONAL"
  | "OTHER"

export type TransferChoice =
  | "PERSONAL"
  | "CONTRACTOR"
  | "LOAN"
  | "OTHER"

export type DepositChoice =
  | "CLIENT"
  | "PLATFORM_1099"
  | "W2"
  | "OWNER_CONTRIB"
  | "GIFT"
  | "LOAN"
  | "REFUND"
  | "OTHER"

export type AiSuggestion =
  | {
      kind: "merchant"
      choice: MerchantChoice
      confidence: number
      reasoning: string | null
      scheduleCLine: string | null
    }
  | {
      kind: "transfer"
      choice: TransferChoice
      confidence: number
      reasoning: string | null
      payeeName?: string
      purpose?: string
    }
  | {
      kind: "deposit"
      choice: DepositChoice
      confidence: number
      reasoning: string | null
    }

// ──────────────────────────────────────────────────────────────────────
// MERCHANT — map a confirmed MerchantRule into a radio choice.
// Mirrors the prior page.tsx logic; centralized here so all categories
// share one derivation entry point.
// ──────────────────────────────────────────────────────────────────────

function deriveMerchantSuggestion(rule: MerchantRule): AiSuggestion | null {
  let choice: MerchantChoice | null = null
  switch (rule.code) {
    case "WRITE_OFF":
    case "WRITE_OFF_COGS":
    case "MEALS_50":
    case "MEALS_100":
      if (rule.businessPctDefault >= 90) choice = "ALL_BUSINESS"
      else if (rule.businessPctDefault > 0) choice = "MIXED_50"
      break
    case "WRITE_OFF_TRAVEL":
      choice = "DURING_TRIPS"
      break
    case "PERSONAL":
      choice = "PERSONAL"
      break
    default:
      return null
  }
  if (!choice) return null
  return {
    kind: "merchant",
    choice,
    confidence: rule.confidence,
    reasoning: rule.reasoning ?? null,
    scheduleCLine: rule.scheduleCLine ?? null,
  }
}

// ──────────────────────────────────────────────────────────────────────
// TRANSFER — heuristic from raw merchant string. Only fires when the
// auto-resolve pass hasn't already left a stronger signal.
// ──────────────────────────────────────────────────────────────────────

const WISE_TOPUP_RX = /wise|topup|top\s*up|trnwise|trans?fer\s+id/i
const APPLE_CASH_RX = /apple\s*cash|venmo|cash\s*app/i
const POCKETSFLOW_RX = /pocketsflow|paychex|gusto/i

function deriveTransferSuggestion(stop: StopItem): AiSuggestion | null {
  const ctxMerchant =
    typeof (stop.context as Record<string, unknown>)?.merchant === "string"
      ? ((stop.context as Record<string, unknown>).merchant as string)
      : ""
  const sample = ctxMerchant || stop.question || ""

  // Pocketsflow + Apple Cash matched first because their raw strings can
  // contain the word "TRANSFER" — the more-specific signal wins.
  if (POCKETSFLOW_RX.test(sample)) {
    return {
      kind: "transfer",
      choice: "CONTRACTOR",
      confidence: 0.65,
      reasoning:
        "Recurring payroll-style outflow — likely a contractor payment (Schedule C Line 11).",
    }
  }
  if (APPLE_CASH_RX.test(sample)) {
    return {
      kind: "transfer",
      choice: "PERSONAL",
      confidence: 0.6,
      reasoning:
        "Apple Cash / Venmo / Cash App outflow — most often a personal transfer.",
    }
  }
  if (WISE_TOPUP_RX.test(sample)) {
    return {
      kind: "transfer",
      choice: "LOAN",
      confidence: 0.7,
      reasoning:
        "Wise top-up / inter-account move — most likely a transfer between your own accounts. Pick CONTRACTOR if this is actually a supplier payment.",
    }
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────
// DEPOSIT — marketplace-processor patterns → BIZ_INCOME.
// ──────────────────────────────────────────────────────────────────────

const MARKETPLACE_RX = /ebay|stripe|paypal|square|pocketsflow|shopify|amazon\s*payments|etsy/i
const PLATFORM_1099_RX = /stripe|paypal|amazon\s*payments/i
const REFUND_RX = /refund|reversal|return/i

function deriveDepositSuggestion(stop: StopItem): AiSuggestion | null {
  const ctxMerchant =
    typeof (stop.context as Record<string, unknown>)?.merchant === "string"
      ? ((stop.context as Record<string, unknown>).merchant as string)
      : ""
  const sample = ctxMerchant || stop.question || ""

  if (REFUND_RX.test(sample)) {
    return {
      kind: "deposit",
      choice: "REFUND",
      confidence: 0.65,
      reasoning: "Description matches a vendor refund / reversal pattern.",
    }
  }
  if (PLATFORM_1099_RX.test(sample)) {
    return {
      kind: "deposit",
      choice: "PLATFORM_1099",
      confidence: 0.85,
      reasoning:
        "Stripe / PayPal / Amazon Payments inflow — 1099-K platform payout (Schedule C Line 1 Gross Receipts).",
    }
  }
  if (MARKETPLACE_RX.test(sample)) {
    return {
      kind: "deposit",
      choice: "CLIENT",
      confidence: 0.85,
      reasoning:
        "Marketplace processor payout — sales revenue (Schedule C Line 1 Gross Receipts).",
    }
  }
  return null
}

// ──────────────────────────────────────────────────────────────────────
// Top-level entry point: persisted suggestion wins; otherwise derive.
// ──────────────────────────────────────────────────────────────────────

export function deriveAiSuggestion(
  stop: StopItem & { merchantRule: MerchantRule | null },
): AiSuggestion | null {
  // 1. Persisted suggestion (written by autoResolveStops below threshold,
  //    or by the AI-driven STOP materialization). Highest priority.
  if (stop.aiSuggestion) {
    const persisted = sanitizePersistedSuggestion(stop.aiSuggestion)
    if (persisted) return persisted
  }

  // 2. MerchantRule mapping — only meaningful when category is MERCHANT.
  if (stop.category === "MERCHANT" && stop.merchantRule) {
    const m = deriveMerchantSuggestion(stop.merchantRule)
    if (m) return m
  }

  // 3. Heuristic fallbacks for TRANSFER and DEPOSIT.
  if (stop.category === "TRANSFER") return deriveTransferSuggestion(stop)
  if (stop.category === "DEPOSIT") return deriveDepositSuggestion(stop)

  return null
}

// Cast the persisted JSON back into the union, validating just enough
// shape to avoid a render-time crash if a hand-written script wrote
// something off-spec. Untrusted shapes return null and the UI falls
// back to the heuristic / unselected radio.
function sanitizePersistedSuggestion(raw: unknown): AiSuggestion | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Record<string, unknown>
  const kind = r.kind
  if (kind !== "merchant" && kind !== "transfer" && kind !== "deposit") return null
  const choice = r.choice
  if (typeof choice !== "string") return null
  const confidence = typeof r.confidence === "number" ? r.confidence : 0
  const reasoning = typeof r.reasoning === "string" ? r.reasoning : null
  if (kind === "merchant") {
    if (!["ALL_BUSINESS", "DURING_TRIPS", "MIXED_50", "PERSONAL", "OTHER"].includes(choice)) {
      return null
    }
    return {
      kind,
      choice: choice as MerchantChoice,
      confidence,
      reasoning,
      scheduleCLine: typeof r.scheduleCLine === "string" ? r.scheduleCLine : null,
    }
  }
  if (kind === "transfer") {
    if (!["PERSONAL", "CONTRACTOR", "LOAN", "OTHER"].includes(choice)) return null
    return {
      kind,
      choice: choice as TransferChoice,
      confidence,
      reasoning,
      payeeName: typeof r.payeeName === "string" ? r.payeeName : undefined,
      purpose: typeof r.purpose === "string" ? r.purpose : undefined,
    }
  }
  // deposit
  if (
    !["CLIENT", "PLATFORM_1099", "W2", "OWNER_CONTRIB", "GIFT", "LOAN", "REFUND", "OTHER"].includes(
      choice,
    )
  ) {
    return null
  }
  return {
    kind,
    choice: choice as DepositChoice,
    confidence,
    reasoning,
  }
}

/**
 * Map an AI-resolved code (the StopResolution shape from autoResolveStops)
 * into an AiSuggestion the UI can pre-select. Used by autoResolveStops to
 * persist a usable default even when the resolve is below the
 * auto-confidence threshold.
 */
export function aiSuggestionFromResolution(
  category: "MERCHANT" | "TRANSFER" | "DEPOSIT" | string,
  code: string,
  businessPct: number,
  scheduleCLine: string | null,
  confidence: number,
  reasoning: string,
): AiSuggestion | null {
  switch (category) {
    case "MERCHANT": {
      let choice: MerchantChoice
      if (code === "WRITE_OFF" || code === "WRITE_OFF_COGS") {
        // 0% business pct on a WRITE_OFF code is contradictory — the AI
        // is hedging, so flag as OTHER for the user to clarify.
        choice = businessPct >= 90 ? "ALL_BUSINESS" : businessPct > 0 ? "MIXED_50" : "OTHER"
      } else if (code === "WRITE_OFF_TRAVEL") choice = "DURING_TRIPS"
      else if (code === "MEALS_50" || code === "MEALS_100")
        choice = businessPct >= 90 ? "ALL_BUSINESS" : "MIXED_50"
      else if (code === "PERSONAL") choice = "PERSONAL"
      // NEEDS_CONTEXT (or any unmapped code) → OTHER so the form pre-
      // selects "Other — explain" instead of leaving every radio blank.
      // The accompanying reasoning is what the explanation textarea will
      // pre-fill from in the form components below.
      else choice = "OTHER"
      return { kind: "merchant", choice, confidence, reasoning, scheduleCLine }
    }
    case "TRANSFER": {
      let choice: TransferChoice
      if (code === "PERSONAL") choice = "PERSONAL"
      else if (code === "WRITE_OFF") choice = "CONTRACTOR"
      else if (code === "TRANSFER") choice = "LOAN"
      else choice = "OTHER"
      return { kind: "transfer", choice, confidence, reasoning }
    }
    case "DEPOSIT": {
      let choice: DepositChoice
      if (code === "BIZ_INCOME") choice = "CLIENT"
      else if (code === "TRANSFER") choice = "OWNER_CONTRIB"
      else if (code === "PERSONAL") choice = "GIFT"
      else if (code === "WRITE_OFF") choice = "REFUND"
      else choice = "OTHER"
      return { kind: "deposit", choice, confidence, reasoning }
    }
    default:
      return null
  }
}
