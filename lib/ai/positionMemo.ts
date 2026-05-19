/**
 * Position Memo Generator — spec §10.3 / principle 6.
 *
 * Four memo types: §183 hobby-loss, §274(n)(2) 100%-meals, §280A home office, wardrobe.
 * Model: claude-sonnet-4-6 when exposure <$5K; claude-opus-4-7 when ≥$5K.
 * Citations: pulled exclusively from memoRules.ts — never AI-generated.
 * Output: plain text with FACTS / LAW / ANALYSIS / CONCLUSION sections.
 */

import Anthropic from "@anthropic-ai/sdk"
import { prisma } from "@/lib/db"
import { getMemoRule, type MemoType } from "@/lib/rules/memoRules"
import type { TransactionCode } from "@/app/generated/prisma/client"
import { fmtUSD } from "@/lib/format/currency"

const client = new Anthropic()

const DEDUCTIBLE_CODES: TransactionCode[] = [
  "WRITE_OFF",
  "WRITE_OFF_TRAVEL",
  "WRITE_OFF_COGS",
  "MEALS_50",
  "MEALS_100",
  "GRAY",
]

function deductibleAmt(amountNormalized: number, code: TransactionCode, bizPct: number): number {
  const outflow = Math.max(0, amountNormalized)
  let ded = outflow * (bizPct / 100)
  if (code === "MEALS_50") ded *= 0.5
  return ded
}

// ── Fact gatherers per memo type ─────────────────────────────────────────────

async function gather183Facts(taxYearId: string): Promise<{ facts: string; exposure: number }> {
  const [profile, allYears] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { taxYearId } }),
    prisma.taxYear.findMany({
      where: { userId: (await prisma.taxYear.findUniqueOrThrow({ where: { id: taxYearId } })).userId },
      orderBy: { year: "desc" },
      take: 5,
    }),
  ])

  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })

  let grossRevenue = 0
  let totalDeductions = 0
  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    if (c.code === "BIZ_INCOME") grossRevenue += Math.abs(Number(t.amountNormalized))
    if (DEDUCTIBLE_CODES.includes(c.code)) totalDeductions += deductibleAmt(Number(t.amountNormalized), c.code, c.businessPct)
  }
  const netLoss = totalDeductions - grossRevenue

  const currentYear = allYears[0]
  const facts = [
    `NAICS Code: ${profile?.naicsCode ?? "Not specified"}`,
    `Business Description: ${profile?.businessDescription ?? "Not specified"}`,
    `Tax Year: ${currentYear?.year}`,
    `Gross Receipts: ${fmtUSD(grossRevenue, { cents: true })}`,
    `Total Deductions: ${fmtUSD(totalDeductions, { cents: true })}`,
    `Net Loss: ${fmtUSD(Math.max(0, netLoss), { cents: true })}`,
    `Number of tax years with data: ${allYears.length}`,
    `First year in business: ${profile?.firstYear ? "Yes" : "No"}`,
    `Revenue streams: ${profile?.revenueStreams?.join(", ") ?? "Not specified"}`,
  ].join("\n")

  return { facts, exposure: Math.max(0, netLoss) }
}

async function gather274n2Facts(taxYearId: string): Promise<{ facts: string; exposure: number }> {
  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })

  const meals100 = txns.filter((t) => t.classifications[0]?.code === "MEALS_100")
  let totalMeals100 = 0
  const mealDetails: string[] = []

  for (const t of meals100) {
    const c = t.classifications[0]!
    const amt = deductibleAmt(Number(t.amountNormalized), c.code, c.businessPct)
    totalMeals100 += amt
    const sub = c.substantiation as { attendees?: string; purpose?: string } | null
    mealDetails.push(
      `  ${t.postedDate.toISOString().slice(0, 10)} | ${t.merchantRaw} | ${fmtUSD(Number(t.amountNormalized), { cents: true })} | attendees: ${sub?.attendees ?? "?"} | purpose: ${sub?.purpose ?? "?"}`
    )
  }

  const facts = [
    `Number of MEALS_100 transactions: ${meals100.length}`,
    `Total 100%-deductible meals claimed: ${fmtUSD(totalMeals100, { cents: true })}`,
    `Additional 50% amount preserved vs MEALS_50: ${fmtUSD(totalMeals100 * 0.5, { cents: true })}`,
    "Meal transactions:",
    ...mealDetails,
  ].join("\n")

  // Exposure = the additional 50% that would be disallowed if exception doesn't hold
  return { facts, exposure: totalMeals100 * 0.5 }
}

async function gather280AFacts(taxYearId: string): Promise<{ facts: string; exposure: number }> {
  const profile = await prisma.businessProfile.findUnique({ where: { taxYearId } })
  const ho = (profile?.homeOfficeConfig as { has?: boolean; method?: string; officeSqft?: number; homeSqft?: number } | null) ?? null

  const sqft = ho?.officeSqft ?? 0
  const homeSqft = ho?.homeSqft ?? 0
  const method = ho?.method ?? "SIMPLIFIED"
  const deduction = method === "SIMPLIFIED" ? Math.min(300, sqft) * 5 : 0

  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })
  let grossRevenue = 0
  for (const t of txns) {
    if (t.classifications[0]?.code === "BIZ_INCOME") {
      grossRevenue += Math.abs(Number(t.amountNormalized))
    }
  }

  const facts = [
    `Home Office Present: ${ho?.has ? "Yes" : "No"}`,
    `Method: ${method}`,
    `Office Square Footage: ${sqft} sqft`,
    `Total Home Square Footage: ${homeSqft} sqft`,
    `Business Use %: ${homeSqft > 0 ? ((sqft / homeSqft) * 100).toFixed(1) : "N/A"}%`,
    `Estimated Deduction: ${fmtUSD(deduction, { cents: true })}`,
    `Gross Receipts (income limitation check): ${fmtUSD(grossRevenue, { cents: true })}`,
    `Business Description: ${profile?.businessDescription ?? "Not specified"}`,
    `Revenue Streams: ${profile?.revenueStreams?.join(", ") ?? "Not specified"}`,
  ].join("\n")

  return { facts, exposure: deduction }
}

async function gather162CohanFacts(taxYearId: string): Promise<{ facts: string; exposure: number }> {
  const [profile, taxYear] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { taxYearId } }),
    prisma.taxYear.findUnique({ where: { id: taxYearId }, select: { year: true, userId: true } }),
  ])

  const txns = await prisma.transaction.findMany({
    where: { taxYearId, isSplit: false, isStale: false },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })

  // PriorYearContext gives us "this merchant was claimed last year too" continuity.
  const priorYearContext = await prisma.priorYearContext.findUnique({
    where: { taxYearId },
    select: { sourceLockedHash: true, sourcePriorYearId: true },
  })

  let totalCohanExposure = 0
  let totalCohanCount = 0
  const cohanByCode = new Map<string, { count: number; total: number }>()
  const cohanByLine = new Map<string, { count: number; total: number }>()
  const topClaims: Array<{ date: string; merchant: string; amount: number; code: string; line: string | null; reasoning: string }> = []

  for (const t of txns) {
    const c = t.classifications[0]
    if (!c || !c.cohanFlag) continue
    if (!DEDUCTIBLE_CODES.includes(c.code)) continue

    // Hard rail check at the gather stage too — never include §274(d) rows
    // even if cohanFlag was somehow set (defense in depth; the upstream
    // assertNot274dCohan should have rejected the write).
    const cites = c.ircCitations ?? []
    if (cites.some((cite) => cite.includes("§274(d)"))) continue
    if (c.code === "MEALS_50" || c.code === "MEALS_100" || c.code === "WRITE_OFF_TRAVEL") continue

    const ded = deductibleAmt(Number(t.amountNormalized), c.code, c.businessPct)
    totalCohanExposure += ded
    totalCohanCount++

    const byCode = cohanByCode.get(c.code) ?? { count: 0, total: 0 }
    byCode.count++
    byCode.total += ded
    cohanByCode.set(c.code, byCode)

    if (c.scheduleCLine) {
      const byLine = cohanByLine.get(c.scheduleCLine) ?? { count: 0, total: 0 }
      byLine.count++
      byLine.total += ded
      cohanByLine.set(c.scheduleCLine, byLine)
    }

    topClaims.push({
      date: t.postedDate.toISOString().slice(0, 10),
      merchant: t.merchantRaw,
      amount: ded,
      code: c.code,
      line: c.scheduleCLine,
      reasoning: (c.reasoning ?? "").slice(0, 200),
    })
  }

  topClaims.sort((a, b) => b.amount - a.amount)
  const top10 = topClaims.slice(0, 10)

  const codeBreakdown = Array.from(cohanByCode.entries())
    .map(([code, v]) => `  ${code}: ${v.count} txns, ${fmtUSD(v.total, { cents: true })}`)
    .join("\n")

  const lineBreakdown = Array.from(cohanByLine.entries())
    .map(([line, v]) => `  ${line}: ${v.count} txns, ${fmtUSD(v.total, { cents: true })}`)
    .join("\n")

  const facts = [
    `NAICS Code: ${profile?.naicsCode ?? "Not specified"}`,
    `Business Description: ${profile?.businessDescription ?? "Not specified"}`,
    `Tax Year: ${taxYear?.year ?? "Unknown"}`,
    `Prior locked year available: ${priorYearContext?.sourceLockedHash ? "Yes" : "No"}`,
    "",
    `Aggregate Cohan-flagged classifications: ${totalCohanCount} transactions`,
    `Aggregate Cohan-flagged deductible amount: ${fmtUSD(totalCohanExposure, { cents: true })}`,
    "",
    "Breakdown by classification code:",
    codeBreakdown || "  (none)",
    "",
    "Breakdown by Schedule C line:",
    lineBreakdown || "  (none)",
    "",
    "Top-10 Cohan-flagged claims:",
    ...top10.map(
      (c, i) =>
        `  ${i + 1}. ${c.date} | ${c.merchant} | ${fmtUSD(c.amount, { cents: true })} | ${c.code}${c.line ? ` → ${c.line}` : ""}`
    ),
    "",
    "Affirmative exclusion (hard §274(d) rail):",
    "  No MEALS_50, MEALS_100, WRITE_OFF_TRAVEL, vehicle, gifts, or listed-property claims are",
    "  included in this Cohan reconstruction. Those categories require contemporaneous substantiation",
    "  under §274(d) and were demoted to PERSONAL when contemporaneous records were unavailable.",
  ].join("\n")

  return { facts, exposure: totalCohanExposure }
}

async function gatherWardrobeFacts(taxYearId: string): Promise<{ facts: string; exposure: number }> {
  const profile = await prisma.businessProfile.findUnique({ where: { taxYearId } })

  // Identify wardrobe-related transactions by looking at reasoning or merchantRaw keywords
  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isStale: false,
      merchantRaw: { contains: "cloth", mode: "insensitive" },
    },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })

  const txns2 = await prisma.transaction.findMany({
    where: {
      taxYearId,
      isSplit: false,
      isStale: false,
      classifications: { some: { isCurrent: true, reasoning: { contains: "wardrobe", mode: "insensitive" } } },
    },
    include: { classifications: { where: { isCurrent: true }, take: 1 } },
  })

  const combined = [...new Map([...txns, ...txns2].map((t) => [t.id, t])).values()]
  const deductibleWardrobe = combined.filter((t) => {
    const c = t.classifications[0]
    return c && DEDUCTIBLE_CODES.includes(c.code)
  })

  let totalExposure = 0
  const details: string[] = []
  for (const t of deductibleWardrobe) {
    const c = t.classifications[0]!
    const amt = deductibleAmt(Number(t.amountNormalized), c.code, c.businessPct)
    totalExposure += amt
    details.push(`  ${t.postedDate.toISOString().slice(0, 10)} | ${t.merchantRaw} | ${fmtUSD(Number(t.amountNormalized), { cents: true })}`)
  }

  const facts = [
    `NAICS Code: ${profile?.naicsCode ?? "Not specified"}`,
    `Business Description: ${profile?.businessDescription ?? "Not specified"}`,
    `Wardrobe-related transactions identified: ${deductibleWardrobe.length}`,
    `Total wardrobe deductions claimed: ${fmtUSD(totalExposure, { cents: true })}`,
    "Transactions:",
    ...details,
  ].join("\n")

  return { facts, exposure: totalExposure }
}

// ── Memo detector ────────────────────────────────────────────────────────────

export async function detectNeededMemos(taxYearId: string): Promise<MemoType[]> {
  const needed: MemoType[] = []

  const [profile, txns] = await Promise.all([
    prisma.businessProfile.findUnique({ where: { taxYearId } }),
    prisma.transaction.findMany({
      where: { taxYearId, isSplit: false },
      include: { classifications: { where: { isCurrent: true }, take: 1 } },
    }),
  ])

  let grossRevenue = 0
  let totalDeductions = 0
  let hasMeals100 = false
  let cohanCount = 0
  let cohanExposure = 0

  for (const t of txns) {
    const c = t.classifications[0]
    if (!c) continue
    if (c.code === "BIZ_INCOME") grossRevenue += Math.abs(Number(t.amountNormalized))
    if (DEDUCTIBLE_CODES.includes(c.code)) totalDeductions += deductibleAmt(Number(t.amountNormalized), c.code, c.businessPct)
    if (c.code === "MEALS_100") hasMeals100 = true
    if (c.cohanFlag && DEDUCTIBLE_CODES.includes(c.code)) {
      cohanCount++
      cohanExposure += deductibleAmt(Number(t.amountNormalized), c.code, c.businessPct)
    }
  }

  // §183: loss year
  if (totalDeductions > grossRevenue) needed.push("§183_hobby")

  // §274(n)(2): 100% meals claimed
  if (hasMeals100) needed.push("§274n2_100pct_meals")

  // §280A: home office
  const ho = profile?.homeOfficeConfig as { has?: boolean } | null
  if (ho?.has) needed.push("§280A_home_office")

  // Wardrobe: NAICS 711510 (performing arts) — opt-in
  if (profile?.naicsCode?.startsWith("7115")) needed.push("wardrobe")

  // §162 Cohan sweep — auto-trigger when explicit cohanFlag count or exposure
  // crosses defense-memo thresholds. Either signal alone is enough.
  if (cohanCount >= 10 || cohanExposure >= 2500) needed.push("§162_cohan_sweep")

  return needed
}

// ── Core generator ────────────────────────────────────────────────────────────

export async function generatePositionMemo(
  type: MemoType,
  taxYearId: string
): Promise<{ text: string; exposure: number; modelUsed: string }> {
  const rule = getMemoRule(type)

  let facts: string
  let exposure: number

  switch (type) {
    case "§183_hobby":
      ;({ facts, exposure } = await gather183Facts(taxYearId))
      break
    case "§274n2_100pct_meals":
      ;({ facts, exposure } = await gather274n2Facts(taxYearId))
      break
    case "§280A_home_office":
      ;({ facts, exposure } = await gather280AFacts(taxYearId))
      break
    case "wardrobe":
      ;({ facts, exposure } = await gatherWardrobeFacts(taxYearId))
      break
    case "§162_cohan_sweep":
      ;({ facts, exposure } = await gather162CohanFacts(taxYearId))
      break
  }

  const model = exposure >= 5000 ? "claude-opus-4-7" : "claude-sonnet-4-6"

  const systemPrompt = `You are a CPA drafting a tax position memo for audit defense purposes.

Produce a memo with EXACTLY these four labeled sections (each label on its own line followed by a blank line):

FACTS:

LAW:

ANALYSIS:

CONCLUSION:

Rules you MUST follow:
1. Use ONLY the following IRC citations. Do not invent citations. If you need a citation not in this list, write [VERIFY].
   Permitted citations:
   ${rule.ircCitations.map((c) => `   - ${c}`).join("\n")}
2. Do not fabricate meeting attendees, client names, or business purposes.
3. The conclusion must be defensible — prefer the better-documented position over the largest deduction.
4. Write in a professional CPA tone, suitable for submission to an IRS agent.
5. Keep the memo under 600 words.`

  const userPrompt = `Write a ${rule.title} for the following taxpayer facts.

TAXPAYER FACTS:
${facts}

FACT CHECKPOINTS TO ADDRESS:
${rule.factCheckpoints.map((f, i) => `${i + 1}. ${f}`).join("\n")}

Memo type: ${type}`

  const response = await client.messages.create({
    model,
    max_tokens: 2048,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  })

  const textBlocks = response.content.filter((b) => b.type === "text")
  let text = textBlocks.map((b) => (b as { text: string }).text).join("\n")

  // Verify all four sections are present; if not, add stubs
  const requiredSections = ["FACTS:", "LAW:", "ANALYSIS:", "CONCLUSION:"]
  for (const section of requiredSections) {
    if (!text.includes(section)) {
      text += `\n\n${section}\n[Section not generated — review required]`
    }
  }

  await prisma.auditEvent.create({
    data: {
      actorType: "AI",
      eventType: "POSITION_MEMO_GENERATED",
      entityType: "TaxYear",
      entityId: taxYearId,
      afterState: { type, model, exposure, textLength: text.length },
    },
  })

  return { text, exposure, modelUsed: model }
}

// ── Batch generator ───────────────────────────────────────────────────────────

export async function generateAllPositionMemos(
  taxYearId: string
): Promise<Map<MemoType, { text: string; exposure: number; modelUsed: string }>> {
  const needed = await detectNeededMemos(taxYearId)
  const results = new Map<MemoType, { text: string; exposure: number; modelUsed: string }>()

  for (const type of needed) {
    const result = await generatePositionMemo(type, taxYearId)
    results.set(type, result)
  }

  return results
}
