/**
 * humanize.ts — pure-unit tests for the proposed-action humanizer and the
 * case-derived alternatives generator. No DB, no AI, no Prisma — keeps this
 * suite fast and CI-stable.
 */

import { describe, it, expect } from "vitest"
import {
  humanizeProposedAction,
  deriveAlternatives,
  buildInstructionStop,
  type ProposedAction,
} from "@/lib/findings/humanize"

describe("humanizeProposedAction — RECLASSIFY", () => {
  it("renders a single-txn move to Line 27a in plain English", () => {
    const action: ProposedAction = {
      kind: "RECLASSIFY",
      txnIds: ["tx_a"],
      code: "WRITE_OFF",
      businessPct: 100,
      scheduleCLine: "Line 27a Other Expenses",
      ircCitations: ["§162"],
      evidenceTier: 3,
    }
    const h = humanizeProposedAction(action)
    expect(h.kind).toBe("RECLASSIFY")
    expect(h.summary).toMatch(/Reclassify 1 transaction/)
    expect(h.summary).toMatch(/100%/)
    expect(h.summary).toMatch(/Line 27a Other Expenses/)
    expect(h.bullets.join(" ")).toMatch(/§162/)
    expect(h.bullets.join(" ")).toMatch(/Evidence tier: 3/)
  })

  it("uses plural form for multi-txn clusters and shows aggregate $", () => {
    const action: ProposedAction = {
      kind: "RECLASSIFY",
      txnIds: ["a", "b", "c", "d"],
      code: "WRITE_OFF_COGS",
      businessPct: 100,
      scheduleCLine: "Part III COGS",
      ircCitations: ["§263A"],
      evidenceTier: 2,
    }
    const h = humanizeProposedAction(action, { aggregateAmount: 9056.75 })
    expect(h.summary).toMatch(/Reclassify 4 transactions/)
    expect(h.bullets.some((b) => /\$9,056\.75/.test(b))).toBe(true)
  })

  it("flags Cohan when cohanFlag=true", () => {
    const action: ProposedAction = {
      kind: "RECLASSIFY",
      txnIds: ["x"],
      code: "WRITE_OFF",
      businessPct: 100,
      scheduleCLine: "Line 27a Other Expenses",
      ircCitations: ["§162", "Cohan"],
      evidenceTier: 4,
      cohanFlag: true,
    }
    const h = humanizeProposedAction(action)
    expect(h.summary).toMatch(/Cohan-flagged/)
  })
})

describe("humanizeProposedAction — STOP / BLOCK / NOTE", () => {
  it("STOP includes the question and txn-count hint", () => {
    const action: ProposedAction = {
      kind: "STOP",
      category: "MERCHANT",
      question: "Confirm: eBay $825 — supplier payment or platform fee?",
      transactionIds: ["t1"],
    }
    const h = humanizeProposedAction(action)
    expect(h.kind).toBe("STOP")
    expect(h.summary).toMatch(/merchant-level question/)
    expect(h.summary).toMatch(/1 cited transaction/)
    expect(h.bullets.join(" ")).toMatch(/eBay \$825/)
  })

  it("STOP with empty transactionIds notes the taxpayer-supplied form", () => {
    const action: ProposedAction = {
      kind: "STOP",
      category: "DEPOSIT",
      question: "Do you have advertising spend on a non-connected card?",
      transactionIds: [],
    }
    const h = humanizeProposedAction(action)
    expect(h.summary).toMatch(/no specific transactions/)
  })

  it("BLOCK renders as a lock blocker", () => {
    const action: ProposedAction = { kind: "BLOCK", reason: "Collect W-9 from Laeeq" }
    const h = humanizeProposedAction(action)
    expect(h.kind).toBe("BLOCK")
    expect(h.summary).toMatch(/Block lock/)
    expect(h.bullets.join(" ")).toMatch(/Collect W-9 from Laeeq/)
  })

  it("NOTE renders as a workpaper-only suggestion", () => {
    const action: ProposedAction = {
      kind: "NOTE",
      suggestion: "Merge legacy Line 27a / Line 27a Other Expenses buckets",
    }
    const h = humanizeProposedAction(action)
    expect(h.kind).toBe("NOTE")
    expect(h.summary).toMatch(/Workpaper note/)
    expect(h.bullets.join(" ")).toMatch(/Merge legacy/)
  })
})

describe("deriveAlternatives — MISCLASSIFIED_LINE (Wise/Stripe fees in COGS)", () => {
  const action: ProposedAction = {
    kind: "RECLASSIFY",
    txnIds: ["w1", "w2", "w3"],
    code: "WRITE_OFF",
    businessPct: 100,
    scheduleCLine: "Line 27a Other Expenses",
    ircCitations: ["§162"],
    evidenceTier: 3,
  }

  it("offers Line 17 as an alternative when current proposal is Line 27a", () => {
    const alts = deriveAlternatives("MISCLASSIFIED_LINE", action)
    const labels = alts.map((a) => a.label)
    expect(labels).toContain("Move to Line 17 Legal & Professional")
    expect(labels).toContain("Keep in Part III COGS")
  })

  it("does NOT offer the same line the AI already proposed", () => {
    const alts = deriveAlternatives("MISCLASSIFIED_LINE", action)
    // Action already targets Line 27a, so "Move to Line 27a" should NOT appear
    const labels = alts.map((a) => a.label)
    expect(labels).not.toContain("Move to Line 27a Other Expenses")
  })

  it("each alternative carries the same code + txn ids but a different line", () => {
    const alts = deriveAlternatives("MISCLASSIFIED_LINE", action)
    for (const alt of alts) {
      if (alt.override.kind === "RECLASSIFY") {
        expect(alt.override.code).toBe(action.code)
        expect(alt.override.txnIds).toEqual(action.txnIds)
        expect(alt.override.scheduleCLine).not.toBe(action.scheduleCLine)
      }
    }
  })
})

describe("deriveAlternatives — PERSONAL_ANOMALY promote candidates", () => {
  const stop: ProposedAction = {
    kind: "STOP",
    category: "MERCHANT",
    question: "Laeeq $1,000 — supplier or personal?",
    transactionIds: ["laeeq_tx"],
  }

  it("offers Promote-to-COGS / Line 11 / Line 27a paths", () => {
    const alts = deriveAlternatives("PERSONAL_ANOMALY", stop)
    const labels = alts.map((a) => a.label)
    expect(labels).toContain("Promote directly to COGS")
    expect(labels).toContain("Promote to Line 11 Contract Labor")
    expect(labels).toContain("Promote to Line 27a Other Expenses")
  })

  it("each promote alternative is a RECLASSIFY at 100% biz pct citing §162", () => {
    const alts = deriveAlternatives("PERSONAL_ANOMALY", stop)
    for (const alt of alts) {
      expect(alt.override.kind).toBe("RECLASSIFY")
      if (alt.override.kind === "RECLASSIFY") {
        expect(alt.override.businessPct).toBe(100)
        expect(alt.override.txnIds).toEqual(["laeeq_tx"])
        expect(alt.override.ircCitations).toContain("§162")
      }
    }
  })
})

describe("deriveAlternatives — DEDUCTION_GAP", () => {
  it("STOP-style gap (advertising/utilities) offers skip + block", () => {
    const action: ProposedAction = {
      kind: "STOP",
      category: "DEPOSIT",
      question: "Do you have Line 8 Advertising spend on a non-connected card?",
      transactionIds: [],
    }
    const alts = deriveAlternatives("DEDUCTION_GAP", action)
    const labels = alts.map((a) => a.label)
    expect(labels).toContain("Skip — no spend on this line")
    expect(labels).toContain("Convert to BLOCK — fix before filing")
  })

  it("RECLASSIFY-style gap (PROMOTE candidate) offers convert-to-STOP", () => {
    const action: ProposedAction = {
      kind: "RECLASSIFY",
      txnIds: ["t1"],
      code: "WRITE_OFF_COGS",
      businessPct: 100,
      scheduleCLine: "Part III COGS",
      ircCitations: ["§162"],
      evidenceTier: 3,
    }
    const alts = deriveAlternatives("DEDUCTION_GAP", action)
    const labels = alts.map((a) => a.label)
    expect(labels).toContain("Surface as STOP instead — needs the taxpayer to confirm")
  })
})

describe("deriveAlternatives — categories with no alternatives", () => {
  it("returns an empty array for unknown categories", () => {
    const action: ProposedAction = {
      kind: "NOTE",
      suggestion: "informational",
    }
    expect(deriveAlternatives("UNKNOWN_CATEGORY", action)).toEqual([])
  })

  it("returns an empty array for DUP_LINE_BUCKET NOTE (no alternatives needed)", () => {
    const action: ProposedAction = {
      kind: "NOTE",
      suggestion: "Merge canonical and legacy labels",
    }
    expect(deriveAlternatives("DUP_LINE_BUCKET", action)).toEqual([])
  })
})

describe("buildInstructionStop — 'Other…' free-text capture", () => {
  it("builds a STOP carrying the trimmed instruction verbatim (no AI)", () => {
    const stop = buildInstructionStop(
      "  These three Wise rows are pre-payments — leave them in COGS.  ",
      ["t1", "t2", "t3"]
    )
    expect(stop.kind).toBe("STOP")
    expect(stop.category).toBe("MERCHANT")
    expect(stop.question).toBe(
      "CPA instruction: These three Wise rows are pre-payments — leave them in COGS."
    )
    expect(stop.transactionIds).toEqual(["t1", "t2", "t3"])
  })

  it("caps the instruction at 500 chars to fit the STOP question column", () => {
    const long = "x".repeat(800)
    const stop = buildInstructionStop(long, [])
    // "CPA instruction: " prefix (17 chars) + 500 chars of payload = 517
    expect(stop.question.length).toBeLessThanOrEqual(517)
  })
})
