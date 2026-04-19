/**
 * Residual Transaction Agent — spec §4.4 Phase 4, §6.2.
 *
 * Per-transaction AI classification for the ~<10% of txns that can't be
 * resolved at the merchant level (see residualCandidates.ts for triage).
 *
 * Model: claude-sonnet-4-6, temperature 0, max_tokens 1024.
 * Input: single txn + its MerchantRule + profile + 5-before/5-after neighbors
 *   on the same account + active trip if any.
 * Output: a Classification row (AI source) OR a StopItem if still ambiguous.
 *
 * Guardrails mirror the Merchant Agent:
 *  - confidence < 0.60 OR requires_human_input=true → StopItem, no classification
 *  - IRC citation not in rule library → [VERIFY]
 *  - §274(d) codes without trip override → requires_human_input forced true
 *  - JSON parse fail: retry once with fix instruction; on second fail → StopItem
 *  - Every call produces an AuditEvent (RESIDUAL_AI_CALL / RESIDUAL_AI_PARSE_FAIL)
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { prisma } from "@/lib/db"
import type {
  Transaction,
  MerchantRule,
  BusinessProfile,
  Trip,
  KnownEntity,
  TransactionCode,
  Prisma,
} from "@/app/generated/prisma/client"
import type { ResidualCandidate } from "@/lib/ai/residualCandidates"

const MODEL_PRIMARY = "claude-sonnet-4-6" as const
const MAX_TOKENS = 1024

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

export const ResidualOutputSchema = z.object({
  code: TransactionCodeEnum,
  schedule_c_line: z.string().nullable(),
  irc_citations: z.array(z.string()),
  business_pct: z.number().int().min(0).max(100),
  evidence_tier: z.number().int().min(1).max(5),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().min(10),
  requires_human_input: z.boolean(),
  human_question: z.string().nullable(),
})
export type ResidualOutput = z.infer<typeof ResidualOutputSchema>

const RULE_LIBRARY_CITATIONS = new Set([
  "§162", "§162(a)", "§262", "§274(d)", "§274(n)", "§274(n)(1)", "§274(n)(2)",
  "§280A", "§280A(c)", "§263a", "§168(k)", "§179", "§280F", "§195",
  "§6001", "§1402", "§6662", "Cohan", "§61",
])
const SECTION_274D_CODES = new Set<TransactionCode>(["MEALS_50", "MEALS_100", "WRITE_OFF_TRAVEL"])

function enforceInvariants(out: ResidualOutput, txInTrip: boolean): ResidualOutput {
  const r = { ...out }
  if (r.confidence < 0.60 && !r.requires_human_input) {
    r.requires_human_input = true
    r.human_question ??= "Confidence below 0.60 — need user confirmation on this transaction."
  }
  if (SECTION_274D_CODES.has(r.code) && !txInTrip && !r.requires_human_input) {
    r.requires_human_input = true
    r.human_question ??= `Code ${r.code} is §274(d) — requires contemporaneous attendees/purpose.`
  }
  r.irc_citations = r.irc_citations.map((c) => (RULE_LIBRARY_CITATIONS.has(c) ? c : "[VERIFY]"))
  return r
}

interface NeighborSummary {
  postedDate: string
  amount: number
  merchantNormalized: string | null
  currentCode: TransactionCode | null
}

function buildSystemPrompt(
  profile: BusinessProfile,
  trips: Trip[],
  entities: KnownEntity[]
): string {
  const vehicle = profile.vehicleConfig as { has?: boolean; bizPct?: number } | null
  const vehicleInfo = vehicle?.has ? `Vehicle: ${vehicle.bizPct ?? 60}% business` : "No vehicle"
  const tripLines = trips.length
    ? trips
        .map(
          (t) =>
            `- "${t.name}" → ${t.destination} | ${t.startDate.toISOString().slice(0, 10)}–${t.endDate.toISOString().slice(0, 10)}`
        )
        .join("\n")
    : "None confirmed."
  const entityLines = entities.length
    ? entities.map((e) => `- ${e.displayName} [${e.kind}]: ${e.matchKeywords.join(", ")}`).join("\n")
    : "None."

  return `You are the Residual Transaction Agent for TaxLens — single-transaction classification for items the merchant-level pass couldn't resolve.

Your input will be ONE transaction with its merchant rule, five neighboring transactions on the same account, and the business profile. You decide the code, line, pct, citations, and evidence tier for THIS specific transaction.

=== NON-NEGOTIABLE RULES ===
1. Use ONLY these 11 codes: WRITE_OFF, WRITE_OFF_TRAVEL, WRITE_OFF_COGS, MEALS_50, MEALS_100, GRAY, PERSONAL, TRANSFER, PAYMENT, BIZ_INCOME, NEEDS_CONTEXT.
2. IRC citations: choose from §162, §162(a), §262, §274(d), §274(n)(1), §274(n)(2), §280A(c), §263a, §168(k), §179, §280F, §195, §6001, §61, Cohan. Otherwise output "[VERIFY]".
3. Confidence < 0.60 → requires_human_input=true with a specific question.
4. §274(d) codes (MEALS_*, WRITE_OFF_TRAVEL) without an active trip window → requires_human_input=true.
5. "Silence is a bug" — if you lack information, STOP. Never invent attendees, clients, or purposes.
6. Conservative > maximalist. Defensible $30K > flimsy $40K.

=== BUSINESS PROFILE ===
NAICS: ${profile.naicsCode ?? "unknown"}
Business: ${profile.businessDescription ?? "unspecified"}
State: ${profile.primaryState}
Entity: ${profile.entityType}
Accounting method: ${profile.accountingMethod}
${vehicleInfo}
Revenue streams: ${profile.revenueStreams.join(", ") || "none"}

=== CONFIRMED BUSINESS TRIPS ===
${tripLines}

=== KNOWN ENTITIES ===
${entityLines}

=== OUTPUT FORMAT ===
Return ONLY valid JSON — no prose, no markdown fences:
{
  "code": "ONE_OF_11_CODES",
  "schedule_c_line": "Line 18 Office Expense" or null,
  "irc_citations": ["§162"],
  "business_pct": 100,
  "evidence_tier": 3,
  "confidence": 0.82,
  "reasoning": "Specific reasoning referencing this txn's date, amount, neighbors, trip context, or profile.",
  "requires_human_input": false,
  "human_question": null
}`
}

function buildUserPrompt(
  txn: Transaction,
  rule: MerchantRule | null,
  neighbors: NeighborSummary[],
  activeTrip: Trip | null,
  reasons: string[]
): string {
  return JSON.stringify(
    {
      why_escalated: reasons,
      transaction: {
        posted_date: txn.postedDate.toISOString().slice(0, 10),
        amount_normalized: Number(txn.amountNormalized),
        merchant_raw: txn.merchantRaw,
        merchant_normalized: txn.merchantNormalized,
        description: txn.descriptionRaw,
      },
      existing_merchant_rule: rule
        ? {
            code: rule.code,
            schedule_c_line: rule.scheduleCLine,
            business_pct_default: rule.businessPctDefault,
            confidence: rule.confidence,
            reasoning: rule.reasoning,
          }
        : null,
      active_trip: activeTrip
        ? {
            name: activeTrip.name,
            destination: activeTrip.destination,
            start: activeTrip.startDate.toISOString().slice(0, 10),
            end: activeTrip.endDate.toISOString().slice(0, 10),
            purpose: activeTrip.purpose,
          }
        : null,
      neighboring_transactions: neighbors,
    },
    null,
    2
  )
}

function extractJSON(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenced) return fenced[1]!.trim()
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start >= 0 && end > start) return text.slice(start, end + 1)
  return text.trim()
}

async function fetchNeighbors(
  db: Prisma.TransactionClient | typeof prisma,
  txn: Transaction
): Promise<NeighborSummary[]> {
  const [before, after] = await Promise.all([
    db.transaction.findMany({
      where: {
        accountId: txn.accountId,
        postedDate: { lt: txn.postedDate },
        id: { not: txn.id },
        isSplit: false,
      },
      orderBy: { postedDate: "desc" },
      take: 5,
      include: { classifications: { where: { isCurrent: true }, take: 1 } },
    }),
    db.transaction.findMany({
      where: {
        accountId: txn.accountId,
        postedDate: { gt: txn.postedDate },
        id: { not: txn.id },
        isSplit: false,
      },
      orderBy: { postedDate: "asc" },
      take: 5,
      include: { classifications: { where: { isCurrent: true }, take: 1 } },
    }),
  ])
  return [...before.reverse(), ...after].map((n) => ({
    postedDate: n.postedDate.toISOString().slice(0, 10),
    amount: Number(n.amountNormalized),
    merchantNormalized: n.merchantNormalized,
    currentCode: n.classifications[0]?.code ?? null,
  }))
}

export interface ClassifyResidualResult {
  transactionId: string
  outcome: "CLASSIFIED" | "STOP"
  output?: ResidualOutput
  stopItemId?: string
}

export async function classifyResidual(
  candidate: ResidualCandidate,
  anthropicClient?: Anthropic
): Promise<ClassifyResidualResult> {
  const client =
    anthropicClient ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  const txn = await prisma.transaction.findUnique({
    where: { id: candidate.transactionId },
    include: { taxYear: true },
  })
  if (!txn) throw new Error(`Transaction ${candidate.transactionId} not found`)

  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId: txn.taxYearId },
    include: { trips: true, knownEntities: true },
  })
  if (!profile) throw new Error(`BusinessProfile missing for TaxYear ${txn.taxYearId}`)

  const rule = candidate.merchantKey
    ? await prisma.merchantRule.findUnique({
        where: { taxYearId_merchantKey: { taxYearId: txn.taxYearId, merchantKey: candidate.merchantKey } },
      })
    : null

  const confirmedTrips = profile.trips.filter((t) => t.isConfirmed)
  const activeTrip =
    confirmedTrips.find((t) => txn.postedDate >= t.startDate && txn.postedDate <= t.endDate) ?? null

  const neighbors = await fetchNeighbors(prisma, txn)
  const system = buildSystemPrompt(profile, confirmedTrips, profile.knownEntities)
  const userPrompt = buildUserPrompt(txn, rule, neighbors, activeTrip, candidate.reasons)

  const callAPI = async (messages: Anthropic.Messages.MessageParam[]) =>
    client.messages.create({
      model: MODEL_PRIMARY,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system,
      messages,
    })

  let raw: string
  let parsed: ResidualOutput | null = null

  try {
    const first = await callAPI([{ role: "user", content: userPrompt }])
    raw =
      first.content
        .filter((b) => b.type === "text")
        .map((b) => (b as { text: string }).text)
        .join("") ?? ""
    const json = JSON.parse(extractJSON(raw))
    parsed = ResidualOutputSchema.parse(json)
  } catch {
    // Retry once with explicit fix instruction
    await prisma.auditEvent.create({
      data: {
        actorType: "AI",
        eventType: "RESIDUAL_AI_PARSE_FAIL",
        entityType: "Transaction",
        entityId: txn.id,
        rationale: "First-attempt parse/validation failure; retrying.",
      },
    })
    try {
      const second = await callAPI([
        { role: "user", content: userPrompt },
        {
          role: "user",
          content:
            "Your previous response was not valid JSON matching the required schema. Return ONLY the JSON object, no prose, no code fences.",
        },
      ])
      raw =
        second.content
          .filter((b) => b.type === "text")
          .map((b) => (b as { text: string }).text)
          .join("") ?? ""
      const json = JSON.parse(extractJSON(raw))
      parsed = ResidualOutputSchema.parse(json)
    } catch {
      // Second failure → escalate to StopItem
      return escalateToStop(txn, candidate, rule, "Residual agent parse failure on retry")
    }
  }

  const enforced = enforceInvariants(parsed!, activeTrip !== null)

  // AuditEvent
  await prisma.auditEvent.create({
    data: {
      actorType: "AI",
      eventType: "RESIDUAL_AI_CALL",
      entityType: "Transaction",
      entityId: txn.id,
      afterState: {
        code: enforced.code,
        businessPct: enforced.business_pct,
        confidence: enforced.confidence,
        reasons: candidate.reasons,
      },
    },
  })

  // Escalate if still uncertain
  if (enforced.requires_human_input) {
    return escalateToStop(txn, candidate, rule, enforced.human_question ?? "Residual agent requests user input")
  }

  // Persist classification (flip-and-insert)
  await prisma.$transaction(async (tx) => {
    await tx.classification.updateMany({
      where: { transactionId: txn.id, isCurrent: true },
      data: { isCurrent: false },
    })
    await tx.classification.create({
      data: {
        transactionId: txn.id,
        code: enforced.code,
        scheduleCLine: enforced.schedule_c_line,
        businessPct: enforced.business_pct,
        ircCitations: enforced.irc_citations,
        confidence: enforced.confidence,
        evidenceTier: enforced.evidence_tier,
        source: "AI",
        reasoning: enforced.reasoning,
        isCurrent: true,
      },
    })
  })

  return { transactionId: txn.id, outcome: "CLASSIFIED", output: enforced }
}

async function escalateToStop(
  txn: Transaction,
  candidate: ResidualCandidate,
  rule: MerchantRule | null,
  question: string
): Promise<ClassifyResidualResult> {
  const stop = await prisma.stopItem.create({
    data: {
      taxYearId: txn.taxYearId,
      merchantRuleId: rule?.id ?? null,
      category: "MERCHANT",
      question,
      transactionIds: [txn.id],
      context: {
        source: "residual_agent",
        merchantKey: candidate.merchantKey,
        reasons: candidate.reasons,
        postedDate: txn.postedDate.toISOString().slice(0, 10),
        amount: Number(txn.amountNormalized),
      },
    },
  })
  return { transactionId: txn.id, outcome: "STOP", stopItemId: stop.id }
}

export async function runResidualPass(
  taxYearId: string,
  candidates: ResidualCandidate[],
  anthropicClient?: Anthropic
): Promise<{ classified: number; stops: number }> {
  let classified = 0
  let stops = 0
  for (const c of candidates) {
    const res = await classifyResidual(c, anthropicClient)
    if (res.outcome === "CLASSIFIED") classified++
    else stops++
  }
  await prisma.auditEvent.create({
    data: {
      actorType: "AI",
      eventType: "RESIDUAL_AI_RUN_COMPLETE",
      entityType: "TaxYear",
      entityId: taxYearId,
      afterState: { classified, stops, candidates: candidates.length },
    },
  })
  return { classified, stops }
}
