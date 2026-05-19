/**
 * COHAN_SWEEP — Stage 7 of the auto-CPA pipeline.
 *
 * Walks PERSONAL / GRAY / NEEDS_CONTEXT rows + currently-tier-3 §162 rows,
 * promotes where bank-statement visibility + NAICS nexus + prior-year pattern
 * support a §162 claim, and tags cohanFlag=true. Hard-blocked from §274(d)
 * categories via lib/classification/cohanGuards.ts.
 *
 * Model: Sonnet 4.6 default; Opus 4.7 when aggregate candidate exposure ≥$10K.
 * Output: LedgerFinding[] with proposedAction.cohanFlag=true. Findings are
 * applied later by lib/findings/apply.ts after user batch-approves.
 *
 * Cost target: ~$0.40 / run at Atif scale.
 */

import Anthropic from "@anthropic-ai/sdk"
import { z } from "zod"
import { prisma } from "@/lib/db"
import type { TransactionCode } from "@/app/generated/prisma/client"
import type { ProgressReporter } from "@/lib/jobs/pipelineRun"
import {
  assertNot274dCohan,
  isSection274dCandidate,
} from "@/lib/classification/cohanGuards"
import { fmtUSD } from "@/lib/format/currency"

const MODEL_DEFAULT = "claude-sonnet-4-6" as const
const MODEL_HIGH_EXPOSURE = "claude-opus-4-7" as const
const HIGH_EXPOSURE_THRESHOLD = 10_000

const MIN_CANDIDATE_AMOUNT = 100

const VALID_DEDUCTIBLE: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_COGS",
  "GRAY",
]

const VALID_CITATIONS = new Set([
  "§61",
  "§162",
  "§162(a)",
  "§263A",
  "§471",
  "§471(c)",
  "§6001",
  "Cohan",
])

// Permissive schema so the AI's natural variance doesn't tank a whole batch.
// All explanatory fields fall back to empty strings; missing decisions default
// to SKIP. The §274(d) hard rail runs at finding-write time regardless.
const ProposalSchema = z
  .object({
    txId: z.string(),
    decision: z.enum(["PROMOTE", "TIER_BUMP", "SKIP"]).default("SKIP"),
    proposedCode: z.enum(["WRITE_OFF", "WRITE_OFF_COGS", "GRAY", "PERSONAL", "NEEDS_CONTEXT"]).optional(),
    proposedLine: z.string().nullable().optional(),
    proposedTier: z.number().int().min(1).max(5).optional(),
    ircCitations: z.array(z.string()).default([]),
    rationale: z.string().default(""),
    naicsNexus: z.string().default(""),
    bankVisibility: z.string().default(""),
    priorYearPattern: z.string().nullable().optional(),
    confidence: z.number().min(0).max(1).default(0),
  })
  .transform((p) => ({
    ...p,
    proposedCode: p.proposedCode ?? "WRITE_OFF",
    proposedLine: p.proposedLine ?? null,
    proposedTier: p.proposedTier ?? 3,
    priorYearPattern: p.priorYearPattern ?? null,
  }))

const ResponseSchema = z.object({
  proposals: z.array(ProposalSchema),
})

export type CohanProposal = z.infer<typeof ProposalSchema>

export interface CohanSweepResult {
  candidatesConsidered: number
  proposalsWritten: number
  forbiddenRejected: number
  modelUsed: string
}

interface Candidate {
  id: string
  date: string
  merchant: string
  merchantNormalized: string | null
  amount: number
  currentCode: TransactionCode
  currentTier: number
  currentLine: string | null
  currentCitations: string[]
  currentReasoning: string | null
  cohanFlag: boolean
}

export async function runCohanSweep(
  taxYearId: string,
  reportProgress?: ProgressReporter,
  options: { runId?: string; anthropicClient?: Anthropic } = {}
): Promise<CohanSweepResult> {
  const client = options.anthropicClient ?? new Anthropic()

  if (reportProgress) {
    await reportProgress({
      phase: "cohan_sweep",
      processed: 0,
      total: 3,
      label: "Selecting Cohan candidates…",
    })
  }

  // 1. Load candidate rows
  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isStale: false,
      amountNormalized: { gt: 0 }, // outflows only — Cohan applies to expenses
    },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
    orderBy: { postedDate: "asc" },
  })

  const profile = await prisma.businessProfile.findUnique({
    where: { taxYearId },
    select: { naicsCode: true, businessDescription: true, primaryState: true },
  })

  const priorYearContext = await prisma.priorYearContext.findUnique({
    where: { taxYearId },
    select: { sourcePriorYearId: true, sourceLockedHash: true },
  })
  const priorMerchantHistory = await loadPriorMerchantHistory(priorYearContext?.sourcePriorYearId ?? null)

  const candidates: Candidate[] = []
  let forbiddenRejected = 0

  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const amt = Math.abs(Number(t.amountNormalized))
    if (amt < MIN_CANDIDATE_AMOUNT) continue

    const eligibleAsPersonalPromotion =
      (c.code === "PERSONAL" || c.code === "GRAY" || c.code === "NEEDS_CONTEXT") && amt >= MIN_CANDIDATE_AMOUNT
    const eligibleAsTierBump = c.code === "WRITE_OFF" || c.code === "WRITE_OFF_COGS"
    if (!eligibleAsPersonalPromotion && !eligibleAsTierBump) continue

    // §274(d) bright-line filter — checks code, citation, line, and merchant.
    const guard = assertNot274dCohan({
      code: c.code,
      merchantRaw: t.merchantRaw,
      merchantNormalized: t.merchantNormalized,
      ircCitations: c.ircCitations,
      scheduleCLine: c.scheduleCLine,
    })
    if (!guard.allowed) {
      forbiddenRejected++
      continue
    }

    // §274(d) merchant fragment safety net (covers PERSONAL rows that have no
    // citation yet — `assertNot274dCohan` already checks this, but explicit
    // for clarity).
    if (isSection274dCandidate(t.merchantRaw)) {
      forbiddenRejected++
      continue
    }

    candidates.push({
      id: t.id,
      date: t.postedDate.toISOString().slice(0, 10),
      merchant: t.merchantRaw,
      merchantNormalized: t.merchantNormalized,
      amount: amt,
      currentCode: c.code,
      currentTier: c.evidenceTier,
      currentLine: c.scheduleCLine,
      currentCitations: c.ircCitations,
      currentReasoning: c.reasoning,
      cohanFlag: c.cohanFlag,
    })
  }

  if (reportProgress) {
    await reportProgress({
      phase: "cohan_sweep",
      processed: 1,
      total: 3,
      label: `${candidates.length} candidates; ${forbiddenRejected} §274(d) rejected. Calling AI…`,
    })
  }

  if (candidates.length === 0) {
    await prisma.auditEvent.create({
      data: {
        actorType: "AI",
        eventType: "COHAN_SWEEP_RUN",
        entityType: "TaxYear",
        entityId: taxYearId,
        afterState: { proposals: 0, forbiddenRejected, modelUsed: "n/a" },
      },
    })
    return { candidatesConsidered: 0, proposalsWritten: 0, forbiddenRejected, modelUsed: "n/a" }
  }

  // 2. Pick model based on total candidate exposure
  const totalExposure = candidates.reduce((acc, c) => acc + c.amount, 0)
  const modelUsed = totalExposure >= HIGH_EXPOSURE_THRESHOLD ? MODEL_HIGH_EXPOSURE : MODEL_DEFAULT

  // 3. Prompt — batch all candidates in one call (Sonnet handles ~100 rows easily)
  const systemPrompt = buildSystemPrompt(profile, priorYearContext?.sourceLockedHash ?? null)
  const userPrompt = buildUserPrompt(candidates, priorMerchantHistory)

  let parsed: { proposals: CohanProposal[] } | null = null
  let lastError: string | null = null
  try {
    const response = await client.messages.create({
      model: modelUsed,
      max_tokens: 8192,
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
    console.error("[cohan_sweep] AI call failed:", lastError)
  }

  if (!parsed) {
    await prisma.auditEvent.create({
      data: {
        actorType: "AI",
        eventType: "COHAN_SWEEP_RUN",
        entityType: "TaxYear",
        entityId: taxYearId,
        afterState: { proposals: 0, forbiddenRejected, modelUsed, error: lastError },
      },
    })
    return { candidatesConsidered: candidates.length, proposalsWritten: 0, forbiddenRejected, modelUsed }
  }

  // 4. Write LedgerFinding rows
  let proposalsWritten = 0
  const candidateById = new Map(candidates.map((c) => [c.id, c]))

  for (const p of parsed.proposals) {
    if (p.decision === "SKIP") continue
    const cand = candidateById.get(p.txId)
    if (!cand) continue

    // Sanitize citations to whitelist
    const cleanCitations = p.ircCitations.map((c) => (VALID_CITATIONS.has(c) ? c : "[VERIFY]"))
    // Always include §162 + Cohan for sweep proposals
    if (!cleanCitations.includes("§162")) cleanCitations.push("§162")
    if (!cleanCitations.includes("Cohan")) cleanCitations.push("Cohan")

    // Defense-in-depth: re-run §274(d) guard on the AI's proposal too — the
    // model might propose a §274(d) code despite the prompt.
    const guard = assertNot274dCohan({
      code: p.proposedCode as TransactionCode,
      merchantRaw: cand.merchant,
      merchantNormalized: cand.merchantNormalized,
      ircCitations: cleanCitations,
      scheduleCLine: p.proposedLine,
    })
    if (!guard.allowed) {
      await prisma.auditEvent.create({
        data: {
          actorType: "AI",
          eventType: "COHAN_FORBIDDEN_REJECTED",
          entityType: "Transaction",
          entityId: cand.id,
          afterState: { reason: guard.reason, proposedCode: p.proposedCode },
        },
      })
      forbiddenRejected++
      continue
    }

    // Only PROMOTE / TIER_BUMP yield findings; both set cohanFlag=true on the
    // proposed Classification.
    const businessPct = p.proposedCode === "PERSONAL" || p.proposedCode === "NEEDS_CONTEXT" ? 0 : 100
    const severity =
      cand.amount >= 1000 ? "HIGH" : cand.amount >= 250 ? "MEDIUM" : "LOW"

    const category = p.decision === "PROMOTE" ? "PERSONAL_ANOMALY" : "SUSPECT_CLASS"
    const title =
      p.decision === "PROMOTE"
        ? `Promote ${cand.merchant.slice(0, 40)} ${fmtUSD(cand.amount, { cents: true })} to ${p.proposedCode} (Cohan §162)`
        : `Tier bump ${cand.merchant.slice(0, 40)} ${fmtUSD(cand.amount, { cents: true })} → tier ${p.proposedTier} with cohanFlag`

    await prisma.$transaction(async (tx) => {
      const created = await tx.ledgerFinding.create({
        data: {
          taxYearId,
          generatedRunId: options.runId ?? null,
          severity,
          category,
          title,
          rationale: `${p.rationale}\n\nNAICS nexus: ${p.naicsNexus}\nBank visibility: ${p.bankVisibility}\nPrior-year pattern: ${p.priorYearPattern ?? "none"}\nConfidence: ${p.confidence.toFixed(2)}`,
          autoFixable: p.confidence >= 0.75,
          proposedAction: {
            kind: "RECLASSIFY",
            txnIds: [cand.id],
            code: p.proposedCode,
            businessPct,
            scheduleCLine: p.proposedLine,
            ircCitations: cleanCitations,
            evidenceTier: p.proposedTier,
            cohanFlag: true,
          },
          citedTxnIds: [cand.id],
        },
      })
      await tx.auditEvent.create({
        data: {
          actorType: "AI",
          eventType: "LEDGER_FINDING_PROPOSED",
          entityType: "LedgerFinding",
          entityId: created.id,
          afterState: { category, severity, source: "COHAN_SWEEP" },
        },
      })
    })
    proposalsWritten++
  }

  await prisma.auditEvent.create({
    data: {
      actorType: "AI",
      eventType: "COHAN_SWEEP_RUN",
      entityType: "TaxYear",
      entityId: taxYearId,
      afterState: { proposalsWritten, forbiddenRejected, modelUsed, candidatesConsidered: candidates.length },
    },
  })

  if (reportProgress) {
    await reportProgress({
      phase: "cohan_sweep",
      processed: 3,
      total: 3,
      label: `Done · ${proposalsWritten} proposals · ${forbiddenRejected} §274(d) rejected`,
    })
  }

  return { candidatesConsidered: candidates.length, proposalsWritten, forbiddenRejected, modelUsed }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function loadPriorMerchantHistory(priorYearId: string | null): Promise<Map<string, number>> {
  if (!priorYearId) return new Map()
  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId: priorYearId,
      isSplit: false,
      isStale: false,
    },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  const counts = new Map<string, number>()
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    const isDeductible = c.code === "WRITE_OFF" || c.code === "WRITE_OFF_COGS" || c.code === "GRAY"
    if (!isDeductible) continue
    const key = (t.merchantNormalized ?? t.merchantRaw).toUpperCase().slice(0, 60)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function buildSystemPrompt(
  profile: { naicsCode: string | null; businessDescription: string | null; primaryState: string | null } | null,
  priorLockedHash: string | null
): string {
  return `You are a CPA performing a strategic §162 Cohan reconstruction sweep on a locked-pending tax-year ledger.

TAXPAYER:
  NAICS: ${profile?.naicsCode ?? "Unknown"}
  Business: ${profile?.businessDescription ?? "Unknown"}
  State: ${profile?.primaryState ?? "Unknown"}
  Prior locked year available: ${priorLockedHash ? "Yes (use prior-year merchant continuity as evidence)" : "No"}

OBJECTIVE:
Decide for each candidate transaction whether the bank-statement evidence + NAICS nexus + prior-year pattern
supports a §162 Cohan reconstruction. Two ways to act:

  PROMOTE — currently PERSONAL/GRAY/NEEDS_CONTEXT. If you can defend this as ordinary-and-necessary
    business expense under §162, propose flipping to WRITE_OFF or WRITE_OFF_COGS (whichever fits)
    with the cohanFlag set. Tier 3 (bank-only evidence) is the default; tier 4 only if you have
    additional inferences (recurrent pattern, prior-year continuity).

  TIER_BUMP — currently WRITE_OFF or WRITE_OFF_COGS at tier 3. The current claim is already valid;
    the bump just makes the audit packet honest about the reconstruction nature by setting cohanFlag.
    Always tier 3 unless prior-year evidence justifies tier 4.

  SKIP — keep current classification. Use when you can't defend a promotion (insufficient NAICS nexus,
    obviously personal, evidence too thin).

HARD §274(d) RAIL — DENIED CATEGORIES:
You will NEVER propose Cohan reconstruction for meals (MEALS_50, MEALS_100), travel
(WRITE_OFF_TRAVEL), vehicle, gifts, or listed property. §274(d) requires contemporaneous
substantiation; Cohan estimation is not available. The candidate filter has already removed
most §274(d) merchants from your input, but if you see any restaurant, hotel, airline, fuel,
rental-car, gift, or rideshare merchant — return decision=SKIP, regardless of NAICS nexus.

Allowed codes you may propose: WRITE_OFF, WRITE_OFF_COGS, GRAY, PERSONAL, NEEDS_CONTEXT.
NEVER propose MEALS_*, WRITE_OFF_TRAVEL, TRANSFER, PAYMENT, or BIZ_INCOME.

Allowed Schedule C lines (pick the most specific):
  Line 11 Contract Labor / Line 17 Legal and Professional / Line 18 Office Expense /
  Line 22 Supplies / Line 23 Taxes & Licenses / Line 25 Utilities / Line 27a Other Expenses /
  Part III COGS.
Never propose Line 24a or Line 24b (those are §274(d) lines).

Allowed IRC citations: §162, §162(a), §263A, §471, §471(c), §6001, Cohan.

OUTPUT FORMAT — STRICT JSON ONLY:
{
  "proposals": [
    {
      "txId": "tx_xxx",
      "decision": "PROMOTE",
      "proposedCode": "WRITE_OFF",
      "proposedLine": "Line 27a Other Expenses",
      "proposedTier": 3,
      "ircCitations": ["§162", "Cohan"],
      "rationale": "Why this is ordinary-and-necessary for this taxpayer's trade...",
      "naicsNexus": "NAICS 454110 dropshipping → processor settlement is ordinary expense.",
      "bankVisibility": "Statement dated 2025-06-27 shows Pocketsflow transfer of $2,033.00.",
      "priorYearPattern": null,
      "confidence": 0.80
    }
  ]
}

Provide a proposal entry for EVERY candidate (including SKIPs); do not omit any.`
}

function buildUserPrompt(
  candidates: Candidate[],
  priorMerchantHistory: Map<string, number>
): string {
  const lines = candidates.map((c) => {
    const key = (c.merchantNormalized ?? c.merchant).toUpperCase().slice(0, 60)
    const priorCount = priorMerchantHistory.get(key) ?? 0
    const priorTag = priorCount > 0 ? ` [PRIOR-YEAR-COUNT=${priorCount}]` : ""
    return `  ${c.id} | ${c.date} | ${c.merchant.slice(0, 60)} | ${fmtUSD(c.amount, { cents: true })} | current: ${c.currentCode}${c.currentLine ? ` (${c.currentLine})` : ""} tier${c.currentTier}${priorTag}`
  })

  return `Candidates (one decision per row, in same order):

${lines.join("\n")}

Return strict JSON only.`
}

function stripFences(text: string): string {
  return text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim()
}
