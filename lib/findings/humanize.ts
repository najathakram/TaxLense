/**
 * humanize.ts — turn a LedgerFinding's machine-readable ProposedAction into
 * a CPA-readable sentence + offer a small menu of *case-derived* alternatives
 * the CPA can pick instead of a flat Accept/Dismiss.
 *
 * The findings UI used to render the ProposedAction as a JSON.stringify
 * pretty-print, which forced the CPA to read code-like blobs. After a
 * production walkthrough of Atif's 2025 the user asked for three things:
 *
 *   1) Show the proposal in plain English ("Reclassify 23 rows to WRITE_OFF
 *      on Line 27a, citing §162. Same deductible total, cleaner line.")
 *   2) Offer 2–3 case-derived alternatives next to Accept so the CPA can
 *      modify the path without leaving the page (e.g., for MISCLASSIFIED_LINE
 *      with a Wise-fee cluster: "Move to Line 17 Legal & Prof" OR "Move to
 *      Line 27a Other Expenses" OR "Split between Line 17 and 27a").
 *   3) An "Other…" option that opens a free-text dialog so the CPA can write
 *      what they actually want done. That instruction is stored on the
 *      finding; apply-time routes it through a STOP carrying the instruction
 *      verbatim — no fabricated AI action.
 *
 * Everything here is pure (no DB, no AI). Used by both findings-client.tsx
 * (renders the summary + offers alternatives) and the audit packet (renders
 * the chosen path for the workpapers).
 */

import { fmtUSD } from "@/lib/format/currency"

// ─────────────────────────────────────────────────────────────────────────────
// ProposedAction shape — mirror lib/findings/apply.ts (intentionally
// duplicated so humanize.ts can be imported from the client without pulling
// in the Prisma/DB graph that apply.ts depends on).
// ─────────────────────────────────────────────────────────────────────────────

export interface ReclassifyAction {
  kind: "RECLASSIFY"
  txnIds: string[]
  code: string
  businessPct: number
  scheduleCLine: string | null
  ircCitations: string[]
  evidenceTier: number
  cohanFlag?: boolean
  substantiation?: Record<string, unknown>
}

export interface StopAction {
  kind: "STOP"
  category: string
  question: string
  transactionIds: string[]
}

export interface BlockAction {
  kind: "BLOCK"
  reason: string
}

export interface NoteAction {
  kind: "NOTE"
  suggestion: string
}

export type ProposedAction = ReclassifyAction | StopAction | BlockAction | NoteAction

// ─────────────────────────────────────────────────────────────────────────────
// Display strings for transaction codes (the prompt's 12-code vocabulary)
// ─────────────────────────────────────────────────────────────────────────────

const CODE_LABEL: Record<string, string> = {
  WRITE_OFF: "Operating expense (WRITE_OFF)",
  WRITE_OFF_TRAVEL: "Travel (WRITE_OFF_TRAVEL — §274(d))",
  WRITE_OFF_COGS: "Cost of goods sold (WRITE_OFF_COGS)",
  MEALS_50: "Meals @ 50% (MEALS_50 — §274(n)(1))",
  MEALS_100: "Meals @ 100% (MEALS_100 — §274(n)(2))",
  GRAY: "Gray (ambiguous — leave for review)",
  PERSONAL: "Personal (PERSONAL — not deductible)",
  TRANSFER: "Transfer between own accounts",
  PAYMENT: "Credit-card payment",
  BIZ_INCOME: "Business income (Line 1)",
  OWNER_EQUITY: "Owner contribution / draw",
  NEEDS_CONTEXT: "Needs context (unresolved)",
}

const STOP_CATEGORY_LABEL: Record<string, string> = {
  MERCHANT: "merchant-level question",
  DEPOSIT: "deposit-side question",
  TRANSFER: "transfer-pair question",
  PERIOD_GAP: "period-gap question",
  "§274(d)": "§274(d) substantiation request",
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — humanize a ProposedAction into a CPA-readable summary
// ─────────────────────────────────────────────────────────────────────────────

export interface HumanizedAction {
  /** One-line summary the UI puts above the JSON details (always present). */
  summary: string
  /** Bullet rows the UI shows when the CPA expands the "Details" section. */
  bullets: string[]
  /** What kind of write the apply layer will do. Useful for styling badges. */
  kind: ProposedAction["kind"]
}

export function humanizeProposedAction(
  action: ProposedAction,
  context: { txnCount?: number; aggregateAmount?: number } = {}
): HumanizedAction {
  if (action.kind === "RECLASSIFY") {
    const n = action.txnIds.length || context.txnCount || 1
    const codeLabel = CODE_LABEL[action.code] ?? action.code
    const lineLabel = action.scheduleCLine ?? "(no line — fallback will pick one)"
    const pct = action.businessPct
    const cohan = action.cohanFlag ? " · Cohan-flagged" : ""
    const summary =
      n === 1
        ? `Reclassify 1 transaction to ${codeLabel} @ ${pct}% on ${lineLabel}${cohan}.`
        : `Reclassify ${n} transactions to ${codeLabel} @ ${pct}% on ${lineLabel}${cohan}.`

    const bullets: string[] = []
    if (action.ircCitations.length > 0) {
      bullets.push(`IRC citations: ${action.ircCitations.join(", ")}`)
    }
    bullets.push(`Evidence tier: ${action.evidenceTier}`)
    if (context.aggregateAmount !== undefined && context.aggregateAmount !== 0) {
      bullets.push(`Aggregate amount touched: ${fmtUSD(Math.abs(context.aggregateAmount), { cents: true })}`)
    }
    if (action.substantiation && Object.keys(action.substantiation).length > 0) {
      bullets.push(
        `Substantiation template: ${Object.entries(action.substantiation)
          .map(([k, v]) => `${k}=${typeof v === "string" ? (v || "(empty)") : JSON.stringify(v)}`)
          .join(", ")}`
      )
    }
    return { summary, bullets, kind: "RECLASSIFY" }
  }

  if (action.kind === "STOP") {
    const catLabel = STOP_CATEGORY_LABEL[action.category] ?? action.category
    const txnHint =
      action.transactionIds.length === 0
        ? "(no specific transactions — taxpayer-supplied answer)"
        : action.transactionIds.length === 1
          ? "for 1 cited transaction"
          : `for ${action.transactionIds.length} cited transactions`
    return {
      summary: `Create a ${catLabel} ${txnHint}.`,
      bullets: [`Question to surface: "${action.question}"`],
      kind: "STOP",
    }
  }

  if (action.kind === "BLOCK") {
    return {
      summary: `Block lock until this is resolved.`,
      bullets: [`Reason: ${action.reason}`],
      kind: "BLOCK",
    }
  }

  // NOTE
  return {
    summary: `Workpaper note for the CPA (no automated change).`,
    bullets: [`Suggestion: ${action.suggestion}`],
    kind: "NOTE",
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — derive 2–3 case-specific alternatives the CPA can choose instead
// of the AI's default action. Each alternative carries a label (rendered in
// the dropdown), a one-line explanation (rendered as a tooltip / subtitle),
// and an `override` payload the apply layer uses verbatim.
//
// The "Other…" option is NOT included here — the UI appends it separately
// because it routes through a different action (acceptFindingWithInstruction).
// ─────────────────────────────────────────────────────────────────────────────

export interface FindingAlternative {
  label: string
  hint: string
  override: ProposedAction
}

export function deriveAlternatives(
  category: string,
  action: ProposedAction
): FindingAlternative[] {
  const alts: FindingAlternative[] = []

  // ─── MISCLASSIFIED_LINE — most useful alternatives are alternate target lines
  if (category === "MISCLASSIFIED_LINE" && action.kind === "RECLASSIFY") {
    const r = action
    // If the AI proposed Line 17, offer Line 27a as the alternative (and vice
    // versa). For mixed-use fee clusters (Wise/Stripe), splitting is also a
    // common CPA call so we expose that too.
    if (r.scheduleCLine !== "Line 17 Legal & Professional") {
      alts.push({
        label: "Move to Line 17 Legal & Professional",
        hint: "Use for payment-gateway fees (Stripe, Square, AuthNet) — clearly a professional/financial service.",
        override: { ...r, scheduleCLine: "Line 17 Legal & Professional" },
      })
    }
    if (r.scheduleCLine !== "Line 27a Other Expenses") {
      alts.push({
        label: "Move to Line 27a Other Expenses",
        hint: "Use for wire fees / Wise / PayPal — banking-adjacent, not strictly a service fee.",
        override: { ...r, scheduleCLine: "Line 27a Other Expenses" },
      })
    }
    // Leave-in-place alternative — sometimes the CPA wants to keep COGS for
    // gross-margin reporting reasons even though the AI flagged it.
    if (r.scheduleCLine !== "Part III COGS") {
      alts.push({
        label: "Keep in Part III COGS",
        hint: "If you've intentionally rolled fees into COGS for gross-margin reporting, dismiss this.",
        override: { ...r, scheduleCLine: "Part III COGS" },
      })
    }
    return alts
  }

  // ─── DEDUCTION_GAP — typically a STOP. Alternatives are around how to follow up.
  if (category === "DEDUCTION_GAP") {
    if (action.kind === "STOP") {
      alts.push({
        label: "Skip — no spend on this line",
        hint: "Use when the taxpayer genuinely has no expenses in this category (rare for $0 vs ≥4% benchmark).",
        override: { kind: "NOTE", suggestion: `Gap reviewed; no spend on this line. (${action.question})` },
      })
      alts.push({
        label: "Convert to BLOCK — fix before filing",
        hint: "Mark as a lock-blocker so the year can't be filed until this gap is documented or dismissed.",
        override: { kind: "BLOCK", reason: action.question },
      })
    }
    if (action.kind === "RECLASSIFY") {
      // PROMOTE-candidate variant (Atif's Laeeq / eBay / Clue case)
      alts.push({
        label: "Surface as STOP instead — needs the taxpayer to confirm",
        hint: "Convert to a merchant-level question for the user before changing classifications.",
        override: {
          kind: "STOP",
          category: "MERCHANT",
          question: `Confirm: should this be reclassified as ${CODE_LABEL[action.code] ?? action.code}?`,
          transactionIds: action.txnIds,
        },
      })
    }
    return alts
  }

  // ─── PERSONAL_ANOMALY — promote-candidate findings. Offer alternative codes.
  if (category === "PERSONAL_ANOMALY" && action.kind === "STOP") {
    alts.push({
      label: "Promote directly to COGS",
      hint: "Use when you're confident this is a supplier payment (skip the merchant STOP).",
      override: {
        kind: "RECLASSIFY",
        txnIds: action.transactionIds,
        code: "WRITE_OFF_COGS",
        businessPct: 100,
        scheduleCLine: "Part III COGS",
        ircCitations: ["§162", "§263A"],
        evidenceTier: 3,
      },
    })
    alts.push({
      label: "Promote to Line 11 Contract Labor",
      hint: "Use when the payee is an individual providing services (§162; W-9/1099-NEC may apply).",
      override: {
        kind: "RECLASSIFY",
        txnIds: action.transactionIds,
        code: "WRITE_OFF",
        businessPct: 100,
        scheduleCLine: "Line 11 Contract Labor",
        ircCitations: ["§162"],
        evidenceTier: 3,
      },
    })
    alts.push({
      label: "Promote to Line 27a Other Expenses",
      hint: "Use for ambiguous platform fees (eBay, Etsy) that aren't clearly COGS or services.",
      override: {
        kind: "RECLASSIFY",
        txnIds: action.transactionIds,
        code: "WRITE_OFF",
        businessPct: 100,
        scheduleCLine: "Line 27a Other Expenses",
        ircCitations: ["§162"],
        evidenceTier: 3,
      },
    })
    return alts
  }

  // ─── DOUBLE_COUNT — alternative netting choices
  if (category === "DOUBLE_COUNT" && action.kind === "RECLASSIFY") {
    alts.push({
      label: "Net against original BIZ_INCOME instead",
      hint: "Reduce gross receipts directly (Line 1b returns/allowances) instead of flipping the chargeback to PERSONAL.",
      override: { ...action, code: "BIZ_INCOME", scheduleCLine: "Line 1b Returns and allowances", businessPct: 100 },
    })
    return alts
  }

  // ─── MISSING_W9 — block vs note alternatives
  if (category === "MISSING_W9") {
    if (action.kind === "BLOCK") {
      alts.push({
        label: "Acknowledge — W-9 already collected offline",
        hint: "Mark as resolved without blocking. The audit packet still notes the collection date.",
        override: { kind: "NOTE", suggestion: `W-9 collected offline — ${action.reason}` },
      })
    }
    return alts
  }

  // ─── ABOVE_THE_LINE — Sole-prop / SMLLC opportunity STOP
  if (category === "ABOVE_THE_LINE" && action.kind === "STOP") {
    alts.push({
      label: "Already addressed — dismiss",
      hint: "Use when the taxpayer has already filed SE health / retirement elections separately.",
      override: { kind: "NOTE", suggestion: `Above-the-line option reviewed offline. (${action.question})` },
    })
    return alts
  }

  // ─── DUP_LINE_BUCKET — purely cosmetic; alternative is to keep separate.
  if (category === "DUP_LINE_BUCKET" && action.kind === "NOTE") {
    // No useful alternative — Accept (merge) or Dismiss (keep separate). UI
    // handles those via the existing buttons.
    return alts
  }

  return alts
}

// ─────────────────────────────────────────────────────────────────────────────
// Public — humanize an "Other…" instruction landing path. When the CPA writes
// a free-text instruction, the apply layer creates a STOP carrying the
// instruction verbatim. This helper builds that STOP without inventing a
// classification.
// ─────────────────────────────────────────────────────────────────────────────

export function buildInstructionStop(
  instruction: string,
  citedTxnIds: string[]
): StopAction {
  const trimmed = instruction.trim().slice(0, 500)
  return {
    kind: "STOP",
    category: "MERCHANT",
    question: `CPA instruction: ${trimmed}`,
    transactionIds: citedTxnIds,
  }
}
