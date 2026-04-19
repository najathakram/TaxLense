/**
 * Contextual upload prompts (Session 9 §A.4).
 *
 * Given a freshly-imported StatementImport, produce a list of prompts for the
 * user to answer. These do NOT call the AI — they're structured questions
 * the UI renders inline. User answers are stored in StatementImport.userNotes
 * and later aggregated into the Merchant Intelligence system prompt.
 */

import type { StatementImport, Transaction } from "@/app/generated/prisma/client"

export type ContextualPromptKind =
  | "institution_confirmation"
  | "account_purpose"
  | "period_gap"
  | "unusual_deposit"

export interface ContextualPrompt {
  kind: ContextualPromptKind
  question: string
  context: Record<string, unknown>
}

interface BuildPromptsArgs {
  imp: Pick<
    StatementImport,
    "id" | "institution" | "parseConfidence" | "periodStart" | "periodEnd" | "accountId"
  >
  transactions: Pick<Transaction, "postedDate" | "amountNormalized" | "merchantRaw">[]
  /** Other imports for the same account so we can detect period gaps. */
  priorImportsForAccount: Pick<StatementImport, "periodStart" | "periodEnd">[]
  /** Whether this is the first time the account appears in this session. */
  firstSightingOfAccount: boolean
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0
  const sorted = [...nums].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

export function buildContextualPrompts(args: BuildPromptsArgs): ContextualPrompt[] {
  const prompts: ContextualPrompt[] = []

  // 1. Institution confirmation — when detection confidence < 0.9 or missing
  if (!args.imp.institution || (args.imp.parseConfidence ?? 0) < 0.9) {
    prompts.push({
      kind: "institution_confirmation",
      question: args.imp.institution
        ? `We think this statement is from "${args.imp.institution}". Is that correct?`
        : "We could not identify the institution. Which bank or card issued this statement?",
      context: {
        importId: args.imp.id,
        detected: args.imp.institution ?? null,
        confidence: args.imp.parseConfidence ?? null,
      },
    })
  }

  // 2. Account purpose — only on the first upload for this account in the session
  if (args.firstSightingOfAccount) {
    prompts.push({
      kind: "account_purpose",
      question: "Is this account used primarily for business, personal, or mixed?",
      context: { importId: args.imp.id, accountId: args.imp.accountId },
    })
  }

  // 3. Period gap — detect gaps vs prior imports for this account
  if (args.imp.periodStart && args.priorImportsForAccount.length > 0) {
    const prior = args.priorImportsForAccount
      .map((p) => p.periodEnd)
      .filter((d): d is Date => d != null)
      .sort((a, b) => b.getTime() - a.getTime())
    const lastEnd = prior[0]
    if (lastEnd) {
      const gapDays =
        (args.imp.periodStart.getTime() - lastEnd.getTime()) / (1000 * 60 * 60 * 24)
      if (gapDays > 7) {
        prompts.push({
          kind: "period_gap",
          question: `There is a ${Math.round(
            gapDays,
          )}-day gap between the previous statement ending ${lastEnd
            .toISOString()
            .slice(0, 10)} and this one starting ${args.imp.periodStart
            .toISOString()
            .slice(0, 10)}. Was the account inactive during that period, or is a statement missing?`,
          context: {
            importId: args.imp.id,
            gapDays: Math.round(gapDays),
            previousPeriodEnd: lastEnd.toISOString().slice(0, 10),
            thisPeriodStart: args.imp.periodStart.toISOString().slice(0, 10),
          },
        })
      }
    }
  }

  // 4. Unusual deposits — any single inflow > max(2× median, $1000)
  const inflows = args.transactions
    .filter((t) => Number(t.amountNormalized) < 0)
    .map((t) => Math.abs(Number(t.amountNormalized)))
  if (inflows.length >= 3) {
    const medianInflow = median(inflows)
    const threshold = Math.max(1000, medianInflow * 2)
    for (const t of args.transactions) {
      const n = Number(t.amountNormalized)
      if (n < 0 && Math.abs(n) >= threshold) {
        prompts.push({
          kind: "unusual_deposit",
          question: `An inflow of $${Math.abs(n).toFixed(2)} on ${t.postedDate
            .toISOString()
            .slice(0, 10)} from "${t.merchantRaw}" is unusually large. Where did it come from?`,
          context: {
            importId: args.imp.id,
            amount: Math.abs(n),
            date: t.postedDate.toISOString().slice(0, 10),
            merchantRaw: t.merchantRaw,
          },
        })
      }
    }
  }

  return prompts
}
