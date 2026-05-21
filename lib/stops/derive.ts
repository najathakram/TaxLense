import type { TransactionCode, ClassificationSource } from "@/app/generated/prisma/client"

export type StopAnswer =
  | {
      kind: "merchant"
      choice: "ALL_BUSINESS" | "DURING_TRIPS" | "MIXED_50" | "PERSONAL" | "OTHER"
      other?: string
      scheduleCLine?: string
    }
  | {
      kind: "transfer"
      // Extended 2026-05-22 with the three cases that the CPA flow surfaced
      // most often on Atif's prod ledger:
      //   - SUPPLIER : Wise/PayPal/etc. outbound to an overseas inventory
      //                supplier — was getting force-fit into CONTRACTOR
      //   - CHARGEBACK: bounced check / RETURN ITEM CHARGEBACK on the bank
      //                 side; nets against prior BIZ_INCOME via Line 1b
      //   - OWNER_EQUITY: true transfer to / from the owner's external
      //                   account (sole prop / SMLLC only — partnerships
      //                   route through the K-1 / Schedule M-2 flow)
      choice:
        | "PERSONAL"
        | "CONTRACTOR"
        | "SUPPLIER"
        | "CHARGEBACK"
        | "OWNER_EQUITY"
        | "LOAN"
        | "OTHER"
      other?: string
      payeeName?: string
      purpose?: string
    }
  | {
      kind: "deposit"
      choice: "CLIENT" | "PLATFORM_1099" | "W2" | "OWNER_CONTRIB" | "GIFT" | "LOAN" | "REFUND" | "OTHER"
      other?: string
    }
  | {
      kind: "section_274d"
      attendees: string
      relationship: "CLIENT" | "PROSPECT" | "VENDOR" | "EMPLOYEE" | "OTHER"
      purpose: string
      outcome?: string
    }

export interface Derived {
  code: TransactionCode
  businessPct: number
  scheduleCLine: string | null
  ircCitations: string[]
  evidenceTier: number
  reasoning: string
  source: ClassificationSource
  /** §274(d) structured substantiation — written to Classification.substantiation
   *  so the audit packet, A08 assertion, and per-row ledger view all read from
   *  the same place. Only populated for section_274d answers in V1. */
  substantiation?: Record<string, unknown>
}

export function deriveFromAnswer(
  answer: StopAnswer,
  fallback?: { ruleCode?: TransactionCode; ruleLine?: string | null }
): Derived {
  switch (answer.kind) {
    case "merchant":
      switch (answer.choice) {
        case "ALL_BUSINESS":
          return {
            code: "WRITE_OFF",
            businessPct: 100,
            scheduleCLine: answer.scheduleCLine ?? fallback?.ruleLine ?? "Line 27a Other Expenses",
            ircCitations: ["§162"],
            evidenceTier: 3,
            reasoning: "User confirmed: fully business expense.",
            source: fallback?.ruleCode === "WRITE_OFF" ? "AI_USER_CONFIRMED" : "USER",
          }
        case "DURING_TRIPS":
          return {
            code: "WRITE_OFF_TRAVEL",
            businessPct: 100,
            scheduleCLine: "Line 24a Travel",
            ircCitations: ["§162", "§274(d)"],
            evidenceTier: 2,
            reasoning: "User confirmed: business during confirmed trips only.",
            source: "USER",
          }
        case "MIXED_50":
          return {
            code: "GRAY",
            businessPct: 50,
            scheduleCLine: answer.scheduleCLine ?? fallback?.ruleLine ?? "Line 27a Other Expenses",
            ircCitations: ["§162"],
            evidenceTier: 3,
            reasoning: "User confirmed: mixed-use, allocated 50% business.",
            source: "USER",
          }
        case "PERSONAL":
          return {
            code: "PERSONAL",
            businessPct: 0,
            scheduleCLine: null,
            ircCitations: ["§262"],
            evidenceTier: 3,
            reasoning: "User confirmed: personal/non-deductible.",
            source: fallback?.ruleCode === "PERSONAL" ? "AI_USER_CONFIRMED" : "USER",
          }
        case "OTHER":
          return {
            code: "NEEDS_CONTEXT",
            businessPct: 0,
            scheduleCLine: null,
            ircCitations: [],
            evidenceTier: 3,
            reasoning: `User note: ${answer.other ?? "(no note)"}`,
            source: "USER",
          }
      }
      break
    case "transfer":
      switch (answer.choice) {
        case "PERSONAL":
          return {
            code: "PERSONAL",
            businessPct: 0,
            scheduleCLine: null,
            ircCitations: ["§262"],
            evidenceTier: 3,
            reasoning: "User confirmed transfer is personal/household.",
            source: "USER",
          }
        case "CONTRACTOR":
          return {
            code: "WRITE_OFF",
            businessPct: 100,
            scheduleCLine: "Line 11 Contract Labor",
            ircCitations: ["§162"],
            evidenceTier: 3,
            reasoning: `Contractor payment to ${answer.payeeName ?? "(unnamed)"}: ${answer.purpose ?? ""}`,
            source: "USER",
          }
        case "SUPPLIER":
          return {
            code: "WRITE_OFF_COGS",
            businessPct: 100,
            scheduleCLine: "Part III COGS",
            ircCitations: ["§162", "§263A"],
            evidenceTier: 3,
            reasoning: `Supplier payment to ${answer.payeeName ?? "(unnamed)"}: ${answer.purpose ?? "inventory/COGS"}.`,
            source: "USER",
          }
        case "CHARGEBACK":
          // Bounced check / RETURN ITEM CHARGEBACK — the inflow row is a
          // reversal of a prior BIZ_INCOME deposit. Classifying it as
          // BIZ_INCOME with negative amount nets correctly against Line 1b
          // returns/allowances. CPA must confirm the original deposit was
          // also coded BIZ_INCOME; the audit packet flags the pair.
          return {
            code: "BIZ_INCOME",
            businessPct: 100,
            scheduleCLine: "Line 1b Returns and allowances",
            ircCitations: ["§61"],
            evidenceTier: 2,
            reasoning: `User confirmed bank-side chargeback/bounced item — nets the prior BIZ_INCOME deposit.`,
            source: "USER",
          }
        case "OWNER_EQUITY":
          return {
            code: "OWNER_EQUITY",
            businessPct: 0,
            scheduleCLine: null,
            ircCitations: ["§61"],
            evidenceTier: 2,
            reasoning: "User confirmed transfer to/from the owner's external account.",
            source: "USER",
          }
        case "LOAN":
          return {
            code: "TRANSFER",
            businessPct: 0,
            scheduleCLine: null,
            ircCitations: [],
            evidenceTier: 3,
            reasoning: "User confirmed loan proceeds / repayment — non-deductible.",
            source: "USER",
          }
        case "OTHER":
          return {
            code: "NEEDS_CONTEXT",
            businessPct: 0,
            scheduleCLine: null,
            ircCitations: [],
            evidenceTier: 3,
            reasoning: `User note: ${answer.other ?? "(no note)"}`,
            source: "USER",
          }
      }
      break
    case "deposit":
      switch (answer.choice) {
        case "CLIENT":
        case "PLATFORM_1099":
          return {
            code: "BIZ_INCOME",
            businessPct: 100,
            scheduleCLine: "Line 1 Gross Receipts",
            ircCitations: ["§61"],
            evidenceTier: 2,
            reasoning: `User confirmed ${answer.choice === "CLIENT" ? "client payment" : "1099 platform payout"}.`,
            source: "USER",
          }
        case "W2":
        case "OWNER_CONTRIB":
        case "GIFT":
        case "LOAN":
          return {
            code: "TRANSFER",
            businessPct: 0,
            scheduleCLine: null,
            ircCitations: [],
            evidenceTier: 3,
            reasoning: `User classified deposit as ${answer.choice}.`,
            source: "USER",
          }
        case "REFUND":
          return {
            code: "WRITE_OFF",
            businessPct: 100,
            scheduleCLine: null,
            ircCitations: [],
            evidenceTier: 3,
            reasoning: "User confirmed vendor refund — offsets prior expense.",
            source: "USER",
          }
        case "OTHER":
          return {
            code: "NEEDS_CONTEXT",
            businessPct: 0,
            scheduleCLine: null,
            ircCitations: [],
            evidenceTier: 3,
            reasoning: `User note: ${answer.other ?? "(no note)"}`,
            source: "USER",
          }
      }
      break
    case "section_274d":
      return {
        code: "MEALS_50",
        businessPct: 100,
        scheduleCLine: "Line 24b Meals",
        ircCitations: ["§162", "§274(d)", "§274(n)(1)"],
        evidenceTier: 2,
        reasoning: `Attendees: ${answer.attendees}. Relationship: ${answer.relationship}. Purpose: ${answer.purpose}.${answer.outcome ? ` Outcome: ${answer.outcome}.` : ""}`,
        source: "USER",
        substantiation: {
          attendees: answer.attendees,
          relationship: answer.relationship,
          purpose: answer.purpose,
          ...(answer.outcome ? { outcome: answer.outcome } : {}),
          // capturedAt lets the audit packet show *when* the substantiation was
          // recorded, in case the IRS needs to test contemporaneousness.
          capturedAt: new Date().toISOString(),
        },
      }
  }
  throw new Error("Unknown StopAnswer shape")
}
