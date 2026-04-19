import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { StopsClient, type SerializedStop, type SerializedAffected } from "./stops-client"

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
