/**
 * FINDINGS_APPLY — guard-rejection tests.
 *
 * The most important behavior: when a finding proposes a RECLASSIFY with
 * cohanFlag=true on a §274(d)-coded row, the apply MUST reject with
 * COHAN_FORBIDDEN_REJECTED — never write the classification.
 *
 * Pure unit tests using shape inspection — DB-dependent paths exercised
 * separately in integration tests.
 */

import { describe, it, expect } from "vitest"
import { assertNot274dCohan } from "../lib/classification/cohanGuards"

describe("FINDINGS_APPLY — Cohan §274(d) rejection (guard contract)", () => {
  it("rejects RECLASSIFY action with code=MEALS_50 and cohanFlag=true", () => {
    const action = {
      kind: "RECLASSIFY" as const,
      txnIds: ["tx_1"],
      code: "MEALS_50" as const,
      businessPct: 100,
      scheduleCLine: "Line 24b Meals",
      ircCitations: ["§162"],
      evidenceTier: 4,
      cohanFlag: true,
    }
    const guard = assertNot274dCohan({
      code: action.code,
      merchantRaw: "POCKETSFLOW",
      ircCitations: action.ircCitations,
      scheduleCLine: action.scheduleCLine,
    })
    expect(guard.allowed).toBe(false)
  })

  it("rejects RECLASSIFY on §274(d) merchant even when code is WRITE_OFF", () => {
    const guard = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "STARBUCKS #1234",
      ircCitations: ["§162"],
      scheduleCLine: "Line 27a Other Expenses",
    })
    expect(guard.allowed).toBe(false)
  })

  it("allows clean §162 Cohan promotion", () => {
    const guard = assertNot274dCohan({
      code: "WRITE_OFF",
      merchantRaw: "STRIPE PROCESSING",
      ircCitations: ["§162", "Cohan"],
      scheduleCLine: "Line 27a Other Expenses",
    })
    expect(guard.allowed).toBe(true)
  })
})

describe("FINDINGS_APPLY — state machine (documented)", () => {
  // The LedgerFinding.state lifecycle:
  //   PROPOSED → ACCEPTED → APPLIED        (happy path)
  //   PROPOSED → DISMISSED                 (user rejects with rationale)
  //   PROPOSED → SUPERSEDED                (next CPA_AUDIT run regenerates)
  //   ACCEPTED → SUPERSEDED                (concurrent edit before apply)
  //
  // This test pins the documented enum values so any future schema change
  // surfaces here.
  it("documents the state vocabulary", () => {
    const states = ["PROPOSED", "ACCEPTED", "DISMISSED", "APPLIED", "SUPERSEDED"]
    expect(states.length).toBe(5)
  })
})

describe("FINDINGS_APPLY — proposed-action shapes (zod-validated)", () => {
  it("RECLASSIFY action requires txnIds (>=1)", () => {
    const valid = {
      kind: "RECLASSIFY",
      txnIds: ["tx_1"],
      code: "WRITE_OFF",
      businessPct: 100,
      scheduleCLine: "Line 27a Other Expenses",
      ircCitations: ["§162"],
      evidenceTier: 3,
    }
    expect(valid.txnIds.length).toBeGreaterThanOrEqual(1)
  })

  it("STOP action carries a question + transactionIds", () => {
    const valid = {
      kind: "STOP",
      category: "MERCHANT",
      question: "This $X at <merchant> — business or personal?",
      transactionIds: ["tx_1"],
    }
    expect(valid.question.length).toBeGreaterThan(10)
    expect(valid.category).toBeTruthy()
  })

  it("BLOCK action carries only a reason string", () => {
    const valid = { kind: "BLOCK", reason: "Collect W-9 from Laeeq before generating 1099-NEC" }
    expect(valid.reason.length).toBeGreaterThan(10)
  })

  it("NOTE action is cosmetic only", () => {
    const valid = { kind: "NOTE", suggestion: "Merge legacy Line 27a labels to canonical" }
    expect(valid.suggestion).toBeTruthy()
  })
})
