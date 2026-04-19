/**
 * Pairing logic unit tests — pure logic extracted for testability.
 * DB calls tested via integration; here we test the scoring and matching helpers.
 */
import { describe, it, expect } from "vitest"
import { normalizeMerchant } from "../../lib/merchants/normalize"

// ---------------------------------------------------------------
// Helpers replicated from pairing modules for unit testing
// ---------------------------------------------------------------

function toCents(amount: number): number {
  return Math.round(amount * 100)
}

const TRANSFER_KEYWORDS = /zelle|venmo|transfer|move|xfer|ach|wire/i
const WINDOW_DAYS = 5
const PAYMENT_PATTERNS =
  /payment\s+thank\s+you|online\s+payment|autopay|mobile\s+payment|bill\s+pay|credit\s+crd|card\s+payment|automatic\s+payment|payment\s+received/i

interface FakeTx {
  id: string
  accountId: string
  userId: string
  accountType: "CHECKING" | "CREDIT_CARD" | "SAVINGS"
  postedDate: Date
  amountNormalized: number
  merchantRaw: string
  merchantNormalized: string | null
}

function score(out: FakeTx, cand: FakeTx): number {
  let s = 0
  const dayDelta = Math.abs(
    (out.postedDate.getTime() - cand.postedDate.getTime()) / (1000 * 60 * 60 * 24)
  )
  if (dayDelta < 0.5) s += 100
  s += (WINDOW_DAYS - Math.floor(dayDelta)) * 10
  if (TRANSFER_KEYWORDS.test(out.merchantRaw)) s += 20
  if (TRANSFER_KEYWORDS.test(cand.merchantRaw)) s += 20
  return s
}

function withinWindow(a: FakeTx, b: FakeTx): boolean {
  const delta = Math.abs(a.postedDate.getTime() - b.postedDate.getTime())
  return delta <= WINDOW_DAYS * 86400000
}

function findTransferPair(
  outflow: FakeTx,
  candidates: FakeTx[]
): FakeTx | null {
  const absCents = toCents(outflow.amountNormalized)
  const eligible = candidates.filter(
    (c) =>
      c.accountId !== outflow.accountId &&
      c.userId === outflow.userId &&
      toCents(Math.abs(c.amountNormalized)) === absCents &&
      c.amountNormalized < 0 &&
      withinWindow(outflow, c)
  )
  if (eligible.length === 0) return null
  eligible.sort((a, b) => score(outflow, b) - score(outflow, a) || a.id.localeCompare(b.id))
  return eligible[0]!
}

// ---------------------------------------------------------------
// Transfer matching tests
// ---------------------------------------------------------------

describe("Transfer matching", () => {
  const d = (offset: number) => new Date(Date.UTC(2025, 5, 1) + offset * 86400000)
  const userId = "user1"

  const checkingOut: FakeTx = {
    id: "out1", accountId: "checking1", userId, accountType: "CHECKING",
    postedDate: d(0), amountNormalized: 2500.00, merchantRaw: "ZELLE TO SAVINGS"
    , merchantNormalized: "ZELLE TO SAVINGS",
  }
  const savingsIn: FakeTx = {
    id: "in1", accountId: "savings1", userId, accountType: "SAVINGS",
    postedDate: d(1), amountNormalized: -2500.00, merchantRaw: "ZELLE FROM CHECKING"
    , merchantNormalized: "ZELLE FROM CHECKING",
  }
  const falseCandidate: FakeTx = {
    id: "in2", accountId: "savings1", userId, accountType: "SAVINGS",
    postedDate: d(10), amountNormalized: -2500.00, merchantRaw: "ZELLE FROM CHECKING"
    , merchantNormalized: "ZELLE FROM CHECKING",
  }
  const wrongAmountCandidate: FakeTx = {
    id: "in3", accountId: "savings1", userId, accountType: "SAVINGS",
    postedDate: d(1), amountNormalized: -2501.00, merchantRaw: "ZELLE FROM CHECKING"
    , merchantNormalized: "ZELLE FROM CHECKING",
  }
  const differentUserCandidate: FakeTx = {
    id: "in4", accountId: "savings2", userId: "user2", accountType: "SAVINGS",
    postedDate: d(1), amountNormalized: -2500.00, merchantRaw: "ZELLE FROM CHECKING"
    , merchantNormalized: "ZELLE FROM CHECKING",
  }

  it("matches same-day transfer", () => {
    const sameDay: FakeTx = { ...savingsIn, postedDate: d(0) }
    const result = findTransferPair(checkingOut, [sameDay])
    expect(result?.id).toBe(sameDay.id)
  })

  it("matches transfer within 5-day window", () => {
    const result = findTransferPair(checkingOut, [savingsIn])
    expect(result?.id).toBe("in1")
  })

  it("rejects inflow outside 5-day window", () => {
    const result = findTransferPair(checkingOut, [falseCandidate])
    expect(result).toBeNull()
  })

  it("rejects wrong amount candidate", () => {
    const result = findTransferPair(checkingOut, [wrongAmountCandidate])
    expect(result).toBeNull()
  })

  it("rejects different user account", () => {
    const result = findTransferPair(checkingOut, [differentUserCandidate])
    expect(result).toBeNull()
  })

  it("prefers same-day over later match when both valid", () => {
    const sameDay: FakeTx = { ...savingsIn, id: "same", postedDate: d(0) }
    const result = findTransferPair(checkingOut, [savingsIn, sameDay])
    expect(result?.id).toBe("same")
  })

  it("does not match same account (internal entry)", () => {
    const sameAccount: FakeTx = { ...savingsIn, accountId: "checking1" }
    const result = findTransferPair(checkingOut, [sameAccount])
    expect(result).toBeNull()
  })

  it("transfer keywords boost score", () => {
    const withKeyword: FakeTx = { ...savingsIn, id: "kw", merchantRaw: "TRANSFER FROM CHECKING" }
    const withoutKeyword: FakeTx = { ...savingsIn, id: "nk", merchantRaw: "DIRECT DEPOSIT" }
    const scoreWith = score(checkingOut, withKeyword)
    const scoreWithout = score(checkingOut, withoutKeyword)
    expect(scoreWith).toBeGreaterThan(scoreWithout)
  })
})

// ---------------------------------------------------------------
// Payment matching tests
// ---------------------------------------------------------------

describe("Payment matching", () => {
  const d = (offset: number) => new Date(Date.UTC(2025, 5, 1) + offset * 86400000)
  const userId = "user1"

  it("identifies card payment raw descriptions", () => {
    expect(PAYMENT_PATTERNS.test("PAYMENT THANK YOU")).toBe(true)
    expect(PAYMENT_PATTERNS.test("ONLINE PAYMENT - THANK YOU")).toBe(true)
    expect(PAYMENT_PATTERNS.test("AUTOPAY PAYMENT")).toBe(true)
    expect(PAYMENT_PATTERNS.test("CHASE CREDIT CRD AUTOPAY")).toBe(true)
    expect(PAYMENT_PATTERNS.test("AUTOMATIC PAYMENT")).toBe(true)
  })

  it("does not match regular purchases as payments", () => {
    expect(PAYMENT_PATTERNS.test("AMAZON.COM")).toBe(false)
    expect(PAYMENT_PATTERNS.test("STARBUCKS")).toBe(false)
    expect(PAYMENT_PATTERNS.test("ADOBE")).toBe(false)
  })

  it("matches card inflow to checking outflow within 5 days", () => {
    const cardPayment: FakeTx = {
      id: "cp1", accountId: "amex1", userId, accountType: "CREDIT_CARD",
      postedDate: d(0), amountNormalized: -1200.00, merchantRaw: "PAYMENT THANK YOU"
      , merchantNormalized: null,
    }
    const checkingOut: FakeTx = {
      id: "co1", accountId: "checking1", userId, accountType: "CHECKING",
      postedDate: d(2), amountNormalized: 1200.00, merchantRaw: "AMEX PAYMENT"
      , merchantNormalized: null,
    }
    // Card inflow abs amount = checking outflow amount
    expect(Math.abs(toCents(cardPayment.amountNormalized))).toBe(toCents(checkingOut.amountNormalized))
    expect(withinWindow(cardPayment, checkingOut)).toBe(true)
  })

  it("does not match when outside 10-day gap", () => {
    const cardPayment: FakeTx = {
      id: "cp2", accountId: "amex1", userId, accountType: "CREDIT_CARD",
      postedDate: d(0), amountNormalized: -1200.00, merchantRaw: "PAYMENT THANK YOU"
      , merchantNormalized: null,
    }
    const checkingOut: FakeTx = {
      id: "co2", accountId: "checking1", userId, accountType: "CHECKING",
      postedDate: d(10), amountNormalized: 1200.00, merchantRaw: "AMEX PAYMENT"
      , merchantNormalized: null,
    }
    expect(withinWindow(cardPayment, checkingOut)).toBe(false)
  })
})

// ---------------------------------------------------------------
// Refund matching tests
// ---------------------------------------------------------------

describe("Refund matching", () => {
  const d = (offset: number) => new Date(Date.UTC(2025, 3, 1) + offset * 86400000)

  function findRefundPair(
    refund: FakeTx,
    charges: FakeTx[]
  ): FakeTx | null {
    const windowStart = new Date(refund.postedDate.getTime() - 90 * 86400000)
    const absCents = toCents(Math.abs(refund.amountNormalized))
    const merchant = refund.merchantNormalized?.toUpperCase()
    if (!merchant) return null

    const eligible = charges.filter(
      (c) =>
        c.accountId === refund.accountId &&
        c.amountNormalized > 0 &&
        c.merchantNormalized?.toUpperCase() === merchant &&
        c.postedDate >= windowStart &&
        c.postedDate < refund.postedDate
    )
    if (eligible.length === 0) return null

    eligible.sort((a, b) => {
      const ad = Math.abs(toCents(a.amountNormalized) - absCents)
      const bd = Math.abs(toCents(b.amountNormalized) - absCents)
      if (ad !== bd) return ad - bd
      return b.postedDate.getTime() - a.postedDate.getTime()
    })
    return eligible[0]!
  }

  it("matches refund to prior same-merchant charge", () => {
    const charge: FakeTx = {
      id: "ch1", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(0), amountNormalized: 89.00, merchantRaw: "AMAZON", merchantNormalized: "AMAZON",
    }
    const refund: FakeTx = {
      id: "rf1", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(15), amountNormalized: -89.00, merchantRaw: "AMAZON REFUND", merchantNormalized: "AMAZON",
    }
    const result = findRefundPair(refund, [charge])
    expect(result?.id).toBe("ch1")
  })

  it("does not match refund to different merchant charge", () => {
    const charge: FakeTx = {
      id: "ch2", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(0), amountNormalized: 89.00, merchantRaw: "BEST BUY", merchantNormalized: "BEST BUY",
    }
    const refund: FakeTx = {
      id: "rf2", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(15), amountNormalized: -89.00, merchantRaw: "AMAZON REFUND", merchantNormalized: "AMAZON",
    }
    const result = findRefundPair(refund, [charge])
    expect(result).toBeNull()
  })

  it("does not match refund outside 90-day window", () => {
    const charge: FakeTx = {
      id: "ch3", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(0), amountNormalized: 89.00, merchantRaw: "AMAZON", merchantNormalized: "AMAZON",
    }
    const refund: FakeTx = {
      id: "rf3", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(100), amountNormalized: -89.00, merchantRaw: "AMAZON REFUND", merchantNormalized: "AMAZON",
    }
    const result = findRefundPair(refund, [charge])
    expect(result).toBeNull()
  })

  it("prefers closest amount match for partial refunds", () => {
    const fullCharge: FakeTx = {
      id: "ch4a", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(0), amountNormalized: 200.00, merchantRaw: "AMAZON", merchantNormalized: "AMAZON",
    }
    const smallerCharge: FakeTx = {
      id: "ch4b", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(5), amountNormalized: 89.00, merchantRaw: "AMAZON", merchantNormalized: "AMAZON",
    }
    const refund: FakeTx = {
      id: "rf4", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(20), amountNormalized: -89.00, merchantRaw: "AMAZON REFUND", merchantNormalized: "AMAZON",
    }
    const result = findRefundPair(refund, [fullCharge, smallerCharge])
    expect(result?.id).toBe("ch4b") // exact match preferred
  })

  it("does not match future charge as refund source", () => {
    const futureCharge: FakeTx = {
      id: "ch5", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(20), amountNormalized: 89.00, merchantRaw: "AMAZON", merchantNormalized: "AMAZON",
    }
    const refund: FakeTx = {
      id: "rf5", accountId: "amex1", userId: "u1", accountType: "CREDIT_CARD",
      postedDate: d(10), amountNormalized: -89.00, merchantRaw: "AMAZON REFUND", merchantNormalized: "AMAZON",
    }
    const result = findRefundPair(refund, [futureCharge])
    expect(result).toBeNull()
  })
})
