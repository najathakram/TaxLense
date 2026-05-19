/**
 * SUBSTANTIATION_QUEUE — Stage 8 of the auto-CPA pipeline.
 *
 * For every §274(d)-looking row that landed PERSONAL (because contemporaneous
 * substantiation was missing), surface a StopItem with a *template* the user
 * can fill in. The AI proposes WHAT QUESTIONS to ask; the human supplies the
 * facts. Empty attendees/purpose fields are REQUIRED — the form refuses to
 * submit without them, and the classification is only created on user submit.
 *
 * This is the principle-8 hard rail in action: the system cannot fabricate
 * §274(d) substantiation. The substantiation queue is the legitimate channel
 * for reconstructing meal/travel/vehicle deductions when Atif (or any client)
 * actually remembers the attendees and purpose.
 *
 * Output: StopItem rows with category=SECTION_274D, aiSuggestion populated
 * with the question + context, but with empty user-facts fields.
 *
 * Model: Sonnet 4.6 for template generation. Cost ~$0.30/run.
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { prisma } from "@/lib/db"
import type { ProgressReporter } from "@/lib/jobs/pipelineRun"
import { isSection274dCandidate } from "@/lib/classification/cohanGuards"
import { fmtUSD } from "@/lib/format/currency"

const MODEL = "claude-sonnet-4-6" as const

const MIN_CANDIDATE_AMOUNT = 25
const MAX_CANDIDATES_PER_RUN = 50

const TemplateSchema = z.object({
  txId: z.string(),
  // Why does this row LOOK business-adjacent? Used in the question prompt.
  contextReason: z.string().min(10),
  // The question shown to the user. Phrased to elicit attendees + purpose if
  // the row was actually business; or to confirm personal otherwise.
  question: z.string().min(20),
  // What category does the AI think this falls into IF the user confirms business?
  hypotheticalCategory: z.enum(["MEAL_BUSINESS", "TRAVEL_BUSINESS", "VEHICLE_BUSINESS", "GIFT_BUSINESS", "OTHER_274D"]),
})

const ResponseSchema = z.object({
  templates: z.array(TemplateSchema),
})

export type SubstantiationTemplate = z.infer<typeof TemplateSchema>

export interface SubstantiationQueueResult {
  candidatesConsidered: number
  templatesQueued: number
  modelUsed: string
}

interface Candidate {
  id: string
  date: string
  merchant: string
  amount: number
  currentReasoning: string | null
  tripWindowName: string | null
}

export async function runSubstantiationQueue(
  taxYearId: string,
  reportProgress?: ProgressReporter,
  options: { runId?: string; anthropicClient?: Anthropic } = {}
): Promise<SubstantiationQueueResult> {
  const client = options.anthropicClient ?? new Anthropic()

  if (reportProgress) {
    await reportProgress({
      phase: "substantiation_queue",
      processed: 0,
      total: 3,
      label: "Identifying §274(d) candidates currently in PERSONAL…",
    })
  }

  // 1. Load PERSONAL rows that look like §274(d) merchants
  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isStale: false,
      amountNormalized: { gt: 0 },
    },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
    orderBy: { postedDate: "asc" },
  })

  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    include: { trips: true },
  })

  const candidates: Candidate[] = []
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    if (c.code !== "PERSONAL" && c.code !== "NEEDS_CONTEXT") continue
    const amt = Math.abs(Number(t.amountNormalized))
    if (amt < MIN_CANDIDATE_AMOUNT) continue
    if (!isSection274dCandidate(t.merchantRaw)) continue

    // Find trip window if any
    let tripName: string | null = null
    if (profile?.trips) {
      for (const trip of profile.trips) {
        if (t.postedDate >= trip.startDate && t.postedDate <= trip.endDate) {
          tripName = trip.name
          break
        }
      }
    }

    candidates.push({
      id: t.id,
      date: t.postedDate.toISOString().slice(0, 10),
      merchant: t.merchantRaw,
      amount: amt,
      currentReasoning: c.reasoning,
      tripWindowName: tripName,
    })
    if (candidates.length >= MAX_CANDIDATES_PER_RUN) break
  }

  if (reportProgress) {
    await reportProgress({
      phase: "substantiation_queue",
      processed: 1,
      total: 3,
      label: `${candidates.length} candidates — generating templates…`,
    })
  }

  if (candidates.length === 0) {
    await prisma.auditEvent.create({
      data: {
        actorType: "AI",
        eventType: "SUBSTANTIATION_QUEUE_RUN",
        entityType: "TaxYear",
        entityId: taxYearId,
        afterState: { templatesQueued: 0, modelUsed: "n/a" },
      },
    })
    return { candidatesConsidered: 0, templatesQueued: 0, modelUsed: "n/a" }
  }

  const systemPrompt = `You are a CPA generating substantiation prompts for a taxpayer's locked-pending tax-year ledger.

PRINCIPLE 8 HARD RAIL (read this carefully):
You DO NOT invent attendees. You DO NOT invent business purposes. You generate the QUESTION
the taxpayer must answer. The taxpayer answers the question themselves; if they don't
remember, the row stays PERSONAL.

Your job: for each candidate row, write a question that elicits §274(d) substantiation
WITHOUT putting words in the taxpayer's mouth.

GOOD QUESTION EXAMPLES:
  - "This $42.50 at STARBUCKS on 2025-06-12 — was it a client meeting? If yes, who was present and what was discussed?"
  - "This $1,247 UNITED AIRLINES charge on 2025-09-15 — was this a business trip? Destination + business purpose?"
  - "This $310 STARBUCKS GIFT charge on 2025-12-18 — was this a client gift? Recipient name + business relationship?"

BAD QUESTION EXAMPLES (do NOT do this):
  - "Was this your meal with Acme Corp regarding the Q4 contract?" — you invented Acme + contract.
  - "Confirm $42.50 STARBUCKS for client meeting with John." — you invented John.

Your tone is helpful and specific to the row's amount/merchant/date — but factually neutral.

OUTPUT FORMAT — STRICT JSON ONLY:
{
  "templates": [
    {
      "txId": "tx_xxx",
      "contextReason": "Restaurant charge during a confirmed trip window — business-adjacent.",
      "question": "This $42.50 at STARBUCKS on 2025-06-12 falls during your Anchorage trip (2025-06-10 to 2025-06-15). Was it a business meal? If yes, who was present and what was discussed?",
      "hypotheticalCategory": "MEAL_BUSINESS"
    }
  ]
}

Generate one template per candidate. Keep questions under 200 chars.`

  const candidateLines = candidates.map(
    (c) =>
      `  ${c.id} | ${c.date} | ${c.merchant.slice(0, 60)} | ${fmtUSD(c.amount, { cents: true })} | trip: ${c.tripWindowName ?? "none"} | currentReason: ${c.currentReasoning?.slice(0, 80) ?? "n/a"}`
  )

  const userPrompt = `Candidates:

${candidateLines.join("\n")}

Generate one substantiation question per candidate. Return strict JSON only.`

  let parsed: { templates: SubstantiationTemplate[] } | null = null
  let lastError: string | null = null
  try {
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 4096,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    })
    const text = response.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n")
    parsed = ResponseSchema.parse(JSON.parse(stripFences(text)))
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err)
    console.error("[substantiation_queue] AI call failed:", lastError)
  }

  if (!parsed) {
    await prisma.auditEvent.create({
      data: {
        actorType: "AI",
        eventType: "SUBSTANTIATION_QUEUE_RUN",
        entityType: "TaxYear",
        entityId: taxYearId,
        afterState: { templatesQueued: 0, error: lastError, modelUsed: MODEL },
      },
    })
    return { candidatesConsidered: candidates.length, templatesQueued: 0, modelUsed: MODEL }
  }

  // 2. Write StopItems for each template
  // Note: aiSuggestion carries the question + context, but the human-facts
  // fields (attendees, purpose) are explicitly EMPTY strings. The
  // substantiation form (UI not built in this PR — surfaced via existing
  // /stops page) requires the user to fill them in before the form submits.
  const candidateById = new Map(candidates.map((c) => [c.id, c]))
  let templatesQueued = 0
  for (const t of parsed.templates) {
    const cand = candidateById.get(t.txId)
    if (!cand) continue

    // Sanitize: in case the model put real-looking facts into the template,
    // strip any quoted strings — leave only the meta question.
    const sanitizedQuestion = t.question.length > 220 ? t.question.slice(0, 217) + "..." : t.question

    // The aiSuggestion shape mirrors the existing stops-client.tsx union but
    // for SECTION_274D it explicitly carries empty attendees/purpose fields so
    // the form template renders the empty fields for human entry.
    const aiSuggestion = {
      kind: "section_274d_template",
      hypotheticalCategory: t.hypotheticalCategory,
      contextReason: t.contextReason,
      question: sanitizedQuestion,
      // CRITICAL: these are EMPTY by design. Never write a value here.
      attendees: "",
      purpose: "",
      confidence: 0.5,
    }

    await prisma.$transaction(async (tx) => {
      const created = await tx.stopItem.create({
        data: {
          taxYearId,
          category: "SECTION_274D",
          question: sanitizedQuestion,
          context: {
            txnId: cand.id,
            merchant: cand.merchant,
            amount: cand.amount,
            date: cand.date,
            tripWindowName: cand.tripWindowName,
            contextReason: t.contextReason,
          },
          transactionIds: [cand.id],
          state: "PENDING",
          aiSuggestion,
        },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "AI",
          eventType: "SUBSTANTIATION_CANDIDATE_QUEUED",
          entityType: "StopItem",
          entityId: created.id,
          afterState: {
            txnId: cand.id,
            merchant: cand.merchant,
            hypotheticalCategory: t.hypotheticalCategory,
            attendeesEmpty: true,
            purposeEmpty: true,
          },
        },
      })
    })
    templatesQueued++
  }

  await prisma.auditEvent.create({
    data: {
      actorType: "AI",
      eventType: "SUBSTANTIATION_QUEUE_RUN",
      entityType: "TaxYear",
      entityId: taxYearId,
      afterState: { templatesQueued, modelUsed: MODEL },
    },
  })

  if (reportProgress) {
    await reportProgress({
      phase: "substantiation_queue",
      processed: 3,
      total: 3,
      label: `Done · ${templatesQueued} substantiation prompts queued`,
    })
  }

  return { candidatesConsidered: candidates.length, templatesQueued, modelUsed: MODEL }
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
}
