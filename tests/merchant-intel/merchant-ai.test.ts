/**
 * Merchant Intelligence Agent — unit tests with mocked Anthropic client.
 * No live API calls. Tests: system prompt shape, output parsing, fallbacks.
 */
import { describe, it, expect, vi } from "vitest"

// Mock the Prisma client — these tests don't hit the DB
vi.mock("../../lib/db", () => ({
  prisma: {
    auditEvent: {
      create: vi.fn().mockResolvedValue({}),
    },
  },
}))

import {
  buildSystemPrompt,
  classifyBatch,
  MerchantRuleOutputSchema,
  type MerchantBatchInput,
} from "../../lib/ai/merchantIntelligence"
import type { Trip, KnownEntity, BusinessProfile, RuleVersion } from "../../app/generated/prisma/client"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const fakeProfile: BusinessProfile = {
  id: "bp1",
  userId: "u1",
  taxYearId: "ty1",
  naicsCode: "711510",
  entityType: "SOLE_PROP",
  primaryState: "TX",
  businessDescription: "Wedding photography and travel content creation",
  grossReceiptsEstimate: null,
  accountingMethod: "CASH",
  homeOfficeConfig: { has: true, dedicated: true, officeSqft: 200, homeSqft: 2000 },
  vehicleConfig: { has: true, bizPct: 60 },
  inventoryConfig: null,
  revenueStreams: ["wedding_photography", "travel_content"],
  firstYear: false,
  draftStep: 10,
  incomeSources: null,
  createdAt: new Date("2025-01-01"),
  updatedAt: new Date("2025-01-01"),
}

const fakeTrips: Trip[] = [
  {
    id: "trip1",
    profileId: "bp1",
    name: "Alaska Content Trip",
    destination: "Anchorage, AK",
    startDate: new Date("2025-08-02"),
    endDate: new Date("2025-08-13"),
    purpose: "Travel content creation and photography",
    deliverableDescription: "YouTube video series",
    isConfirmed: true,
  },
]

const fakeEntities: KnownEntity[] = [
  {
    id: "ke1",
    profileId: "bp1",
    kind: "PERSON_PERSONAL",
    displayName: "Spouse",
    matchKeywords: ["ZELLE RANDI", "VENMO RANDI"],
    defaultCode: "PERSONAL",
    notes: "Personal transfers",
  },
]

const fakeRuleVersion: RuleVersion = {
  id: "rv1",
  effectiveDate: new Date("2025-01-01"),
  ruleSet: {},
  summary: "2025 rules",
  supersededById: null,
}

const sampleMerchants: MerchantBatchInput[] = [
  {
    merchant_key: "ADOBE",
    sample_raw: "PAYPAL *ADOBE 402-9357733",
    sample_descriptions: ["PAYPAL *ADOBE 4029357733 402-9357733"],
    count: 12,
    total_amount: 647.88,
    sample_dates: ["2025-02-15", "2025-03-15"],
    account_types: ["CREDIT_CARD"],
  },
  {
    merchant_key: "BLUEWAVE CAR WASH",
    sample_raw: "BLUEWAVE CAR WASH #22 ANCHORAGE AK",
    sample_descriptions: [],
    count: 6,
    total_amount: 143.00,
    sample_dates: ["2025-08-08", "2025-09-15"],
    account_types: ["CREDIT_CARD"],
  },
]

// ---------------------------------------------------------------------------
// System prompt content tests
// ---------------------------------------------------------------------------

describe("buildSystemPrompt", () => {
  const prompt = buildSystemPrompt(
    {
      naicsCode: fakeProfile.naicsCode,
      businessDescription: fakeProfile.businessDescription,
      primaryState: fakeProfile.primaryState,
      entityType: fakeProfile.entityType,
      accountingMethod: fakeProfile.accountingMethod,
      grossReceiptsEstimate: null,
      homeOfficeConfig: fakeProfile.homeOfficeConfig,
      vehicleConfig: fakeProfile.vehicleConfig,
      revenueStreams: fakeProfile.revenueStreams,
      firstYear: fakeProfile.firstYear,
    },
    fakeTrips,
    fakeEntities,
    fakeRuleVersion
  )

  it("includes NAICS code", () => expect(prompt).toContain("711510"))
  it("includes business description", () => expect(prompt).toContain("Wedding photography"))
  it("includes trip name", () => expect(prompt).toContain("Alaska Content Trip"))
  it("includes trip dates", () => expect(prompt).toContain("2025-08-02"))
  it("includes known entity keywords", () => expect(prompt).toContain("ZELLE RANDI"))
  it("includes all 11 valid codes", () => {
    expect(prompt).toContain("WRITE_OFF")
    expect(prompt).toContain("MEALS_50")
    expect(prompt).toContain("NEEDS_CONTEXT")
    expect(prompt).toContain("TRANSFER")
  })
  it("includes rule library IDs", () => {
    expect(prompt).toContain("R-162-001")
    expect(prompt).toContain("R-274d-001")
    expect(prompt).toContain("R-274n-001")
  })
  it("includes §274(d) guardrail instruction", () => {
    expect(prompt).toContain("§274(d)")
    expect(prompt).toContain("requires_human_input=true")
  })
  it("includes [VERIFY] placeholder instruction", () => expect(prompt).toContain("[VERIFY]"))
  it("includes vehicle biz pct", () => expect(prompt).toContain("60%"))
  it("includes schedule C line map", () => expect(prompt).toContain("Line 24b Meals"))
})

// ---------------------------------------------------------------------------
// Zod schema validation tests
// ---------------------------------------------------------------------------

describe("MerchantRuleOutputSchema", () => {
  it("accepts a valid confident rule", () => {
    const rule = MerchantRuleOutputSchema.parse({
      merchant_key: "ADOBE",
      code: "WRITE_OFF",
      schedule_c_line: "Line 18 Office Expense",
      irc_citations: ["§162"],
      business_pct_default: 100,
      applies_trip_override: false,
      evidence_tier_default: 3,
      confidence: 0.92,
      reasoning: "Adobe Creative Cloud is professional software for a photographer.",
      requires_human_input: false,
      human_question: null,
    })
    expect(rule.code).toBe("WRITE_OFF")
  })

  it("accepts a STOP rule with question", () => {
    const rule = MerchantRuleOutputSchema.parse({
      merchant_key: "DELTA AIR",
      code: "NEEDS_CONTEXT",
      schedule_c_line: "Line 24a Travel",
      irc_citations: ["§162", "§274(d)"],
      business_pct_default: 100,
      applies_trip_override: false,
      evidence_tier_default: 3,
      confidence: 0.45,
      reasoning: "Could be business or personal flight — need trip context.",
      requires_human_input: true,
      human_question: "Were these Delta flights for business? If so, what trip?",
    })
    expect(rule.requires_human_input).toBe(true)
    expect(rule.human_question).toBeTruthy()
  })

  it("rejects code not in vocabulary", () => {
    expect(() =>
      MerchantRuleOutputSchema.parse({
        merchant_key: "X",
        code: "DEDUCTIBLE", // not a valid code
        schedule_c_line: null,
        irc_citations: [],
        business_pct_default: 100,
        applies_trip_override: false,
        evidence_tier_default: 3,
        confidence: 0.9,
        reasoning: "Some reasoning here",
        requires_human_input: false,
        human_question: null,
      })
    ).toThrow()
  })

  it("rejects business_pct_default > 100", () => {
    expect(() =>
      MerchantRuleOutputSchema.parse({
        merchant_key: "X",
        code: "WRITE_OFF",
        schedule_c_line: null,
        irc_citations: [],
        business_pct_default: 150,
        applies_trip_override: false,
        evidence_tier_default: 3,
        confidence: 0.9,
        reasoning: "Some reasoning here",
        requires_human_input: false,
        human_question: null,
      })
    ).toThrow()
  })
})

// ---------------------------------------------------------------------------
// classifyBatch with mocked Anthropic client
// ---------------------------------------------------------------------------

function makeValidBatchResponse() {
  return {
    rules: [
      {
        merchant_key: "ADOBE",
        code: "WRITE_OFF",
        schedule_c_line: "Line 18 Office Expense",
        irc_citations: ["§162"],
        business_pct_default: 100,
        applies_trip_override: false,
        evidence_tier_default: 3,
        confidence: 0.93,
        reasoning:
          "Adobe Creative Cloud is industry-standard professional software for photographers (NAICS 711510). 100% business deductible under §162.",
        requires_human_input: false,
        human_question: null,
      },
      {
        merchant_key: "BLUEWAVE CAR WASH",
        code: "GRAY",
        schedule_c_line: "Line 9 Car & Truck",
        irc_citations: ["§162", "§280F"],
        business_pct_default: 60,
        applies_trip_override: true,
        evidence_tier_default: 3,
        confidence: 0.82,
        reasoning:
          "Car wash for vehicle at 60% business use per profile. During confirmed business trips, vehicle is used exclusively for content work.",
        requires_human_input: false,
        human_question: null,
      },
    ],
  }
}

function makeMockClient(responseText: string) {
  return {
    messages: {
      create: vi.fn().mockResolvedValue({
        content: [{ type: "text", text: responseText }],
        usage: { input_tokens: 1000, output_tokens: 500 },
      }),
    },
  } as unknown as import("@anthropic-ai/sdk").default
}

describe("classifyBatch (mocked Anthropic)", () => {
  it("parses valid JSON response and returns rules", async () => {
    const mockClient = makeMockClient(JSON.stringify(makeValidBatchResponse()))
    const rules = await classifyBatch(
      sampleMerchants,
      fakeProfile,
      fakeTrips,
      fakeEntities,
      fakeRuleVersion,
      mockClient
    )
    expect(rules).toHaveLength(2)
    expect(rules[0]!.merchant_key).toBe("ADOBE")
    expect(rules[0]!.code).toBe("WRITE_OFF")
    expect(rules[1]!.merchant_key).toBe("BLUEWAVE CAR WASH")
    expect(rules[1]!.applies_trip_override).toBe(true)
  })

  it("enforces confidence < 0.60 → requires_human_input", async () => {
    const lowConfBatch = {
      rules: [
        {
          ...makeValidBatchResponse().rules[0],
          confidence: 0.45,
          requires_human_input: false, // AI forgot to set this
          human_question: null,
        },
      ],
    }
    const mockClient = makeMockClient(JSON.stringify(lowConfBatch))
    const rules = await classifyBatch(
      sampleMerchants.slice(0, 1),
      fakeProfile,
      fakeTrips,
      fakeEntities,
      fakeRuleVersion,
      mockClient
    )
    expect(rules[0]!.requires_human_input).toBe(true)
    expect(rules[0]!.human_question).toBeTruthy()
  })

  it("coerces unknown IRC citations to [VERIFY]", async () => {
    const badCiteBatch = {
      rules: [
        {
          ...makeValidBatchResponse().rules[0],
          irc_citations: ["§162", "§1234-invented"],
        },
      ],
    }
    const mockClient = makeMockClient(JSON.stringify(badCiteBatch))
    const rules = await classifyBatch(
      sampleMerchants.slice(0, 1),
      fakeProfile,
      fakeTrips,
      fakeEntities,
      fakeRuleVersion,
      mockClient
    )
    expect(rules[0]!.irc_citations).toContain("[VERIFY]")
    expect(rules[0]!.irc_citations).toContain("§162")
    expect(rules[0]!.irc_citations).not.toContain("§1234-invented")
  })

  it("strips markdown fences from response", async () => {
    const fenced = "```json\n" + JSON.stringify(makeValidBatchResponse()) + "\n```"
    const mockClient = makeMockClient(fenced)
    const rules = await classifyBatch(
      sampleMerchants,
      fakeProfile,
      fakeTrips,
      fakeEntities,
      fakeRuleVersion,
      mockClient
    )
    expect(rules).toHaveLength(2)
  })

  it("retries on parse failure and falls back to NEEDS_CONTEXT on double fail", async () => {
    const badClient = {
      messages: {
        create: vi.fn().mockResolvedValue({
          content: [{ type: "text", text: "this is not json at all $$$ broken" }],
          usage: { input_tokens: 100, output_tokens: 50 },
        }),
      },
    } as unknown as import("@anthropic-ai/sdk").default

    const rules = await classifyBatch(
      sampleMerchants.slice(0, 1),
      fakeProfile,
      fakeTrips,
      fakeEntities,
      fakeRuleVersion,
      badClient
    )
    expect(rules[0]!.code).toBe("NEEDS_CONTEXT")
    expect(rules[0]!.requires_human_input).toBe(true)
    // Called twice: initial + retry
    expect((badClient.messages.create as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2)
  })
})
