import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { StopsClient, type SerializedStop, type SerializedAffected } from "./stops-client"
import { deriveAiSuggestion } from "@/lib/stops/aiSuggestion"
import { deriveStopsFromAssertions } from "@/lib/stops/deriveFromAssertions"

interface Props {
  params: Promise<{ year: string }>
  searchParams?: Promise<{ cat?: string }>
}

export default async function StopsPage({ params, searchParams }: Props) {
  const { year: yearParam } = await params
  const sp = (await searchParams) ?? {}
  const initialCategory = sp.cat ?? null
  const userId = await getCurrentUserId()

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  // B-07: deterministically materialize DEPOSIT + §274(d) STOPs from
  // assertion failures on every page load. Idempotent (won't duplicate
  // existing rows) and runs in <100ms for typical years. Without this, the
  // Risk page's "Resolve via STOPs before lock" CTA could land the user on
  // an empty page if the autonomous CPA agent hadn't yet run.
  await deriveStopsFromAssertions(taxYear.id)

  // Surface the LATEST AUTO_RESOLVE_STOPS / GENERATE_AI_PROPOSALS run result
  // so the user has a persistent record of what happened last time they hit
  // the AI button. The transient floating-progress chip disappears on
  // reload — without this panel, the user comes back the next day, sees no
  // progress, and has no way to find out why.
  const lastAutoRun = await prisma.pipelineRun.findFirst({
    where: {
      taxYearId: taxYear.id,
      kind: { in: ["AUTO_RESOLVE_STOPS", "GENERATE_AI_PROPOSALS"] },
    },
    orderBy: { startedAt: "desc" },
    select: {
      id: true,
      kind: true,
      status: true,
      startedAt: true,
      finishedAt: true,
      result: true,
      lastError: true,
    },
  })

  // Count pending AI proposals so we can show a banner directing the CPA
  // to /review whenever proposals are waiting (e.g. they navigated away
  // before approving, or just landed back on the page after an earlier
  // generation run).
  const pendingProposalsCount = await prisma.stopItem.count({
    where: {
      taxYearId: taxYear.id,
      state: "PENDING",
      aiProposal: { not: undefined },
    },
  })
  // Normalize the last-run result to a single shape regardless of which kind
  // of pipeline run produced it. AUTO_RESOLVE_STOPS returns
  // {resolved, skipped, errors, skipBreakdown, details}. The newer
  // GENERATE_AI_PROPOSALS returns {generated, autoApplied, pendingReview,
  // withPriorCaseContext, errors, dropReasons}. The persistent panel needs
  // a single contract — we map both into a common form here so the client
  // doesn't have to branch on kind.
  const lastAutoSummary = lastAutoRun
    ? (() => {
        const raw = lastAutoRun.result as Record<string, unknown> | null
        const isProposalRun = lastAutoRun.kind === "GENERATE_AI_PROPOSALS"
        // Choose the right primary counters per kind.
        const resolved = isProposalRun
          ? (raw?.["autoApplied"] as number | undefined) ?? 0
          : (raw?.["resolved"] as number | undefined) ?? 0
        const skipped = isProposalRun
          ? (raw?.["pendingReview"] as number | undefined) ?? 0
          : (raw?.["skipped"] as number | undefined) ?? 0
        const errors = (raw?.["errors"] as number | undefined) ?? 0
        // skipBreakdown — autoResolveStops emits a {reason: count} map;
        // generateAiProposals emits a {stopId: reason} map (dropReasons),
        // so we invert that for display.
        let skipBreakdown: Record<string, number> | undefined
        if (isProposalRun) {
          const drops = raw?.["dropReasons"] as Record<string, string> | undefined
          if (drops && typeof drops === "object") {
            skipBreakdown = {}
            for (const reason of Object.values(drops)) {
              skipBreakdown[reason] = (skipBreakdown[reason] ?? 0) + 1
            }
            // Also surface the prior-case coverage as a breakdown chip.
            const withCtx = raw?.["withPriorCaseContext"] as number | undefined
            const generated = raw?.["generated"] as number | undefined
            if (withCtx != null && generated != null && generated > 0) {
              skipBreakdown[`${withCtx}/${generated} with prior cases`] = 0
            }
          }
        } else {
          skipBreakdown = raw?.["skipBreakdown"] as Record<string, number> | undefined
        }
        // Detail rows are autoResolveStops-only — proposals don't carry
        // them in the same shape (the per-stop info lives on
        // StopItem.aiProposal instead, and the /review page renders it).
        const details = isProposalRun
          ? undefined
          : (raw?.["details"] as Array<{ merchantKey: string; code: string; confidence: number; status: string; reason?: string }> | undefined)

        return {
          kind: lastAutoRun.kind as "AUTO_RESOLVE_STOPS" | "GENERATE_AI_PROPOSALS",
          status: lastAutoRun.status,
          startedAt: lastAutoRun.startedAt.toISOString(),
          finishedAt: lastAutoRun.finishedAt?.toISOString() ?? null,
          result: {
            resolved,
            skipped,
            errors,
            skipBreakdown,
            details,
          },
          lastError: lastAutoRun.lastError,
        }
      })()
    : null

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

    // Pre-select the AI's best guess on every category we can. Source
    // priority: persisted aiSuggestion (written by autoResolveStops below
    // threshold or by deriveStopsFromAssertions) > MerchantRule mapping >
    // heuristic patterns (Wise top-up → LOAN, Stripe payout → CLIENT,
    // Apple Cash → PERSONAL, etc). This addresses the "no default
    // suggestion per STOP" complaint without burning a Sonnet call on
    // every page render.
    const aiSuggestion = deriveAiSuggestion(s)

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
      <StopsClient
        year={year}
        stops={serialized}
        initialCategory={initialCategory}
        lastAutoSummary={lastAutoSummary}
        pendingProposalsCount={pendingProposalsCount}
      />
    </div>
  )
}
