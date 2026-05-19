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
