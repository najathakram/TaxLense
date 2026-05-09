import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { StopsClient, type SerializedStop, type SerializedAffected, type AiSuggestion } from "./stops-client"
import type { MerchantRule, StopItem } from "@/app/generated/prisma/client"

/**
 * Translate the MerchantRule's persisted AI classification into a radio
 * choice the MerchantForm understands. Returns null when the rule's code
 * doesn't map cleanly (NEEDS_CONTEXT, GRAY, BIZ_INCOME, PAYMENT, TRANSFER) —
 * those genuinely need user input and we don't want to nudge the user into
 * a bad pre-selection. Only MERCHANT-category stops are processed; DEPOSIT
 * / TRANSFER / §274(d) stops never carry a useful MerchantRule hint and
 * fall through to "no default" so the user must pick explicitly.
 */
function deriveMerchantAiSuggestion(
  stop: StopItem & { merchantRule: MerchantRule | null },
): AiSuggestion | null {
  if (stop.category !== "MERCHANT") return null
  const rule = stop.merchantRule
  if (!rule) return null
  let choice: "ALL_BUSINESS" | "DURING_TRIPS" | "MIXED_50" | "PERSONAL" | null = null
  switch (rule.code) {
    case "WRITE_OFF":
    case "WRITE_OFF_COGS":
    case "MEALS_50":
    case "MEALS_100":
      if (rule.businessPctDefault >= 90) choice = "ALL_BUSINESS"
      else if (rule.businessPctDefault > 0) choice = "MIXED_50"
      break
    case "WRITE_OFF_TRAVEL":
      choice = "DURING_TRIPS"
      break
    case "PERSONAL":
      choice = "PERSONAL"
      break
    default:
      return null
  }
  if (!choice) return null
  return {
    kind: "merchant",
    choice,
    confidence: rule.confidence,
    reasoning: rule.reasoning ?? null,
    scheduleCLine: rule.scheduleCLine ?? null,
  }
}

interface Props {
  params: Promise<{ year: string }>
}

export default async function StopsPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  const stops = await prisma.stopItem.findMany({
    where: { taxYearId: taxYear.id },
    include: { merchantRule: true },
    orderBy: { answeredAt: "asc" },
  })

  // Gather affected transactions keyed by stop id
  const allIds = stops.flatMap((s) => s.transactionIds)
  const txns = allIds.length
    ? await prisma.transaction.findMany({
        where: { id: { in: allIds } },
        include: { account: true },
      })
    : []
  const txById = new Map(txns.map((t) => [t.id, t]))

  const serialized: SerializedStop[] = stops.map((s) => {
    const affected: SerializedAffected[] = s.transactionIds.flatMap((id) => {
      const t = txById.get(id)
      if (!t) return []
      return [
        {
          id: t.id,
          postedDate: t.postedDate.toISOString().slice(0, 10),
          accountNickname: t.account.nickname,
          merchantRaw: t.merchantRaw,
          amount: Number(t.amountNormalized.toString()),
        },
      ]
    })

    // Map the MerchantRule's existing AI classification onto the form's
    // radio choice so MERCHANT stops open with the AI's best guess
    // pre-selected (the rule was set by Merchant Intelligence; we just
    // surface it instead of always defaulting to "ALL_BUSINESS"). The AI
    // suggestion line above the form lets the user accept or override in
    // one click — that addresses the "no default suggestion per stop"
    // complaint without requiring a per-page-load AI call.
    const aiSuggestion = deriveMerchantAiSuggestion(s)

    return {
      id: s.id,
      category: s.category,
      state: s.state,
      question: s.question,
      context: s.context as Record<string, unknown>,
      merchantRuleId: s.merchantRuleId,
      merchantKey: s.merchantRule?.merchantKey ?? null,
      totalAmount: affected.reduce((sum, t) => sum + Math.abs(t.amount), 0),
      affected,
      aiSuggestion,
      // Prior answer + answered timestamp drive the "Edit answer" UI on
      // ANSWERED cards. userAnswer is JSON; the client tries to coerce it
      // to a StopAnswer for prefill, falling back to defaults if it can't
      // (e.g. AI auto-resolved stops carry {autoResolved: true, ...}).
      userAnswer: (s.userAnswer ?? null) as Record<string, unknown> | null,
      answeredAt: s.answeredAt ? s.answeredAt.toISOString() : null,
    }
  })

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">STOPs — {year}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Answer each item to promote its classification. Answers persist as new Classification rows — prior ones remain in history.
        </p>
      </div>
      <StopsClient year={year} stops={serialized} />
    </div>
  )
}
