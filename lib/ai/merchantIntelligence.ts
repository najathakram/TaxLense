/**
 * Merchant Intelligence Agent — spec §4.4 Phase 3 + §6.1.
 *
 * Model: claude-sonnet-4-6 (primary), claude-haiku-4-5 (retry on timeout).
 * Batches 25 unique merchants per call, returns MerchantRule per merchant.
 *
 * Token budget: ~8,300 tokens/batch; ~$1.34 per full 419-merchant Maznah run.
 * With system-prompt caching: ~$1.20.
 *
 * Guardrails:
 *  - Never invent IRC citations — use rule library IDs or return "[VERIFY]"
 *  - confidence < 0.60 → requires_human_input = true
 *  - §274(d) categories always require human input unless in trip window
 *  - On JSON parse failure: retry once, then fallback all batch merchants to STOP
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { prisma } from "@/lib/db"
import type {
  BusinessProfile,
  Trip,
  KnownEntity,
  RuleVersion,
} from "@/app/generated/prisma/client"

// Model string verified against @anthropic-ai/sdk ^0.90.0
const MODEL_PRIMARY = "claude-sonnet-4-6" as const
const BATCH_SIZE = 25
const MAX_TOKENS = 4096

// ---------------------------------------------------------------------------
// Zod schema for a single MerchantRule returned by the AI
// ---------------------------------------------------------------------------

const TransactionCodeEnum = z.enum([
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
  "PERSONAL",
  "TRANSFER",
  "PAYMENT",
  "BIZ_INCOME",
  "NEEDS_CONTEXT",
])

export const MerchantRuleOutputSchema = z.object({
  merchant_key: z.string().min(1),
  code: TransactionCodeEnum,
  schedule_c_line: z.string().nullable(),
  irc_citations: z.array(z.string()),
  business_pct_default: z.number().int().min(0).max(100),
  applies_trip_override: z.boolean(),
  evidence_tier_default: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(10),
  requires_human_input: z.boolean(),
  human_question: z.string().nullable(),
})

export type MerchantRuleOutput = z.infer<typeof MerchantRuleOutputSchema>

const BatchResponseSchema = z.object({
  rules: z.array(MerchantRuleOutputSchema),
})

// ---------------------------------------------------------------------------
// Cross-field invariant enforcement (post-Zod, before persist)
// ---------------------------------------------------------------------------

const SECTION_274D_CODES = new Set(["MEALS_50", "MEALS_100", "WRITE_OFF_TRAVEL"])

// Authoritative IRC citation set from the rule library (spec §7.3)
const RULE_LIBRARY_CITATIONS = new Set([
  "§162", "§162(a)", "§262", "§274(d)", "§274(n)", "§274(n)(1)", "§274(n)(2)",
  "§280A", "§280A(c)", "§263a", "§168(k)", "§179", "§280F", "§195",
  "§6001", "§1402", "§6662", "Cohan",
  "R-162-001", "R-262-001", "R-274d-001", "R-274n-001", "R-274n-002",
  "R-280Ac-001", "R-263a-001", "R-168k-2025", "R-179-2025",
  "R-280F-001", "R-274d-veh-001", "R-195-001", "R-6001-001",
  "R-Cohan-001", "R-1402-001", "R-6662-001",
])

function enforceCrossFieldInvariants(rule: MerchantRuleOutput): MerchantRuleOutput {
  const r = { ...rule }

  // confidence < 0.60 → must be STOP
  if (r.confidence < 0.60 && !r.requires_human_input) {
    r.requires_human_input = true
    r.human_question ??= `Merchant "${r.merchant_key}" — please classify this expense for your business.`
  }

  // requires_human_input but no question → fill in
  if (r.requires_human_input && !r.human_question) {
    r.human_question = `Merchant "${r.merchant_key}" — please confirm the business purpose for these charges.`
  }

  // §274(d) categories without human_input should have requires_human_input = true
  // (unless applies_trip_override=true — trip window provides corroboration)
  if (SECTION_274D_CODES.has(r.code) && !r.applies_trip_override && !r.requires_human_input) {
    r.requires_human_input = true
    r.human_question ??= `${r.merchant_key} is in a §274(d) category (${r.code}). Who was present and what was the business purpose?`
  }

  // Any citation not in rule library → replace with [VERIFY]
  r.irc_citations = r.irc_citations.map((c) =>
    RULE_LIBRARY_CITATIONS.has(c) ? c : "[VERIFY]"
  )

  // MEALS_100 needs a STOP and specific note about deliverable
  if (r.code === "MEALS_100" && !r.requires_human_input) {
    r.requires_human_input = true
    r.human_question ??= `MEALS_100 classification for "${r.merchant_key}" requires a linked deliverable (§274(n)(2) position memo). What content deliverable does this meal produce?`
  }

  return r
}

// ---------------------------------------------------------------------------
// Build system prompt
// ---------------------------------------------------------------------------

interface ProfileContext {
  naicsCode: string | null
  naicsDescription?: string
  businessDescription: string | null
  primaryState: string
  entityType: string
  accountingMethod: string
  grossReceiptsEstimate: string | null
  homeOfficeConfig: unknown
  vehicleConfig: unknown
  revenueStreams: string[]
  firstYear: boolean
}

function formatTrips(trips: Trip[]): string {
  if (trips.length === 0) return "None confirmed."
  return trips
    .map(
      (t) =>
        `- "${t.name}" → ${t.destination} | ${t.startDate.toISOString().slice(0, 10)} to ${t.endDate.toISOString().slice(0, 10)} | Purpose: ${t.purpose}${t.deliverableDescription ? ` | Deliverable: ${t.deliverableDescription}` : ""}`
    )
    .join("\n")
}

function formatEntities(entities: KnownEntity[]): string {
  if (entities.length === 0) return "None defined."
  return entities
    .map(
      (e) =>
        `- ${e.displayName} [${e.kind}]: keywords ${e.matchKeywords.join(", ")}${e.notes ? ` — ${e.notes}` : ""}`
    )
    .join("\n")
}

function formatVehicleConfig(cfg: unknown): string {
  const v = cfg as { has?: boolean; bizPct?: number } | null
  if (!v?.has) return "No vehicle"
  return `Vehicle: ${v.bizPct ?? 60}% business use`
}

export function buildSystemPrompt(
  profile: ProfileContext,
  trips: Trip[],
  entities: KnownEntity[],
  _ruleVersion: RuleVersion | null,
  clientNotes?: string,
): string {
  const vehicleInfo = formatVehicleConfig(profile.vehicleConfig)
  const hoConfig = profile.homeOfficeConfig as { has?: boolean; dedicated?: boolean; officeSqft?: number; homeSqft?: number } | null
  const notesBlock = clientNotes && clientNotes.trim().length > 0
    ? `\n\n=== CLIENT-PROVIDED CONTEXT (from upload sessions; treat as corroboration, not law) ===\n${clientNotes.trim()}`
    : ""

  return `You are the Merchant Intelligence Agent for TaxLens — an audit-defense bookkeeping tool for US self-employed taxpayers preparing Schedule C returns.${notesBlock}

Your job: classify a batch of unique merchants into deductible categories with IRC citations, given the owner's business profile.

=== NON-NEGOTIABLE RULES ===
1. Use ONLY these 11 codes. No others are valid:
   WRITE_OFF, WRITE_OFF_TRAVEL, WRITE_OFF_COGS, MEALS_50, MEALS_100,
   GRAY, PERSONAL, TRANSFER, PAYMENT, BIZ_INCOME, NEEDS_CONTEXT

2. IRC citations must be chosen from the RULE LIBRARY below.
   If uncertain, output "[VERIFY]" — NEVER invent a citation.

3. If confidence < 0.60: set requires_human_input=true and write a SPECIFIC
   human_question naming the merchant and the dollar/count context.

4. §274(d) categories (meals, travel, vehicle, gifts, listed property):
   ALWAYS set requires_human_input=true unless applies_trip_override=true.
   Reason: the law requires contemporaneous substantiation.

5. MEALS_100 (meal as content deliverable) ALWAYS requires a StopItem
   with a specific question about the linked deliverable.

6. "Silence is a bug" — if you lack information to classify, STOP and ask.
   NEVER guess IRC sections or fabricate merchant details.

7. The app prefers the better-documented position over the bigger deduction.
   A defensible $30K beats a flimsy $40K. Err conservative.

8. Use the "sample_descriptions" field (raw statement descriptions) alongside
   the merchant key to refine classification. If the description contradicts or
   adds ambiguity (e.g. "AMAZON.COM*HOUSEHOLD" vs a business merchant),
   set requires_human_input=true and write a specific human_question.

=== BUSINESS PROFILE ===
NAICS: ${profile.naicsCode ?? "unknown"} — ${profile.naicsDescription ?? "Independent Artist/Creator"}
Business: ${profile.businessDescription ?? "Not specified"}
State: ${profile.primaryState}
Entity: ${profile.entityType} (Sole Prop / SMLLC)
Accounting method: ${profile.accountingMethod}
Gross receipts estimate: $${profile.grossReceiptsEstimate ?? "unknown"}
${vehicleInfo}
Home office: ${hoConfig?.has ? `Yes — ${hoConfig.dedicated ? "dedicated" : "non-dedicated"} space, ${hoConfig.officeSqft ?? "?"}sqft of ${hoConfig.homeSqft ?? "?"}sqft home` : "No"}
Revenue streams: ${profile.revenueStreams.join(", ")}
First year in business: ${profile.firstYear ? "Yes (§195 startup costs may apply)" : "No"}

=== CONFIRMED BUSINESS TRIPS ===
${formatTrips(trips)}

=== KNOWN ENTITIES & EXCLUSION PATTERNS ===
(Match these keywords → override to their default code)
${formatEntities(entities)}

=== RULE LIBRARY (cite only these IDs or their IRC sections) ===
- R-162-001  §162(a)      Ordinary & necessary business expense → WRITE_OFF
- R-262-001  §262         Personal/living/family expense → PERSONAL
- R-274d-001 §274(d)      Meals/travel/vehicle/gifts/listed: require contemporaneous substantiation
- R-274n-001 §274(n)(1)   Business meals 50% deductible → MEALS_50
- R-274n-002 §274(n)(2)   100% meal exception (deliverable link required) → MEALS_100
- R-280Ac-001 §280A(c)    Home office: exclusive+regular use → WRITE_OFF
- R-263a-001 §1.263(a)    De minimis safe harbor ≤$2,500 per invoice → WRITE_OFF
- R-168k-2025 §168(k)     100% bonus depreciation (post-OBBBA, acquired after Jan 19 2025) → WRITE_OFF
- R-179-2025 §179          Section 179 election → WRITE_OFF
- R-280F-001 §280F         Vehicle/listed property caps
- R-195-001  §195          Startup costs (first-year taxpayers only)
- R-6001-001 §6001         Recordkeeping — underlies evidence tier
- R-Cohan-001 Cohan        Estimates for §162 only; NOT for §274(d) categories

=== SCHEDULE C LINE MAP (use exact strings) ===
"Line 8 Advertising", "Line 9 Car & Truck", "Line 11 Contract Labor",
"Line 13 Depreciation", "Line 15 Insurance", "Line 16b Interest",
"Line 17 Legal & Professional", "Line 18 Office Expense",
"Line 20b Rent — Other", "Line 21 Repairs & Maintenance", "Line 22 Supplies",
"Line 23 Taxes & Licenses", "Line 24a Travel", "Line 24b Meals",
"Line 25 Utilities", "Line 27a Other Expenses", "Line 30 Home Office",
"Part III COGS", "N/A"

=== EVIDENCE TIERS ===
1 = Receipt + calendar + trip context + deliverable link (best; impossible at merchant level)
2 = Statement + ≥1 corroborator (trip-window match, known-entity match, or profile affirmation)
3 = Statement + plausible biz nexus from NAICS + profile (DEFAULT for clear-category merchants)
4 = Weak (statement only, no corroboration; §162 Cohan-eligible; §274(d) disallowed)
5 = Indefensible — demote to PERSONAL

Default tier for clear-category merchants: 3.
For §274(d) categories without trip context: maximum tier 3, requires_human_input=true.

=== OUTPUT FORMAT ===
Return ONLY valid JSON in this exact shape — no prose, no markdown fences:
{
  "rules": [
    {
      "merchant_key": "EXACT KEY FROM INPUT",
      "code": "ONE_OF_11_CODES",
      "schedule_c_line": "Line 18 Office Expense",
      "irc_citations": ["§162"],
      "business_pct_default": 100,
      "applies_trip_override": false,
      "evidence_tier_default": 3,
      "confidence": 0.90,
      "reasoning": "Specific reasoning referencing NAICS, profile, or trip context.",
      "requires_human_input": false,
      "human_question": null
    }
  ]
}`
}

// ---------------------------------------------------------------------------
// Build user prompt for a batch of merchants
// ---------------------------------------------------------------------------

export interface MerchantBatchInput {
  merchant_key: string
  sample_raw: string
  sample_descriptions: string[]
  count: number
  total_amount: number
  sample_dates: string[]
  account_types: string[]
}

function buildUserPrompt(merchants: MerchantBatchInput[]): string {
  return JSON.stringify({ merchants }, null, 2)
}

// ---------------------------------------------------------------------------
// Extract JSON from possibly-fenced AI response
// ---------------------------------------------------------------------------

function extractJSON(text: string): string {
  // Strip markdown code fences if present
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1]!.trim()
  // Find the first { ... } block
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

// ---------------------------------------------------------------------------
// Core classify function
// ---------------------------------------------------------------------------

export async function classifyBatch(
  merchants: MerchantBatchInput[],
  profile: BusinessProfile & { trips?: Trip[]; knownEntities?: KnownEntity[] },
  trips: Trip[],
  entities: KnownEntity[],
  ruleVersion: RuleVersion | null,
  anthropicClient?: Anthropic,
  clientNotes?: string,
): Promise<MerchantRuleOutput[]> {
  const client = anthropicClient ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })
  const systemPrompt = buildSystemPrompt(
    {
      naicsCode: profile.naicsCode,
      businessDescription: profile.businessDescription,
      primaryState: profile.primaryState,
      entityType: profile.entityType,
      accountingMethod: profile.accountingMethod,
      grossReceiptsEstimate: profile.grossReceiptsEstimate?.toString() ?? null,
      homeOfficeConfig: profile.homeOfficeConfig,
      vehicleConfig: profile.vehicleConfig,
      revenueStreams: profile.revenueStreams,
      firstYear: profile.firstYear,
    },
    trips,
    entities,
    ruleVersion,
    clientNotes,
  )
  const userPrompt = buildUserPrompt(merchants)

  const callAPI = async (messages: Anthropic.Messages.MessageParam[]) =>
    client.messages.create({
      model: MODEL_PRIMARY,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: systemPrompt,
      messages,
    })

  const messages: Anthropic.Messages.MessageParam[] = [
    { role: "user", content: userPrompt },
  ]

  let rawText: string
  try {
    const res = await callAPI(messages)
    rawText = (res.content[0] as Anthropic.Messages.TextBlock).text
  } catch (err) {
    await prisma.auditEvent.create({
      data: {
        actorType: "AI",
        eventType: "MERCHANT_AI_API_FAIL",
        entityType: "MerchantRule",
        afterState: { error: String(err), merchantKeys: merchants.map((m) => m.merchant_key) },
      },
    })
    throw err
  }

  // Attempt parse
  let parsed: z.infer<typeof BatchResponseSchema>
  try {
    parsed = BatchResponseSchema.parse(JSON.parse(extractJSON(rawText)))
  } catch (zodErr) {
    // Log and retry once
    await prisma.auditEvent.create({
      data: {
        actorType: "AI",
        eventType: "MERCHANT_AI_PARSE_FAIL",
        entityType: "MerchantRule",
        afterState: {
          raw: rawText.slice(0, 2000),
          error: String(zodErr),
          merchantKeys: merchants.map((m) => m.merchant_key),
        },
      },
    })

    // Retry with fix instruction
    const retryMessages: Anthropic.Messages.MessageParam[] = [
      ...messages,
      { role: "assistant", content: rawText },
      {
        role: "user",
        content: `Your previous response failed JSON validation: ${String(zodErr).slice(0, 400)}. Return ONLY valid JSON matching the schema. No prose, no markdown fences. Fix and resubmit.`,
      },
    ]

    let retryRaw: string
    try {
      const retryRes = await callAPI(retryMessages)
      retryRaw = (retryRes.content[0] as Anthropic.Messages.TextBlock).text
      parsed = BatchResponseSchema.parse(JSON.parse(extractJSON(retryRaw)))
    } catch (retryErr) {
      // Final failure — return all as NEEDS_CONTEXT STOPs
      await prisma.auditEvent.create({
        data: {
          actorType: "AI",
          eventType: "MERCHANT_AI_PARSE_FAIL_FINAL",
          entityType: "MerchantRule",
          afterState: {
            error: String(retryErr),
            merchantKeys: merchants.map((m) => m.merchant_key),
          },
        },
      })
      return merchants.map((m) => ({
        merchant_key: m.merchant_key,
        code: "NEEDS_CONTEXT" as const,
        schedule_c_line: null,
        irc_citations: [],
        business_pct_default: 0,
        applies_trip_override: false,
        evidence_tier_default: 4,
        confidence: 0,
        reasoning: "AI classification failed after retry — manual review required.",
        requires_human_input: true,
        human_question: `AI could not classify "${m.merchant_key}" (${m.count} transaction${m.count > 1 ? "s" : ""}, $${m.total_amount.toFixed(2)} total). Please classify manually.`,
      }))
    }
  }

  return parsed.rules.map(enforceCrossFieldInvariants)
}

// ---------------------------------------------------------------------------
// Orchestrate: extract merchants → batch → call AI → persist rules + StopItems
// ---------------------------------------------------------------------------

export interface RunMerchantIntelligenceResult {
  merchantsProcessed: number
  rulesCreated: number
  stopsGenerated: number
}

export async function aggregateClientNotes(taxYearId: string): Promise<string> {
  const sessions = await prisma.importSession.findMany({
    where: { taxYearId, notes: { not: null } },
    select: { notes: true, uploadedAt: true },
    orderBy: { uploadedAt: "asc" },
  })
  const imports = await prisma.statementImport.findMany({
    where: { taxYearId, userNotes: { not: { equals: null } } },
    select: {
      originalFilename: true,
      institution: true,
      periodStart: true,
      userNotes: true,
    },
    orderBy: { uploadedAt: "asc" },
  })

  const parts: string[] = []
  for (const s of sessions) {
    if (s.notes && s.notes.trim().length > 0) {
      parts.push(`[Session ${s.uploadedAt.toISOString().slice(0, 10)}] ${s.notes.trim()}`)
    }
  }
  for (const imp of imports) {
    const notes = imp.userNotes as Record<string, { question?: string; answer?: string }> | null
    if (!notes) continue
    for (const entry of Object.values(notes)) {
      if (entry?.question && entry?.answer) {
        const tag = `${imp.institution ?? imp.originalFilename}${imp.periodStart ? ` (${imp.periodStart.toISOString().slice(0, 10)})` : ""}`
        parts.push(`- [${tag}] Q: ${entry.question} → A: ${entry.answer}`)
      }
    }
  }
  return parts.join("\n")
}

export async function runMerchantIntelligence(
  taxYearId: string,
  anthropicClient?: Anthropic
): Promise<RunMerchantIntelligenceResult> {
  // Load profile context
  const taxYear = await prisma.taxYear.findUniqueOrThrow({
    where: { id: taxYearId },
    include: { ruleVersion: true },
  })

  const profile = await prisma.businessProfile.findUniqueOrThrow({
    where: { taxYearId },
    include: { trips: true, knownEntities: true },
  })

  const clientNotes = await aggregateClientNotes(taxYearId)

  // Pull distinct normalized merchants from transactions that still need classification
  const txGroups = await prisma.transaction.groupBy({
    by: ["merchantNormalized"],
    where: {
      taxYearId,
      merchantNormalized: { not: null },
      isTransferPairedWith: null,
      isPaymentPairedWith: null,
      isDuplicateOf: null,
    },
    _count: { _all: true },
    _sum: { amountNormalized: true },
    _min: { postedDate: true },
    _max: { postedDate: true },
  })

  // Skip merchants that already have a rule
  const existingRules = await prisma.merchantRule.findMany({
    where: { taxYearId },
    select: { merchantKey: true },
  })
  const existingKeys = new Set(existingRules.map((r) => r.merchantKey))

  // Build batch inputs
  const merchantsToClassify: MerchantBatchInput[] = []

  for (const group of txGroups) {
    const key = group.merchantNormalized!
    if (existingKeys.has(key)) continue

    // Get sample raw description and account types
    const sampleTxns = await prisma.transaction.findMany({
      where: { taxYearId, merchantNormalized: key },
      include: { account: true },
      take: 3,
      orderBy: { postedDate: "desc" },
    })

    const rawDescriptions = sampleTxns
      .map((t) => t.descriptionRaw)
      .filter((d): d is string => !!d && d.trim().length > 0)
    const uniqueDescriptions = [...new Set(rawDescriptions)].slice(0, 3)

    merchantsToClassify.push({
      merchant_key: key,
      sample_raw: sampleTxns[0]?.merchantRaw ?? key,
      sample_descriptions: uniqueDescriptions,
      count: group._count._all,
      total_amount: Number(group._sum.amountNormalized?.toString() ?? "0"),
      sample_dates: sampleTxns.map((t) => t.postedDate.toISOString().slice(0, 10)),
      account_types: [...new Set(sampleTxns.map((t) => t.account.type))],
    })
  }

  // Batch into groups of BATCH_SIZE
  const batches: MerchantBatchInput[][] = []
  for (let i = 0; i < merchantsToClassify.length; i += BATCH_SIZE) {
    batches.push(merchantsToClassify.slice(i, i + BATCH_SIZE))
  }

  let rulesCreated = 0
  let stopsGenerated = 0

  for (const batch of batches) {
    const rules = await classifyBatch(
      batch,
      profile,
      profile.trips,
      profile.knownEntities,
      taxYear.ruleVersion,
      anthropicClient,
      clientNotes,
    )

    // Upsert MerchantRule rows
    for (const rule of rules) {
      const input = merchantsToClassify.find((m) => m.merchant_key === rule.merchant_key)!

      await prisma.merchantRule.upsert({
        where: { taxYearId_merchantKey: { taxYearId, merchantKey: rule.merchant_key } },
        create: {
          taxYearId,
          merchantKey: rule.merchant_key,
          code: rule.code,
          scheduleCLine: rule.schedule_c_line,
          businessPctDefault: rule.business_pct_default,
          appliesTripOverride: rule.applies_trip_override,
          ircCitations: rule.irc_citations,
          evidenceTierDefault: rule.evidence_tier_default,
          confidence: rule.confidence,
          reasoning: rule.reasoning,
          requiresHumanInput: rule.requires_human_input,
          humanQuestion: rule.human_question,
          originalSample: input?.sample_raw ?? null,
          totalTransactions: input?.count ?? 0,
          totalAmount: input?.total_amount ?? 0,
        },
        update: {
          code: rule.code,
          scheduleCLine: rule.schedule_c_line,
          businessPctDefault: rule.business_pct_default,
          appliesTripOverride: rule.applies_trip_override,
          ircCitations: rule.irc_citations,
          evidenceTierDefault: rule.evidence_tier_default,
          confidence: rule.confidence,
          reasoning: rule.reasoning,
          requiresHumanInput: rule.requires_human_input,
          humanQuestion: rule.human_question,
        },
      })
      rulesCreated++

      // Create StopItem for merchants requiring human input
      if (rule.requires_human_input) {
        const merchantRule = await prisma.merchantRule.findUniqueOrThrow({
          where: { taxYearId_merchantKey: { taxYearId, merchantKey: rule.merchant_key } },
        })

        const affectedTxIds = await prisma.transaction.findMany({
          where: { taxYearId, merchantNormalized: rule.merchant_key },
          select: { id: true, amountNormalized: true, postedDate: true },
        })

        // Check if stop already exists
        const existingStop = await prisma.stopItem.findFirst({
          where: { merchantRuleId: merchantRule.id },
        })

        if (!existingStop) {
          const totalAmt = affectedTxIds.reduce(
            (sum, t) => sum + Math.abs(Number(t.amountNormalized.toString())),
            0
          )
          const dates = affectedTxIds.map((t) => t.postedDate.toISOString().slice(0, 10)).sort()

          await prisma.stopItem.create({
            data: {
              taxYearId,
              merchantRuleId: merchantRule.id,
              category: "MERCHANT",
              question: rule.human_question!,
              context: {
                merchant: rule.merchant_key,
                count: affectedTxIds.length,
                totalAmount: totalAmt.toFixed(2),
                dateRange:
                  dates.length > 0
                    ? `${dates[0]} to ${dates[dates.length - 1]}`
                    : "unknown",
                code: rule.code,
                confidence: rule.confidence,
              },
              transactionIds: affectedTxIds.map((t) => t.id),
              state: "PENDING",
            },
          })
          stopsGenerated++
        }
      }
    }
  }

  // Log the run
  await prisma.auditEvent.create({
    data: {
      actorType: "AI",
      eventType: "MERCHANT_AI_RUN_COMPLETE",
      entityType: "MerchantRule",
      entityId: taxYearId,
      afterState: {
        merchantsProcessed: merchantsToClassify.length,
        rulesCreated,
        stopsGenerated,
        batches: batches.length,
      },
    },
  })

  return { merchantsProcessed: merchantsToClassify.length, rulesCreated, stopsGenerated }
}
