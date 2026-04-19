import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { LedgerClient, type LedgerRow } from "./ledger-client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function LedgerPage({ params }: Props) {
  const { year: yearParam } = await params
  const session = await requireAuth()
  const userId = session.user!.id!
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  const txns = await prisma.transaction.findMany({
    where: {
      taxYearId: taxYear.id,
      isSplit: false,
      isDuplicateOf: null,
    },
    include: {
      account: true,
      classifications: { where: { isCurrent: true }, take: 1 },
    },
    orderBy: { postedDate: "asc" },
  })

  const rows: LedgerRow[] = txns.map((t) => {
    const c = t.classifications[0]
    const amount = Number(t.amountNormalized.toString())
    return {
      id: t.id,
      date: t.postedDate.toISOString().slice(0, 10),
      accountId: t.accountId,
      accountNickname: t.account.nickname,
      merchantRaw: t.merchantRaw,
      merchantNormalized: t.merchantNormalized,
      amount,
      code: c?.code ?? "NEEDS_CONTEXT",
      scheduleCLine: c?.scheduleCLine ?? null,
      businessPct: c?.businessPct ?? 0,
      deductibleAmt:
        c && c.code !== "PERSONAL" && c.code !== "TRANSFER" && c.code !== "PAYMENT"
          ? Math.abs(amount) * (c.businessPct / 100)
          : 0,
      evidenceTier: c?.evidenceTier ?? 3,
      confidence: c?.confidence ?? 0,
      isUserConfirmed: c?.source === "AI_USER_CONFIRMED" || c?.source === "USER",
      reasoning: c?.reasoning ?? "",
      isChildOfSplit: !!t.splitOfId,
    }
  })

  const accounts = Array.from(
    new Map(rows.map((r) => [r.accountId, { id: r.accountId, nickname: r.accountNickname }])).values()
  )

  return (
    <div className="max-w-[95vw] mx-auto py-6 px-4 space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Ledger — {year}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          {rows.length} transactions · inline-edit or use the bulk bar below · changes append new
          Classification rows.
        </p>
      </div>
      <LedgerClient year={year} rows={rows} accounts={accounts} />
    </div>
  )
}
