import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { PipelineClient } from "./pipeline-client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function PipelinePage({ params }: Props) {
  const { year: yearParam } = await params
  const session = await requireAuth()
  const userId = session.user!.id!

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
  })
  if (!taxYear) notFound()

  // --- Stats ---
  const totalTx = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isDuplicateOf: null },
  })

  const normalizedTx = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isDuplicateOf: null, merchantNormalized: { not: null } },
  })

  const transferPairs = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isTransferPairedWith: { not: null } },
  })

  const paymentPairs = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isPaymentPairedWith: { not: null } },
  })

  const refundPairs = await prisma.transaction.count({
    where: { taxYearId: taxYear.id, isRefundPairedWith: { not: null } },
  })

  const merchantRules = await prisma.merchantRule.count({
    where: { taxYearId: taxYear.id },
  })

  const classified = await prisma.classification.count({
    where: {
      transaction: { taxYearId: taxYear.id },
      isCurrent: true,
    },
  })

  const stops = await prisma.stopItem.count({
    where: { taxYearId: taxYear.id, state: "PENDING" },
  })

  return (
    <div className="max-w-3xl mx-auto py-8 px-4 space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Pipeline — {year}</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Run each phase in order. Each step is idempotent — safe to re-run.
        </p>
      </div>

      <PipelineClient
        year={year}
        initial={{
          totalTx,
          normalizedTx,
          transferPairs,
          paymentPairs,
          refundPairs,
          merchantRules,
          classified,
          stops,
        }}
      />
    </div>
  )
}
