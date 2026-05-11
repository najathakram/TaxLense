import { notFound } from "next/navigation"
import Link from "next/link"
import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { ReviewClient, type SerializedProposal, type SerializedAffected } from "./review-client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function ReviewPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  // Pull every stop that has a proposal — both PENDING (awaiting review)
  // and ANSWERED with autoApplied=true (auto-approved, available to override).
  const stops = await prisma.stopItem.findMany({
    where: {
      taxYearId: taxYear.id,
      aiProposal: { not: undefined },
    },
    include: { merchantRule: true },
    orderBy: [{ state: "asc" }, { answeredAt: "desc" }],
  })

  const allTxIds = stops.flatMap((s) => s.transactionIds)
  const txns = allTxIds.length
    ? await prisma.transaction.findMany({
        where: { id: { in: allTxIds } },
        include: { account: true },
      })
    : []
  const txById = new Map(txns.map((t) => [t.id, t]))

  const pending: SerializedProposal[] = []
  const autoApproved: SerializedProposal[] = []

  for (const s of stops) {
    const proposal = s.aiProposal as null | {
      answer?: unknown
      code?: string
      businessPct?: number
      scheduleCLine?: string | null
      confidence?: number
      reasoning?: string
      ircCitations?: string[]
      priorCases?: Array<{
        stopId: string
        merchantSnippet: string
        resolvedAs: { code: string; businessPct: number; scheduleCLine: string | null }
        resolvedAt: string
        similarity: number
        year: number
      }>
      generatedAt?: string
      autoApplied?: boolean
      citedPriorCaseId?: string | null
    }
    if (!proposal) continue

    const affected: SerializedAffected[] = s.transactionIds.flatMap((id) => {
      const t = txById.get(id)
      if (!t) return []
      return [{
        id: t.id,
        postedDate: t.postedDate.toISOString().slice(0, 10),
        accountNickname: t.account.nickname,
        merchantRaw: t.merchantRaw,
        amount: Number(t.amountNormalized.toString()),
      }]
    })

    const totalAmount = affected.reduce((sum, t) => sum + Math.abs(t.amount), 0)

    const row: SerializedProposal = {
      id: s.id,
      category: s.category,
      state: s.state,
      question: s.question,
      merchantKey: s.merchantRule?.merchantKey ?? affected[0]?.merchantRaw ?? "UNKNOWN",
      totalAmount,
      affected,
      proposal: {
        answer: proposal.answer as SerializedProposal["proposal"]["answer"],
        code: proposal.code ?? "?",
        businessPct: proposal.businessPct ?? 0,
        scheduleCLine: proposal.scheduleCLine ?? null,
        confidence: proposal.confidence ?? 0,
        reasoning: proposal.reasoning ?? "",
        ircCitations: proposal.ircCitations ?? [],
        priorCases: proposal.priorCases ?? [],
        generatedAt: proposal.generatedAt ?? null,
        autoApplied: proposal.autoApplied ?? false,
        citedPriorCaseId: proposal.citedPriorCaseId ?? null,
      },
    }

    if (s.state === "PENDING") pending.push(row)
    else if (s.state === "ANSWERED" && proposal.autoApplied) autoApproved.push(row)
  }

  return (
    <div className="max-w-5xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-baseline justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold">AI Proposals — {year}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Review the AI&apos;s recommendations before they touch the ledger. Anything ≥85% confidence was auto-approved (you can override below).
          </p>
        </div>
        <Link
          href={`/years/${year}/stops`}
          className="text-sm text-muted-foreground hover:text-foreground underline"
        >
          ← Back to stops queue
        </Link>
      </div>

      {pending.length === 0 && autoApproved.length === 0 ? (
        <div className="rounded border bg-muted/20 p-6 text-sm text-muted-foreground">
          No AI proposals on file yet. Run <strong>Generate AI recommendations</strong> from the
          stops page to create proposals for every pending stop.
        </div>
      ) : (
        <ReviewClient year={year} pending={pending} autoApproved={autoApproved} />
      )}
    </div>
  )
}
