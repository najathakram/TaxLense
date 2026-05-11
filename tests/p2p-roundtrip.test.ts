import { describe, it, expect } from "vitest"
import { extractCounterparty } from "@/lib/pairing/p2pRoundTrip"

describe("extractCounterparty", () => {
  describe("ACH INDN field (most reliable)", () => {
    it("extracts from Pocketsflow merchant strings (Atif's actual prod data)", () => {
      expect(
        extractCounterparty(
          "POCKETSFLOW DES:TRANSFER ID:ST-G1J3I7Z2L0M4 INDN:KIRSTEN HATCH CO ID:1234567890",
        ),
      ).toBe("KIRSTEN HATCH")
      expect(
        extractCounterparty(
          "POCKETSFLOW DES:TRANSFER ID:ST-Q5H8A4C7K3A8 INDN:ZHAVONTIA CROSBY CO ID:0987654321",
        ),
      ).toBe("ZHAVONTIA CROSBY")
      expect(
        extractCounterparty(
          "POCKETSFLOW DES:TRANSFER ID:ST-A3F8J4Z2M6D0 INDN:SHAWNA LECOMPTE CO ID:1111",
        ),
      ).toBe("SHAWNA LECOMPTE")
    })

    it("handles INDN at end of string (no trailing CO ID)", () => {
      expect(extractCounterparty("ACH PAYMENT INDN:JOHN A SMITH")).toBe(
        "JOHN A SMITH",
      )
    })
  })

  describe("Wise SENT MONEY format", () => {
    it("extracts Pakistan supplier names", () => {
      expect(extractCounterparty("SENT MONEY TO ZAIN UL ABIDEEN SAFDAR TRANSFER-1532774071")).toBe(
        "ZAIN UL ABIDEEN SAFDAR",
      )
      expect(extractCounterparty("SENT MONEY TO USMAN ASLAM TRANSFER-1602069361")).toBe(
        "USMAN ASLAM",
      )
      expect(extractCounterparty("SENT MONEY TO MUHAMMAD FAISAL TRANSFER-1625395915")).toBe(
        "MUHAMMAD FAISAL",
      )
    })

    it("rejects corporate names (LLC, INC, etc.)", () => {
      expect(extractCounterparty("SENT MONEY TO SIMPLE CLUE LLC TRANSFER-1601192975")).toBe(
        null,
      )
      expect(extractCounterparty("SENT MONEY TO ALAMODETREND LTD TRANSFER-1602020203")).toBe(
        null,
      )
    })
  })

  describe("Zelle format", () => {
    it("matches TO and FROM directions", () => {
      expect(extractCounterparty("ZELLE TO JOHN DOE")).toBe("JOHN DOE")
      expect(extractCounterparty("ZELLE FROM JANE SMITH")).toBe("JANE SMITH")
      expect(extractCounterparty("ZELLE PAYMENT TO RANDI ESCOBAR")).toBe(
        "RANDI ESCOBAR",
      )
      expect(extractCounterparty("ZELLE PAYMENT FROM MARIA GONZALEZ")).toBe(
        "MARIA GONZALEZ",
      )
    })
  })

  describe("Venmo format", () => {
    it("converts dashes/underscores to spaces", () => {
      expect(extractCounterparty("VENMO PAYMENT JOHN-DOE")).toBe("JOHN DOE")
      expect(extractCounterparty("VENMO CASHOUT FROM JANE SMITH")).toBe(
        "JANE SMITH",
      )
    })
  })

  describe("name-shape guards", () => {
    it("rejects single-word names (need first+last)", () => {
      expect(extractCounterparty("SENT MONEY TO BOB TRANSFER-123")).toBe(null)
    })

    it("rejects names with digits", () => {
      expect(extractCounterparty("ZELLE TO ACCOUNT12345")).toBe(null)
    })

    it("rejects names that are too long", () => {
      expect(
        extractCounterparty(
          "ZELLE TO " + "A".repeat(60) + " B".repeat(10),
        ),
      ).toBe(null)
    })

    it("rejects corporate suffixes", () => {
      expect(extractCounterparty("ACH INDN:ACME CONSULTING SERVICES CO ID:1234")).toBe(
        null,
      )
      expect(extractCounterparty("ACH INDN:JOHN DOE CONSULTING CO ID:1234")).toBe(
        null,
      )
    })
  })

  describe("merchant strings that should NOT match", () => {
    it("returns null for generic merchant text", () => {
      expect(extractCounterparty("AMAZON.COM PURCHASE")).toBe(null)
      expect(extractCounterparty("SHELL OIL #4321")).toBe(null)
      expect(extractCounterparty("ADOBE SYSTEMS MONTHLY SUBSCRIPTION")).toBe(null)
      expect(extractCounterparty("CHASE BANK Monthly Service Fee")).toBe(null)
      expect(extractCounterparty("")).toBe(null)
    })
  })
})
