/**
 * Fee / interest guard rails shared by Merchant Intelligence and Residual agents.
 *
 * The IRS treats these classes of charges as personal regardless of how the AI
 * justifies them. Forcing them to PERSONAL at the invariant layer prevents
 * silent §163(h) violations and meaningless 0%-business meal classifications.
 *
 * Examples that motivated this:
 *  - "CASH ADVANCE INTEREST CHARGE" → §163(h) personal interest, never deductible
 *  - "LATE FEE" / "ANNUAL MEMBERSHIP FEE" → require active business-card substantiation
 *  - "MEALS_50 + businessPct=0" → internally inconsistent (it's a meal but not for business)
 */
import type { TransactionCode } from "@/app/generated/prisma/client"

const NONDEDUCTIBLE_FEE_PATTERNS: ReadonlyArray<RegExp> = [
  /CASH ADVANCE INTEREST/i,
  /\bINTEREST CHARGE\b/i,
  /\bLATE FEE\b/i,
  /\bANNUAL (?:MEMBERSHIP )?FEE\b/i,
  /\bFOREIGN TRANSACTION FEE\b/i,
  /\bOVERLIMIT FEE\b/i,
  /\bRETURNED PAYMENT(?:\s+FEE)?\b/i,
]

export function isNondeductibleFee(merchantKey: string): boolean {
  return NONDEDUCTIBLE_FEE_PATTERNS.some((p) => p.test(merchantKey))
}

export interface NormalizedClassification {
  code: TransactionCode
  scheduleCLine: string | null
  businessPct: number
  ircCitations: string[]
  evidenceTier: number
  reasoning: string
  requiresHumanInput: boolean
  humanQuestion: string | null
  confidence: number
}

/**
 * Apply universal "this is non-deductible no matter what the AI says" rules.
 * Returns the (possibly mutated) input. Callers should treat the return value
 * as authoritative.
 */
export function applyFeeGuards(
  rule: NormalizedClassification,
  merchantKey: string,
): NormalizedClassification {
  const r = { ...rule }

  // Personal interest / fees per §163(h) — always PERSONAL by default.
  if (isNondeductibleFee(merchantKey)) {
    r.code = "PERSONAL"
    r.scheduleCLine = null
    r.businessPct = 0
    r.ircCitations = ["§262", "§163(h)"]
    r.evidenceTier = 3
    r.confidence = Math.max(r.confidence, 0.95)
    r.requiresHumanInput = false
    r.humanQuestion = null
    r.reasoning = `${merchantKey}: card fee / personal interest — non-deductible per §163(h). If this is a dedicated business card and you can substantiate the use, override manually.`
    return r
  }

  // MEALS_* with businessPct=0 is an invalid state — demote to PERSONAL.
  if ((r.code === "MEALS_50" || r.code === "MEALS_100") && r.businessPct === 0) {
    r.code = "PERSONAL"
    r.scheduleCLine = null
    r.ircCitations = ["§262"]
    r.evidenceTier = 3
    r.requiresHumanInput = false
    r.humanQuestion = null
    r.reasoning = `${merchantKey}: meal merchant marked 0% business — demoted to PERSONAL since a 0%-business meal cannot be deducted.`
    return r
  }

  return r
}
