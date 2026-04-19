import { describe, it, expect } from "vitest"
import { normalizeMerchant } from "../../lib/merchants/normalize"

// Helper
const key = (raw: string) => normalizeMerchant(raw).key
const display = (raw: string) => normalizeMerchant(raw).display

describe("normalizeMerchant — processor prefixes", () => {
  it("strips SQ *", () => expect(key("SQ *GYRO KING")).toBe("GYRO KING"))
  it("strips SQ* (no space)", () => expect(key("SQ*COFFEE SHOP")).toBe("COFFEE SHOP"))
  it("strips TST*", () => expect(key("TST* THE OCEAN ROOM")).toBe("THE OCEAN ROOM"))
  it("strips PAYPAL *", () => expect(key("PAYPAL *ADOBE")).toBe("ADOBE"))
  it("strips SP *", () => expect(key("SP *SHOPIFY STORE")).toBe("SHOPIFY STORE"))
  it("strips POS prefix", () => expect(key("POS PURCHASE SHELL OIL")).toBe("SHELL OIL"))
})

describe("normalizeMerchant — trailing phone", () => {
  it("strips US phone dashes", () =>
    expect(key("SQ *GYRO KING 512-555-0123 TX")).toBe("GYRO KING"))
  it("strips Amex phone format (402-XXXXXXX)", () =>
    expect(key("PAYPAL *ADOBE 402-9357733 CA")).toBe("ADOBE"))
  it("strips phone + state together", () =>
    expect(key("GYRO KING 512-555-0123 TX")).toBe("GYRO KING"))
})

describe("normalizeMerchant — trailing city/state/ZIP", () => {
  it("strips trailing state only", () =>
    expect(key("GYRO KING TX")).toBe("GYRO KING"))
  it("strips trailing ZIP", () =>
    expect(key("GYRO KING 78701")).toBe("GYRO KING"))
  it("strips trailing ZIP+4", () =>
    expect(key("TARGET STORE 77056-1234")).toBe("TARGET STORE"))
  it("strips city + state", () =>
    expect(key("TST* THE OCEAN ROOM    CHARLESTON SC")).toBe("THE OCEAN ROOM"))
  it("strips Anchorage AK suffix", () =>
    expect(key("BLUEWAVE CAR WASH ANCHORAGE AK")).toBe("BLUEWAVE CAR WASH"))
  it("preserves store number with hash", () =>
    expect(key("COSTCO WHSE #0147     HOUSTON TX 77056")).toBe("COSTCO WHSE #0147"))
})

describe("normalizeMerchant — Amex-style alphanum refs", () => {
  it("strips consonant-only ref suffix", () =>
    expect(key("AMAZON.COM 8W9PNDMS SEATTLE WA")).toBe("AMAZON.COM"))
  it("strips pure-hex ref suffix", () =>
    expect(key("NETFLIX.COM 8F3B2D")).toBe("NETFLIX.COM"))
})

describe("normalizeMerchant — numeric refs", () => {
  it("strips trailing 8-digit number", () =>
    expect(key("SHELL OIL 12345678901")).toBe("SHELL OIL"))
  it("strips trailing #number", () =>
    expect(key("UBER EATS #00293847")).toBe("UBER EATS"))
})

describe("normalizeMerchant — real fixture examples", () => {
  it("glacier cruise preserves full name", () =>
    expect(key("STAN STEPHENS GLACIER CRUISE  VALDEZ AK")).toBe("STAN STEPHENS GLACIER CRUISE"))
  it("Zelle preserves payee name", () =>
    expect(key("ZELLE TO FRANCISCO A 8839247")).toBe("ZELLE TO FRANCISCO A"))
  it("Chase autopay strips date suffix", () =>
    expect(key("CHASE CREDIT CRD AUTOPAY 04/12")).toBe("CHASE CREDIT CRD AUTOPAY"))
  it("Bluewave with store number preserves it", () =>
    expect(key("BLUEWAVE CAR WASH #22  ANCHORAGE AK")).toBe("BLUEWAVE CAR WASH #22"))
  it("Adobe via PayPal", () =>
    expect(key("PAYPAL *ADOBE 402-9357733 CA")).toBe("ADOBE"))
  it("Amazon with ref", () =>
    expect(key("AMAZON.COM*8W9PNDMS  SEATTLE WA")).toBe("AMAZON.COM"))
})

describe("normalizeMerchant — idempotency", () => {
  const samples = [
    "SQ *GYRO KING 512-555-0123 TX",
    "PAYPAL *ADOBE 402-9357733",
    "BLUEWAVE CAR WASH #22 ANCHORAGE AK",
    "STAN STEPHENS GLACIER CRUISE VALDEZ AK",
    "TST* THE OCEAN ROOM CHARLESTON SC",
  ]
  samples.forEach((raw) => {
    it(`idempotent: "${raw}"`, () => {
      const once = normalizeMerchant(raw).key
      const twice = normalizeMerchant(normalizeMerchant(raw).display).key
      expect(twice).toBe(once)
    })
  })
})

describe("normalizeMerchant — fallback safety", () => {
  it("never returns empty string for garbage input", () => {
    expect(key("SQ * ")).not.toBe("")
    expect(key("   ")).not.toBe("")
  })
  it("display name is title-cased", () =>
    expect(display("STAN STEPHENS GLACIER CRUISE VALDEZ AK")).toBe(
      "Stan Stephens Glacier Cruise"
    ))
})
