/**
 * Pure-function tests for lib/pairing/accountAliases.ts.
 *
 * Routing-number / bank-product / mask hint extraction is the building block
 * for hint-aware transfer pairing AND hint-based owner-equity classification.
 * These tests pin the behavior of every extractor so a regex tweak can't
 * silently break detection across the pipeline.
 */

import { describe, it, expect } from "vitest"
import {
  parseRoutingNumber,
  parseBankProductHint,
  parseAccountMaskHint,
  extractTransferHints,
  matchHintToAccount,
  ROUTING_NUMBER_INSTITUTIONS,
  type AccountForMatching,
} from "../lib/pairing/accountAliases"

describe("parseRoutingNumber", () => {
  it("extracts Chase routing 021000021 from 'Aba/Contr Bnk-021000021'", () => {
    const r = parseRoutingNumber("ONLINE TRANSFER · Transfer from Aba/Contr Bnk-021000021")
    expect(r).not.toBeNull()
    expect(r!.routing).toBe("021000021")
    expect(r!.institution).toBe("Chase")
  })

  it("extracts BofA routing 026009593", () => {
    const r = parseRoutingNumber("ACH IN 026009593 0001234567")
    expect(r?.institution).toBe("Bank of America")
  })

  it("extracts Wells Fargo routing 121000248", () => {
    const r = parseRoutingNumber("WIRE FROM 121000248 ACCT 9999999")
    expect(r?.institution).toBe("Wells Fargo")
  })

  it("returns null when no 9-digit routing run is present", () => {
    expect(parseRoutingNumber("STARBUCKS COFFEE")).toBeNull()
    expect(parseRoutingNumber("AMAZON 12345678")).toBeNull() // 8 digits
  })

  it("returns null when 9-digit run is NOT a known routing number", () => {
    const r = parseRoutingNumber("REF 123456789 TRANS")
    expect(r).toBeNull()
  })

  it("returns null on null/undefined/empty input", () => {
    expect(parseRoutingNumber(null)).toBeNull()
    expect(parseRoutingNumber(undefined)).toBeNull()
    expect(parseRoutingNumber("")).toBeNull()
  })

  it("does NOT match a 9-digit run embedded inside a longer number", () => {
    // 12-digit transaction ID with 021000021 in the middle — shouldn't match
    expect(parseRoutingNumber("TXN ID 100021000021999")).toBeNull()
  })

  it("ROUTING_NUMBER_INSTITUTIONS has the major banks", () => {
    expect(ROUTING_NUMBER_INSTITUTIONS["021000021"]).toBe("Chase")
    expect(ROUTING_NUMBER_INSTITUTIONS["026009593"]).toBe("Bank of America")
    expect(ROUTING_NUMBER_INSTITUTIONS["121000248"]).toBe("Wells Fargo")
    expect(ROUTING_NUMBER_INSTITUTIONS["021000089"]).toBe("Citibank")
  })
})

describe("parseBankProductHint", () => {
  it("'ADV PLUS BANKING' → Bank of America", () => {
    expect(parseBankProductHint("ONLINE TRANSFER FROM ADV PLUS BANKING")?.institution).toBe(
      "Bank of America",
    )
    expect(parseBankProductHint("Adv Plus Banking 5484")?.institution).toBe("Bank of America")
  })

  it("'BofA' / 'B of A' / 'Bank of America' all map to Bank of America", () => {
    expect(parseBankProductHint("BofA Checking xfer")?.institution).toBe("Bank of America")
    expect(parseBankProductHint("transfer from b of a")?.institution).toBe("Bank of America")
    expect(parseBankProductHint("BANK OF AMERICA WIRE")?.institution).toBe("Bank of America")
  })

  it("'Chase' / 'JPMorgan' / 'Chase Business' map to Chase", () => {
    expect(parseBankProductHint("CHASE QUICKPAY")?.institution).toBe("Chase")
    expect(parseBankProductHint("JPMORGAN CHASE BANK")?.institution).toBe("Chase")
    expect(parseBankProductHint("Chase Business Checking")?.institution).toBe("Chase")
  })

  it("returns null when no product pattern matches", () => {
    expect(parseBankProductHint("STARBUCKS COFFEE")).toBeNull()
    expect(parseBankProductHint("UBER EATS")).toBeNull()
  })

  it("returns null on null/empty input", () => {
    expect(parseBankProductHint(null)).toBeNull()
    expect(parseBankProductHint("")).toBeNull()
  })
})

describe("parseAccountMaskHint", () => {
  it("'ENDING IN 1206' → 1206", () => {
    expect(parseAccountMaskHint("PAYMENT TO CARD ENDING IN 1206")).toBe("1206")
  })

  it("'Checking 7403' → 7403", () => {
    expect(parseAccountMaskHint("ONLINE TRANSFER · Transfer To Checking 7403")).toBe("7403")
  })

  it("'CC 5484' → 5484", () => {
    expect(parseAccountMaskHint("PMT TO CC 5484 THANK YOU")).toBe("5484")
  })

  it("'x-1206' → 1206", () => {
    expect(parseAccountMaskHint("CARD x-1206")).toBe("1206")
  })

  it("'...1206' → 1206", () => {
    expect(parseAccountMaskHint("Chase Card …1206")).toBe("1206")
  })

  it("does NOT match arbitrary 4-digit numbers", () => {
    expect(parseAccountMaskHint("AMAZON 2024 BOOKS")).toBeNull()
    expect(parseAccountMaskHint("PAYMENT 1234 OF 5678")).toBeNull()
  })

  it("returns null on null/empty input", () => {
    expect(parseAccountMaskHint(null)).toBeNull()
    expect(parseAccountMaskHint("")).toBeNull()
  })
})

describe("extractTransferHints — composite", () => {
  it("combines routing + mask in one merchant string", () => {
    const h = extractTransferHints(
      "ONLINE TRANSFER · Transfer from Aba/Contr Bnk-021000021 to checking 7403",
    )
    expect(h.routingInstitution).toBe("Chase")
    expect(h.maskHint).toBe("7403")
    expect(h.inferredInstitution).toBe("Chase") // routing wins
  })

  it("falls back to product when no routing present", () => {
    const h = extractTransferHints("ONLINE TRANSFER FROM ADV PLUS BANKING")
    expect(h.routingInstitution).toBeNull()
    expect(h.productInstitution).toBe("Bank of America")
    expect(h.inferredInstitution).toBe("Bank of America")
  })

  it("returns all-null for a non-transfer merchant", () => {
    const h = extractTransferHints("STARBUCKS COFFEE")
    expect(h.routingInstitution).toBeNull()
    expect(h.productInstitution).toBeNull()
    expect(h.maskHint).toBeNull()
    expect(h.inferredInstitution).toBeNull()
  })
})

describe("matchHintToAccount", () => {
  const atifAccounts: AccountForMatching[] = [
    { id: "acc-chase-biz", institution: "Chase", mask: "0169", nickname: "Chase Business" },
    { id: "acc-bofa", institution: "Bank of America", mask: "5484", nickname: "BofA Checking" },
    { id: "acc-chase-cc", institution: "Chase", mask: "1206", nickname: "Chase CC" },
    { id: "acc-wise", institution: "Wise", mask: null, nickname: null },
  ]

  it("mask + institution match → strongest", () => {
    const hints = extractTransferHints("PAYMENT TO CC ENDING IN 1206 CHASE")
    const m = matchHintToAccount(hints, atifAccounts, "acc-chase-biz")
    expect(m?.accountId).toBe("acc-chase-cc")
    expect(m?.reason).toMatch(/mask\+institution/)
  })

  it("mask-only match works when institution missing", () => {
    const hints = extractTransferHints("Transfer To Checking 5484")
    const m = matchHintToAccount(hints, atifAccounts, "acc-chase-biz")
    expect(m?.accountId).toBe("acc-bofa")
  })

  it("institution-only match works when exactly one tracked account at that institution", () => {
    const hints = extractTransferHints("WIRE FROM BANK OF AMERICA")
    const m = matchHintToAccount(hints, atifAccounts, "acc-chase-biz")
    expect(m?.accountId).toBe("acc-bofa") // only one BofA account
  })

  it("institution-only does NOT match when AMBIGUOUS (multiple accounts at same institution)", () => {
    const hints = extractTransferHints("CHASE QUICKPAY")
    const m = matchHintToAccount(hints, atifAccounts, null)
    // Atif has 2 Chase accounts (Business Checking + CC); institution-only is ambiguous
    expect(m).toBeNull()
  })

  it("returns null when the hint points to an untracked institution", () => {
    // Wells Fargo isn't in Atif's tracked accounts → owner-equity candidate
    const hints = extractTransferHints("WIRE FROM 121000248")
    const m = matchHintToAccount(hints, atifAccounts, "acc-chase-biz")
    expect(m).toBeNull()
  })

  it("excludes the source account itself", () => {
    const hints = extractTransferHints("Transfer To Checking 0169") // same as source
    const m = matchHintToAccount(hints, atifAccounts, "acc-chase-biz")
    expect(m).toBeNull()
  })

  it("returns null when no hint extractable", () => {
    const hints = extractTransferHints("STARBUCKS")
    const m = matchHintToAccount(hints, atifAccounts, null)
    expect(m).toBeNull()
  })
})

describe("Atif's specific unpaired-transfer rows — integration", () => {
  const atifAccounts: AccountForMatching[] = [
    { id: "acc-chase-biz", institution: "Chase", mask: "0169", nickname: "Chase Business" },
    { id: "acc-bofa", institution: "Bank of America", mask: "5484", nickname: "BofA Checking" },
    { id: "acc-chase-cc", institution: "Chase", mask: "1206", nickname: "Chase CC" },
    { id: "acc-wise", institution: "Wise", mask: null, nickname: null },
  ]

  it("'REAL TIME TRANSFER · Transfer from Aba/Contr Bnk-021000021' → Chase, ambiguous → null match → owner-equity candidate", () => {
    const hints = extractTransferHints(
      "REAL TIME TRANSFER · Transfer from Aba/Contr Bnk-021000021",
    )
    expect(hints.inferredInstitution).toBe("Chase")
    // Atif has TWO tracked Chase accounts (Biz Checking + CC) — institution alone is ambiguous,
    // so matchHintToAccount returns null. The hint pass classifies this as OWNER_EQUITY.
    const m = matchHintToAccount(hints, atifAccounts, "acc-chase-biz")
    expect(m).toBeNull()
  })

  it("'ONLINE TRANSFER FROM ADV PLUS BANKING' on Chase Biz → BofA tracked → matches BofA acct (don't owner-equity-flip)", () => {
    const hints = extractTransferHints("ONLINE TRANSFER FROM ADV PLUS BANKING")
    expect(hints.productInstitution).toBe("Bank of America")
    const m = matchHintToAccount(hints, atifAccounts, "acc-chase-biz")
    // BofA is tracked → resolves to BofA account → regular pairing handles it
    expect(m?.accountId).toBe("acc-bofa")
  })

  it("'Transfer To Checking 7403' → no tracked Atif account has mask 7403 → owner-equity candidate", () => {
    const hints = extractTransferHints("ONLINE TRANSFER · Transfer To Checking 7403")
    expect(hints.maskHint).toBe("7403")
    const m = matchHintToAccount(hints, atifAccounts, "acc-chase-biz")
    expect(m).toBeNull() // 7403 is an UNTRACKED personal checking
  })
})
