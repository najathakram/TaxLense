import { describe, it, expect } from "vitest"
import { inferAccountKind, isMoneyMoverOutflow } from "@/lib/accounts/kind"

describe("inferAccountKind", () => {
  it("classifies traditional banks as TRADITIONAL", () => {
    expect(inferAccountKind("Chase Bank")).toBe("TRADITIONAL")
    expect(inferAccountKind("Bank of America")).toBe("TRADITIONAL")
    expect(inferAccountKind("Wells Fargo")).toBe("TRADITIONAL")
    expect(inferAccountKind("Citi")).toBe("TRADITIONAL")
    expect(inferAccountKind("American Express")).toBe("TRADITIONAL")
  })

  it("classifies known money-movers as MONEY_MOVER", () => {
    expect(inferAccountKind("Wise")).toBe("MONEY_MOVER")
    expect(inferAccountKind("TransferWise")).toBe("MONEY_MOVER")
    expect(inferAccountKind("PayPal")).toBe("MONEY_MOVER")
    expect(inferAccountKind("Venmo")).toBe("MONEY_MOVER")
    expect(inferAccountKind("Cash App")).toBe("MONEY_MOVER")
    expect(inferAccountKind("Stripe Balance")).toBe("MONEY_MOVER")
    expect(inferAccountKind("Zelle")).toBe("MONEY_MOVER")
    expect(inferAccountKind("Pocketsflow")).toBe("MONEY_MOVER")
    expect(inferAccountKind("Remitly")).toBe("MONEY_MOVER")
    expect(inferAccountKind("Revolut")).toBe("MONEY_MOVER")
  })

  it("is case-insensitive and handles whitespace", () => {
    expect(inferAccountKind("  WISE  ")).toBe("MONEY_MOVER")
    expect(inferAccountKind("paypal")).toBe("MONEY_MOVER")
    expect(inferAccountKind("My CASH APP wallet")).toBe("MONEY_MOVER")
  })

  it("defaults to TRADITIONAL on empty / whitespace", () => {
    expect(inferAccountKind("")).toBe("TRADITIONAL")
    expect(inferAccountKind("   ")).toBe("TRADITIONAL")
  })
})

describe("isMoneyMoverOutflow", () => {
  it("matches Atif's actual prod merchant strings", () => {
    // Real Chase Business Checking outflows seen on Atif's 2025 ledger.
    expect(isMoneyMoverOutflow("WISE INC")).toBe(true)
    expect(isMoneyMoverOutflow("WISE INC Wise Transfer")).toBe(true)
    expect(isMoneyMoverOutflow("WISE INC Wise transfer")).toBe(true)
    expect(isMoneyMoverOutflow("WISE INC ACH Withdrawal")).toBe(true)
  })

  it("matches common wallet outflow patterns", () => {
    expect(isMoneyMoverOutflow("PAYPAL ACH WITHDRAWAL")).toBe(true)
    expect(isMoneyMoverOutflow("VENMO PAYMENT")).toBe(true)
    expect(isMoneyMoverOutflow("CASH APP TRANSFER")).toBe(true)
    expect(isMoneyMoverOutflow("CASHAPP*ZAYNAB")).toBe(false) // CASHAPP without space — intentional false (this is a Cash App PURCHASE merchant string, not a top-up)
    expect(isMoneyMoverOutflow("ZELLE TO JOHN DOE")).toBe(true)
    expect(isMoneyMoverOutflow("ZELLE PAYMENT JOHN")).toBe(true)
    expect(isMoneyMoverOutflow("STRIPE TRANSFER")).toBe(true)
    expect(isMoneyMoverOutflow("POCKETSFLOW DES:TRANSFER")).toBe(true)
    expect(isMoneyMoverOutflow("REMITLY")).toBe(true)
    expect(isMoneyMoverOutflow("REVOLUT TOPUP")).toBe(true)
  })

  it("does not match unrelated outflows", () => {
    expect(isMoneyMoverOutflow("AMAZON.COM")).toBe(false)
    expect(isMoneyMoverOutflow("SHELL OIL")).toBe(false)
    expect(isMoneyMoverOutflow("ADOBE SYSTEMS")).toBe(false)
    expect(isMoneyMoverOutflow("CHASE BANK Monthly Service Fee")).toBe(false)
    expect(isMoneyMoverOutflow("SQUARE INC Account verification")).toBe(false)
  })

  it("does not false-positive on words containing wallet names", () => {
    // "wisely" / "wisecracker" / "moneywise" must not match \bwise\b
    expect(isMoneyMoverOutflow("WISELY PAYROLL CARD")).toBe(false)
    expect(isMoneyMoverOutflow("MONEYWISE FINANCIAL")).toBe(false)
    expect(isMoneyMoverOutflow("OTHERWISE INC")).toBe(false)
  })
})
