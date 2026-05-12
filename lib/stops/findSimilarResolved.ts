/**
 * Prior-case retrieval for the review-first auto-resolve flow.
 *
 * For each PENDING stop, look up ANSWERED stops the same actor has resolved
 * before (their own data + any client they have access to via CpaClient) and
 * surface the closest matches. The AI gets these as in-context "experience"
 * so its proposal can cite real prior decisions rather than guessing in the
 * void: the difference between Sonnet returning NEEDS_CONTEXT 0.40 and
 * Vendor refund 0.92 for the same ambiguous "RETURN OF POSTED CHECK" string.
 *
 * Scope: cross-client × all years.
 *  - CLIENT-tier user: their own userId only.
 *  - CPA-tier user: their own userId PLUS every clientUserId in CpaClient.
 *  - ADMIN-as-CPA: same as CPA (the admin context already routes through CpaContext).
 *
 * Similarity (V1 — deterministic, no embeddings):
 *  - 1.00  identical merchantNormalized
 *  - 0.80  same first-word stem (≥4 chars)
 *  - 0.60  same regex pattern matched (REFUND/MARKETPLACE/WISE/etc.)
 *  - 0.40  fallback when one of the above conditions partially matches
 *  - +0.10 same account
 *  - +0.10 amount within 20%
 *
 * Returns top-N matches sorted by score (highest first). Caller is expected
 * to truncate to the AI's prior-case budget (≤5 per stop is plenty —
 * Sonnet's tendency is to anchor on the first 1-2).
 */

import { prisma } from "@/lib/db"
import type { StopItem, MerchantRule } from "@/app/generated/prisma/client"

export interface PriorCase {
  stopId: string
  /** Short human-readable snippet used in the AI prompt + UI. */
  merchantSnippet: string
  /** What the user actually picked. */
  resolvedAs: {
    code: string
    businessPct: number
    scheduleCLine: string | null
  }
  /** ISO timestamp of the answer. */
  resolvedAt: string
  /** Score in [0, 1.2] — see header for the breakdown. */
  similarity: number
  /** Year this prior case lives in (for display: "resolved in 2024"). */
  year: number
}

/**
 * Build the set of userIds whose prior resolutions are visible to the
 * actor. CPAs see their own data + every assigned client's data; plain
 * CLIENTs only see their own.
 */
export async function accessibleUserIds(actorUserId: string): Promise<string[]> {
  const ids = new Set<string>([actorUserId])
  const cpaClients = await prisma.cpaClient.findMany({
    where: { cpaUserId: actorUserId },
    select: { clientUserId: true },
  })
  for (const c of cpaClients) ids.add(c.clientUserId)
  return [...ids]
}

/**
 * Same regex patterns the heuristic in lib/stops/aiSuggestion.ts uses.
 * We share the taxonomy so "matches the same regex pattern" is a coherent
 * similarity signal across the codebase. Kept inline (not imported) to
 * avoid coupling — a future change to the heuristic should explicitly
 * decide whether the prior-case grouping should track.
 */
const PATTERN_REFUND = /refund|reversal|return/i
const PATTERN_MARKETPLACE = /ebay|stripe|paypal|square|pocketsflow|shopify|amazon\s*payments|etsy/i
const PATTERN_WISE = /wise|topup|top\s*up|trnwise|trans?fer\s+id/i
const PATTERN_APPLE_CASH = /apple\s*cash|venmo|cash\s*app/i
const PATTERN_PAYROLL = /pocketsflow|paychex|gusto/i

const PATTERNS: Array<{ name: string; rx: RegExp }> = [
  { name: "refund", rx: PATTERN_REFUND },
  { name: "marketplace", rx: PATTERN_MARKETPLACE },
  { name: "wise", rx: PATTERN_WISE },
  { name: "apple_cash", rx: PATTERN_APPLE_CASH },
  { name: "payroll", rx: PATTERN_PAYROLL },
]

function patternsFor(s: string): Set<string> {
  const out = new Set<string>()
  for (const p of PATTERNS) if (p.rx.test(s)) out.add(p.name)
  return out
}

function firstWordStem(s: string): string | null {
  const cleaned = s.replace(/[^a-zA-Z0-9 ]/g, " ").trim()
  if (!cleaned) return null
  const word = cleaned.split(/\s+/)[0] ?? ""
  return word.length >= 4 ? word.toLowerCase() : null
}

function signatureFor(stop: StopItem & { merchantRule: MerchantRule | null }): string {
  if (stop.merchantRule?.merchantKey) return stop.merchantRule.merchantKey
  const ctxMerchant =
    typeof (stop.context as Record<string, unknown> | null)?.["merchant"] === "string"
      ? ((stop.context as Record<string, unknown>)["merchant"] as string)
      : ""
  return ctxMerchant || stop.question || ""
}

function ctxAmount(stop: StopItem): number | null {
  const v = (stop.context as Record<string, unknown> | null)?.["totalAmount"]
  if (typeof v === "string") {
    const n = parseFloat(v)
    return Number.isFinite(n) ? Math.abs(n) : null
  }
  if (typeof v === "number") return Math.abs(v)
  return null
}

function ctxAccount(stop: StopItem): string | null {
  const v = (stop.context as Record<string, unknown> | null)?.["account"]
  return typeof v === "string" ? v : null
}

/**
 * Score a candidate prior case against a target signature. Inputs are
 * already normalized to the comparable form (signatures + patterns).
 */
function scoreCandidate(
  target: { sig: string; sigLower: string; firstStem: string | null; patterns: Set<string>; account: string | null; amount: number | null },
  candidate: { sig: string; sigLower: string; firstStem: string | null; patterns: Set<string>; account: string | null; amount: number | null },
): number {
  let s = 0
  if (target.sigLower && target.sigLower === candidate.sigLower) {
    s = 1.0
  } else if (target.firstStem && target.firstStem === candidate.firstStem) {
    s = 0.8
  } else {
    // Pattern overlap — count shared patterns.
    let shared = 0
    for (const p of target.patterns) if (candidate.patterns.has(p)) shared++
    if (shared > 0) s = Math.min(0.6 + 0.05 * (shared - 1), 0.7)
    else if (target.patterns.size === 0 && candidate.patterns.size === 0) {
      // No pattern signal on either side — token overlap as a weak fallback.
      const tTokens = new Set(target.sigLower.split(/\s+/).filter((t) => t.length >= 4))
      const cTokens = new Set(candidate.sigLower.split(/\s+/).filter((t) => t.length >= 4))
      let overlap = 0
      for (const t of tTokens) if (cTokens.has(t)) overlap++
      if (overlap > 0) s = Math.min(0.4 + 0.05 * overlap, 0.55)
    }
  }
  if (s === 0) return 0
  if (target.account && candidate.account && target.account === candidate.account) s += 0.1
  if (target.amount != null && candidate.amount != null) {
    const big = Math.max(target.amount, candidate.amount)
    const small = Math.min(target.amount, candidate.amount)
    if (big > 0 && small / big >= 0.8) s += 0.1
  }
  return s
}

/**
 * Look up the top-N most-similar ANSWERED stops the actor has visibility
 * into. Caller passes the candidate stop + the resolved actorUserId so the
 * scope is explicit (CLIENT vs CPA cross-client).
 *
 * The query loads up to PRELIMINARY_CAP candidate stops and scores them in
 * memory — for a CPA with thousands of historical stops this could grow,
 * so we cap. Future optimization: pg trigram index + ORDER BY similarity.
 */
const PRELIMINARY_CAP = 500

export async function findSimilarResolvedStops(
  actorUserId: string,
  candidateStop: StopItem & { merchantRule: MerchantRule | null },
  opts: { limit?: number; userIdScope?: string[]; excludeStopIds?: string[] } = {},
): Promise<PriorCase[]> {
  const limit = opts.limit ?? 5
  const userIds = opts.userIdScope ?? (await accessibleUserIds(actorUserId))
  if (userIds.length === 0) return []

  const sig = signatureFor(candidateStop)
  if (!sig) return []
  const target = {
    sig,
    sigLower: sig.toLowerCase(),
    firstStem: firstWordStem(sig),
    patterns: patternsFor(sig),
    account: ctxAccount(candidateStop),
    amount: ctxAmount(candidateStop),
  }

  // Pull candidate ANSWERED stops the actor can see, with their underlying
  // resolution. We look at the most-recent classification per stop's
  // transactions (ANSWERED stops always have one).
  const answered = await prisma.stopItem.findMany({
    where: {
      state: "ANSWERED",
      taxYear: { userId: { in: userIds } },
      ...(opts.excludeStopIds && opts.excludeStopIds.length > 0
        ? { id: { notIn: opts.excludeStopIds } }
        : {}),
      // Only look at ones with a usable signature — otherwise scoring is noise.
      OR: [
        { merchantRule: { isNot: null } },
        { context: { not: undefined } },
      ],
    },
    include: {
      merchantRule: true,
      taxYear: { select: { year: true } },
    },
    orderBy: { answeredAt: "desc" },
    take: PRELIMINARY_CAP,
  })

  const scored: Array<PriorCase & { _score: number }> = []
  for (const c of answered) {
    const candidateSig = signatureFor(c)
    if (!candidateSig) continue
    const candidate = {
      sig: candidateSig,
      sigLower: candidateSig.toLowerCase(),
      firstStem: firstWordStem(candidateSig),
      patterns: patternsFor(candidateSig),
      account: ctxAccount(c),
      amount: ctxAmount(c),
    }
    const score = scoreCandidate(target, candidate)
    if (score < 0.4) continue

    // Pull the canonical resolution by reading the user's userAnswer.
    // For autoApproved entries we still want to record what was applied.
    const ua = c.userAnswer as Record<string, unknown> | null
    const resolvedCode =
      typeof ua?.["code"] === "string"
        ? (ua["code"] as string)
        : c.merchantRule?.code ?? "?"
    const resolvedPct =
      typeof ua?.["businessPct"] === "number"
        ? (ua["businessPct"] as number)
        : c.merchantRule?.businessPctDefault ?? 0
    const resolvedLine =
      (typeof ua?.["scheduleCLine"] === "string" ? (ua["scheduleCLine"] as string) : null) ??
      c.merchantRule?.scheduleCLine ??
      null

    scored.push({
      stopId: c.id,
      merchantSnippet: candidateSig.slice(0, 60),
      resolvedAs: {
        code: resolvedCode,
        businessPct: resolvedPct,
        scheduleCLine: resolvedLine,
      },
      resolvedAt: c.answeredAt?.toISOString() ?? "",
      // Cap the displayed similarity at 1.0 — the internal score can reach
      // 1.2 (exact-match 1.0 + sameAccount 0.1 + sameAmount 0.1) which the
      // AI prompt and review UI then formatted as "similarity 1.1" or
      // "similarity 1.2", which reads as nonsense to a human ("greater than
      // 100% match"). The internal _score keeps the full value so the
      // sort still surfaces strong-signal matches above weak ones; only
      // the display number is clamped.
      similarity: Math.min(1.0, score),
      year: c.taxYear.year,
      _score: score,
    })
  }

  scored.sort((a, b) => b._score - a._score)
  return scored.slice(0, limit).map(({ _score: _ignored, ...rest }) => rest)
}
