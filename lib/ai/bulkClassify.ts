/**
 * CPA Bulk Classify — batch transaction-level Sonnet classifier.
 *
 * Processes remaining NEEDS_CONTEXT or unclassified transactions after the
 * residual pass. Uses a CPA-expert system prompt with injected business context.
 *
 * Model: claude-sonnet-4-6, temperature 0, max_tokens 8192.
 * Batch size: 20 transactions per call.
 * Confidence threshold: >= 0.78 → auto-apply; < 0.78 → create StopItem.
 *
 * Output is a JSON array aligned by index (same pattern as merchantCategories.ts).
 */

import Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/db"
import type { TransactionCode, Prisma } from "@/app/generated/prisma/client"

const MODEL = "claude-sonnet-4-6" as const
const BATCH_SIZE = 20
const MAX_TOKENS = 8192
const AUTO_APPLY_THRESHOLD = 0.78

export interface TxForClassification {
  id: string
  merchantRaw: string
  merchantNormalized: string | null
  descriptionRaw: string | null
  amount: number
  postedDate: string
  accountType: string
  currentCode: TransactionCode
}

export interface BulkClassifyResult {
  txId: string
  code: TransactionCode
  businessPct: number
  scheduleCLine: string | null
  ircCitations: string[]
  confidence: number
  reasoning: string
}

const SYSTEM_PROMPT = `You are a Senior CPA with 20+ years of US Schedule C expertise, specializing in e-commerce and wholesale resale businesses. You classify bank/credit card transactions for a specific client.

=== CLIENT: SA Wholesale LLC ===
A wholesale resale business that buys goods and resells them (primarily eBay and other online marketplaces).
- Uses Wise to pay overseas suppliers in Pakistan
- Uses Stripe to receive marketplace payouts
- Contractors paid via Pocketsflow or Zelle
- Owner's name: Atif

=== CLASSIFICATION CODES (use exactly these strings) ===
BIZ_INCOME       — gross business income / receipt (no deduction)
WRITE_OFF        — deductible business expense at businessPct% (scheduleCLine required)
WRITE_OFF_COGS   — cost of goods sold (Part III, reduces gross profit)
WRITE_OFF_TRAVEL — 100% deductible business travel (Line 24a)
MEALS_50         — 50% deductible meals (Line 24b)
PAYMENT          — credit card / loan payment (clears a liability, not an expense)
TRANSFER         — inter-account transfer or owner contribution/draw (not income, not expense)
PERSONAL         — personal / non-deductible
NEEDS_CONTEXT    — genuinely cannot determine without more info (set confidence ≤ 0.50)

=== SCHEDULE C LINES ===
Line 8 Advertising, Line 9 Car & Truck, Line 11 Contract Labor, Line 13 Depreciation,
Line 15 Insurance, Line 16b Interest, Line 17 Legal & Professional, Line 18 Office Expense,
Line 20b Rent — Other, Line 21 Repairs & Maintenance, Line 22 Supplies,
Line 23 Taxes & Licenses, Line 24a Travel, Line 24b Meals, Line 25 Utilities,
Line 27a Other Expenses, Line 30 Home Office, Part III COGS, N/A

=== IRC CITATIONS ===
§61 (income), §162 (ordinary business expense), §263A (COGS), §274(d) (meals/travel),
§262 (personal), §1402 (self-employment), §280A (home office)

=== PATTERN RULES (high confidence — apply directly) ===
- eBay payout deposits → BIZ_INCOME, §61, confidence 0.97
- "STRIPE" payouts to SA Wholesale LLC → BIZ_INCOME, §61, confidence 0.97
- "SENT MONEY TO [person]" via Wise → WRITE_OFF_COGS, Part III COGS, §263A, confidence 0.95
- "PAYMENT THANK YOU" on credit card statements → PAYMENT, N/A, confidence 0.98
- "TOPPED UP ACCOUNT" or owner cash deposit → TRANSFER, N/A, confidence 0.96
- Pocketsflow transfers to named individuals → WRITE_OFF, Line 11 Contract Labor, §162, confidence 0.95
- Wise platform fees, service charges → WRITE_OFF, Line 27a Other Expenses, §162, confidence 0.95
- Bank maintenance/service fees → WRITE_OFF, Line 27a Other Expenses, §162, confidence 0.95
- "RECEIVED FROM [name]" Zelle inflows from known business contacts → BIZ_INCOME, §61
- Apple Cash / personal Zelle to family → PERSONAL or TRANSFER, confidence 0.90
- Liberis / merchant cash advance receipt → TRANSFER (loan proceeds, not income)
- Liberis / merchant cash advance repayment → PAYMENT

=== CONFIDENCE GUIDE ===
0.95+  : No ambiguity — clear pattern match
0.85–0.94 : Strong inference from name + amount + context
0.78–0.84 : Reasonable inference with minor uncertainty (still auto-applied)
< 0.78 : Ambiguous — will create a stop for user review
≤ 0.50 : NEEDS_CONTEXT — set this code when confidence ≤ 0.50

=== NEVER AUTO-CLASSIFY ===
- Transactions that look like they could be loan proceeds or owner draws > $5,000 with no clear pattern
- Transactions with "RETURNED" or "REVERSED" in the description
- Anything that's clearly a duplicate or refund without context

=== OUTPUT FORMAT ===
Return ONLY a JSON array with exactly one object per input transaction, in the SAME ORDER as the input.
No prose, no markdown. Each object:
{"code":"...","businessPct":100,"scheduleCLine":"...","ircCitations":["§162"],"confidence":0.95,"reasoning":"..."}`

export async function buildBusinessContext(taxYearId: string): Promise<string> {
  const [profile, trips, entities, sessions] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { taxYearId } }),
    prisma.trip.findMany({ where: { profile: { taxYearId }, isConfirmed: true } }),
    prisma.knownEntity.findMany({ where: { profile: { taxYearId } } }),
    prisma.importSession.findMany({
      where: { taxYear: { id: taxYearId } },
      include: { imports: { select: { userNotes: true } } },
    }),
  ])

  const lines: string[] = []

  if (profile) {
    lines.push(`Business: ${profile.businessDescription ?? "wholesale resale"}`)
    lines.push(`NAICS: ${profile.naicsCode ?? "424"}`)
    lines.push(`State: ${profile.primaryState}`)
    if (profile.revenueStreams?.length) {
      lines.push(`Revenue streams: ${profile.revenueStreams.join(", ")}`)
    }
  }

  if (trips.length) {
    lines.push("Confirmed trips: " + trips.map((t) =>
      `"${t.name}" to ${t.destination} ${t.startDate.toISOString().slice(0, 10)}–${t.endDate.toISOString().slice(0, 10)}`
    ).join("; "))
  }

  if (entities.length) {
    lines.push("Known entities: " + entities.map((e) =>
      `${e.displayName} [${e.kind}]: ${e.matchKeywords.join(", ")}`
    ).join("; "))
  }

  // Session notes from CPA/user
  const allNotes: string[] = []
  for (const s of sessions) {
    if (s.notes) allNotes.push(String(s.notes))
    for (const imp of s.imports) {
      if (imp.userNotes) {
        const notes = imp.userNotes as Record<string, unknown>
        for (const v of Object.values(notes)) {
          if (typeof v === "string" && v.trim()) allNotes.push(v.trim())
        }
      }
    }
  }
  if (allNotes.length) {
    lines.push("Client notes: " + allNotes.join("; "))
  }

  return lines.join(". ")
}

const VALID_CITATIONS = new Set([
  "§61", "§162", "§162(a)", "§263A", "§274(d)", "§274(n)", "§274(n)(1)", "§274(n)(2)",
  "§262", "§1402", "§280A", "§280A(c)", "§168(k)", "§179", "§280F", "§195", "§6001", "Cohan",
])

function sanitizeCitations(citations: unknown[]): string[] {
  return citations
    .filter((c): c is string => typeof c === "string")
    .map((c) => (VALID_CITATIONS.has(c) ? c : "[VERIFY]"))
}

export async function bulkClassifyTransactions(
  transactions: TxForClassification[],
  businessContext: string,
  client?: Anthropic,
): Promise<BulkClassifyResult[]> {
  if (transactions.length === 0) return []
  const anthropic = client ?? new Anthropic({ apiKey: process.env["ANTHROPIC_API_KEY"] })

  const results: BulkClassifyResult[] = []

  for (let i = 0; i < transactions.length; i += BATCH_SIZE) {
    const batch = transactions.slice(i, i + BATCH_SIZE)
    const userMsg = [
      businessContext ? `Client context: ${businessContext}\n` : "",
      `Classify these ${batch.length} transactions (return array in same order):\n`,
      JSON.stringify(batch.map((t) => ({
        merchantRaw: t.merchantRaw,
        merchantNormalized: t.merchantNormalized,
        description: t.descriptionRaw,
        amount: t.amount,
        date: t.postedDate,
        account: t.accountType,
        currentCode: t.currentCode,
      })), null, 0),
    ].join("")

    try {
      const res = await anthropic.messages.create({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        temperature: 0,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }],
      })
      const block = res.content[0]
      if (!block || block.type !== "text") continue
      const text = block.text
      const s = text.indexOf("[")
      const e = text.lastIndexOf("]")
      if (s < 0 || e <= s) continue
      const parsed = JSON.parse(text.slice(s, e + 1)) as unknown[]
      if (!Array.isArray(parsed)) continue

      for (let j = 0; j < batch.length; j++) {
        const tx = batch[j]!
        const item = parsed[j] as Record<string, unknown> | undefined
        if (!item || typeof item !== "object") continue

        const code = (item["code"] as TransactionCode) ?? "NEEDS_CONTEXT"
        const businessPct = typeof item["businessPct"] === "number" ? Math.round(item["businessPct"]) : 0
        const scheduleCLine = typeof item["scheduleCLine"] === "string" ? item["scheduleCLine"] : null
        const ircCitations = Array.isArray(item["ircCitations"]) ? sanitizeCitations(item["ircCitations"]) : []
        const confidence = typeof item["confidence"] === "number" ? item["confidence"] : 0
        const reasoning = typeof item["reasoning"] === "string" ? item["reasoning"] : ""

        results.push({ txId: tx.id, code, businessPct, scheduleCLine, ircCitations, confidence, reasoning })
      }
    } catch {
      // partial batch failure — leave those transactions as NEEDS_CONTEXT
    }
  }

  return results
}

export { AUTO_APPLY_THRESHOLD }

// ---------------------------------------------------------------------------
// DB-backed run function — applies results to DB
// ---------------------------------------------------------------------------

export interface BulkClassifyRunResult {
  processed: number
  autoApplied: number
  stopsCreated: number
}

export async function runBulkClassifyPass(
  taxYearId: string,
  userId: string,
  anthropicClient?: Anthropic,
): Promise<BulkClassifyRunResult> {
  // Fetch NEEDS_CONTEXT transactions (AI-set, not user-confirmed)
  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isDuplicateOf: null,
    },
    include: {
      account: true,
      classifications: {
        where: { isCurrent: true },
        take: 1,
      },
    },
  })

  // Filter: no classification OR AI-set NEEDS_CONTEXT
  const candidates = txns.filter((t) => {
    const c = t.classifications[0]
    if (!c) return true
    return c.code === "NEEDS_CONTEXT" && c.source === "AI"
  })

  if (candidates.length === 0) return { processed: 0, autoApplied: 0, stopsCreated: 0 }

  const businessContext = await buildBusinessContext(taxYearId)

  const forAI: TxForClassification[] = candidates.map((t) => ({
    id: t.id,
    merchantRaw: t.merchantRaw,
    merchantNormalized: t.merchantNormalized,
    descriptionRaw: t.descriptionRaw,
    amount: Number(t.amountNormalized),
    postedDate: t.postedDate.toISOString().slice(0, 10),
    accountType: t.account.nickname ?? String(t.account.type),
    currentCode: (t.classifications[0]?.code ?? "NEEDS_CONTEXT") as TransactionCode,
  }))

  const aiResults = await bulkClassifyTransactions(forAI, businessContext, anthropicClient)
  const resultMap = new Map(aiResults.map((r) => [r.txId, r]))

  let autoApplied = 0
  let stopsCreated = 0

  for (const tx of candidates) {
    const ai = resultMap.get(tx.id)
    if (!ai) continue

    if (ai.confidence >= AUTO_APPLY_THRESHOLD && ai.code !== "NEEDS_CONTEXT") {
      await prisma.$transaction(async (prismaT) => {
        await prismaT.classification.updateMany({
          where: { transactionId: tx.id, isCurrent: true },
          data: { isCurrent: false },
        })
        await prismaT.classification.create({
          data: {
            transactionId: tx.id,
            code: ai.code,
            scheduleCLine: ai.scheduleCLine,
            businessPct: ai.businessPct,
            ircCitations: ai.ircCitations,
            confidence: ai.confidence,
            evidenceTier: 3,
            source: "AI",
            reasoning: ai.reasoning,
            isCurrent: true,
            createdByUserId: userId,
          },
        })
        await prismaT.auditEvent.create({
          data: {
            userId,
            actorType: "AI",
            eventType: "BULK_CLASSIFY",
            entityType: "Transaction",
            entityId: tx.id,
            afterState: { code: ai.code, businessPct: ai.businessPct, confidence: ai.confidence } as Prisma.InputJsonValue,
            rationale: ai.reasoning,
          },
        })
      })
      autoApplied++
    } else {
      // Check if a PENDING stop already exists for this transaction
      const existingStop = await prisma.stopItem.findFirst({
        where: {
          taxYearId,
          state: "PENDING",
          transactionIds: { has: tx.id },
        },
      })
      if (!existingStop) {
        const merchantKey = tx.merchantNormalized ?? tx.merchantRaw
        const rule = await prisma.merchantRule.findFirst({
          where: { taxYearId, merchantKey },
        })
        await prisma.stopItem.create({
          data: {
            taxYearId,
            category: "MERCHANT",
            merchantRuleId: rule?.id ?? null,
            transactionIds: [tx.id],
            state: "PENDING",
            question: ai.reasoning || `How should "${tx.merchantRaw}" be classified?`,
            context: {
              aiSuggestedCode: ai.code,
              aiConfidence: ai.confidence,
              aiReasoning: ai.reasoning,
              merchantRaw: tx.merchantRaw,
              amount: Number(tx.amountNormalized),
            } as Prisma.InputJsonValue,
          },
        })
        stopsCreated++
      }
    }
  }

  return { processed: candidates.length, autoApplied, stopsCreated }
}
