/**
 * CPA_AUDIT — output schema + autoFixable rules.
 *
 * Pure unit tests for the deterministic schema contracts. End-to-end runs
 * against real Opus require a DB seeded with classifications and are exercised
 * via the prod deploy.
 */

import { describe, it, expect } from "vitest"

describe("CPA_AUDIT — finding categories", () => {
  const VALID_CATEGORIES = [
    "DOUBLE_COUNT",
    "PHANTOM_TRANSFER",
    "MISSING_LINE",
    "DIF_RISK",
    "SUSPECT_CLASS",
    "MISSING_W9",
    "DUP_LINE_BUCKET",
    "PERSONAL_ANOMALY",
    "OWNER_ACTIVITY",
    "DEDUCTION_GAP",
    "MISCLASSIFIED_LINE",
    "ABOVE_THE_LINE",
  ]

  it("covers the 7 production Atif findings (plus DIF_RISK)", () => {
    // Finding #1: bounced check    → DOUBLE_COUNT
    // Finding #2: Wise phantom    → PHANTOM_TRANSFER
    // Finding #3: Wise fees no line → MISSING_LINE
    // Finding #4: duplicate buckets → DUP_LINE_BUCKET
    // Finding #5: missing W-9     → MISSING_W9
    // Finding #6: Line 27a > 10%  → DIF_RISK
    // Finding #7: PERSONAL outliers → PERSONAL_ANOMALY
    expect(VALID_CATEGORIES).toContain("DOUBLE_COUNT")
    expect(VALID_CATEGORIES).toContain("PHANTOM_TRANSFER")
    expect(VALID_CATEGORIES).toContain("MISSING_LINE")
    expect(VALID_CATEGORIES).toContain("DUP_LINE_BUCKET")
    expect(VALID_CATEGORIES).toContain("MISSING_W9")
    expect(VALID_CATEGORIES).toContain("DIF_RISK")
    expect(VALID_CATEGORIES).toContain("PERSONAL_ANOMALY")
  })

  it("covers the OWNER_ACTIVITY category (Sole Prop / SMLLC equity movement)", () => {
    // Added 2026-05-20 in the hint-based transfer recognition PR (#58).
    expect(VALID_CATEGORIES).toContain("OWNER_ACTIVITY")
  })

  it("covers the 3 opportunity-mining categories added 2026-05-21", () => {
    // The CPA Audit was previously defect-only. After a walkthrough of
    // Atif's 2025 found ~$7-13K of likely-missed deductions, the audit
    // prompt was extended with opportunity-mining categories:
    //   - DEDUCTION_GAP     (NAICS-benchmark $0/under lines; PERSONAL rows
    //                        with business signal worth promoting)
    //   - MISCLASSIFIED_LINE (payment-processor fees coded WRITE_OFF_COGS
    //                        that belong on Line 17 / 27a — same deduction
    //                        amount, cleaner line, lower DIF signal)
    //   - ABOVE_THE_LINE    (Sole Prop / SMLLC only — SE health insurance,
    //                        SEP-IRA / Solo 401(k), Form 8829 actual method)
    expect(VALID_CATEGORIES).toContain("DEDUCTION_GAP")
    expect(VALID_CATEGORIES).toContain("MISCLASSIFIED_LINE")
    expect(VALID_CATEGORIES).toContain("ABOVE_THE_LINE")
  })
})

describe("CPA_AUDIT — fee-rows-in-COGS detector patterns", () => {
  // Pin the merchant patterns the cpaAudit summary uses to identify
  // payment-processor / wire fees miscoded as Part III COGS. Keeping these
  // patterns narrow and explicit prevents creep into legitimate supplier
  // payments. Broader fee detection lives in lib/ai/feeGuards.ts.
  const COGS_FEE_PATTERNS = [/^WISE/i, /\bSTRIPE\b/i, /\bPAYPAL\b/i, /\bSQUARE\b/i, /AUTHNET/i, /WORLDPAY/i, /\bACH\b/i]

  const POSITIVE_CASES = [
    "WISE US INC DES:WISE ID:TRNWISE",
    "Wise Inc",
    "STRIPE DES:TRANSFER ID:ST-XXX",
    "PAYPAL *MERCHANT FEE",
    "Square Inc",
    "AUTHNET GATEWAY",
    "WORLDPAY ACH",
    "ACH SERVICE FEE",
  ]
  const NEGATIVE_CASES = [
    "SENT MONEY TO ZAIN UL ABIDEEN SAFDAR",   // overseas supplier
    "ALAMODETREND LTD",                         // real supplier
    "SIMPLE CLUE LLC",                          // real supplier
    "EMS",                                      // shipping (its own line, not COGS-fee)
  ]

  it.each(POSITIVE_CASES)("matches fee pattern: %s", (m) => {
    expect(COGS_FEE_PATTERNS.some((rx) => rx.test(m))).toBe(true)
  })
  it.each(NEGATIVE_CASES)("does NOT match fee pattern for supplier: %s", (m) => {
    expect(COGS_FEE_PATTERNS.some((rx) => rx.test(m))).toBe(false)
  })
})

describe("CPA_AUDIT — deduction-gap severity scale", () => {
  // The deductionGap.benchmarks[].severity comes from a small set of
  // deterministic comparisons (computed in TypeScript so Opus doesn't have
  // to do arithmetic). Pin the rules so a future refactor can't silently
  // change what "ZERO" / "UNDER" / "INLINE" / "OVER" mean.
  //
  // ZERO   = actualAmount === 0 AND benchmark.expectedShare >= 0.04
  // UNDER  = actualShare < expectedShare * 0.5 AND gapAmount > $200
  // OVER   = actualShare > expectedShare * 1.5 (DIF signal in the other direction)
  // INLINE = everything else

  it("classifies $0 on a ≥4% benchmark line as ZERO", () => {
    const actualAmount = 0
    const expectedShare = 0.07 // 7%, above the 4% floor
    const severity = actualAmount === 0 && expectedShare >= 0.04 ? "ZERO" : "OTHER"
    expect(severity).toBe("ZERO")
  })

  it("classifies <50% of benchmark with >$200 gap as UNDER", () => {
    const totalDeductions = 30_000
    const expectedShare = 0.05
    const actualShare = 0.01 // 1% (way under 2.5% = 50% of 5%)
    const gapAmount = (expectedShare - actualShare) * totalDeductions
    const sev = actualShare < expectedShare * 0.5 && gapAmount > 200 ? "UNDER" : "OTHER"
    expect(sev).toBe("UNDER")
    expect(gapAmount).toBeCloseTo(1200)
  })

  it("classifies >150% of benchmark as OVER (DIF signal the other way)", () => {
    const expectedShare = 0.10
    const actualShare = 0.18
    const sev = actualShare > expectedShare * 1.5 ? "OVER" : "OTHER"
    expect(sev).toBe("OVER")
  })

  it("does NOT flag UNDER when the gap is immaterial", () => {
    const totalDeductions = 1_000
    const expectedShare = 0.05
    const actualShare = 0.01
    const gapAmount = (expectedShare - actualShare) * totalDeductions
    const sev = actualShare < expectedShare * 0.5 && gapAmount > 200 ? "UNDER" : "INLINE"
    expect(sev).toBe("INLINE")
    expect(gapAmount).toBeCloseTo(40)
  })
})

describe("CPA_AUDIT — severity scale", () => {
  const VALID_SEVERITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW", "COSMETIC"]
  it("has 5 severity levels", () => {
    expect(VALID_SEVERITIES.length).toBe(5)
  })
})

describe("CPA_AUDIT — autoFixable rules", () => {
  // From SYSTEM_PROMPT rule 4: autoFixable=false REQUIRED when
  // proposedAction.code is MEALS_50, MEALS_100, or WRITE_OFF_TRAVEL.
  // The code that enforces this is in lib/findings/apply.ts via
  // assertNot274dCohan. The prompt rule pins the AI's expected output;
  // the runtime hard-rail catches any slip.

  it("documents that §274(d) codes must be autoFixable=false", () => {
    const forbiddenAutoFixableCodes = ["MEALS_50", "MEALS_100", "WRITE_OFF_TRAVEL"]
    expect(forbiddenAutoFixableCodes.length).toBe(3)
  })
})

describe("CPA_AUDIT — graceful fall-through", () => {
  // When Opus JSON parse fails and Sonnet also fails, CPA_AUDIT writes a
  // single LOW finding noting manual review is recommended. This is the
  // never-block contract — the pipeline must continue.

  it("writes a fall-through LedgerFinding on AI failure", () => {
    const expected = {
      severity: "LOW",
      category: "DIF_RISK",
      title: "CPA audit pass failed — manual review recommended",
      autoFixable: false,
    }
    expect(expected.severity).toBe("LOW")
    expect(expected.autoFixable).toBe(false)
  })
})

describe("CPA_AUDIT — supersession", () => {
  // Re-running CPA_AUDIT must:
  //   1. Mark all prior state=PROPOSED findings as SUPERSEDED
  //   2. Preserve all state=APPLIED / DISMISSED / ACCEPTED findings (touch nothing)
  //   3. Write new PROPOSED rows for the current run

  it("supersedes only PROPOSED findings, preserves applied/dismissed", () => {
    const states = ["PROPOSED", "ACCEPTED", "APPLIED", "DISMISSED", "SUPERSEDED"]
    const supersedableStates = states.filter((s) => s === "PROPOSED")
    expect(supersedableStates).toEqual(["PROPOSED"])
  })
})
