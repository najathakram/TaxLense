import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { UploadClient } from "./upload-client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function UploadPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()

  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: {
      id: true,
      year: true,
      status: true,
      financialAccounts: {
        select: {
          id: true,
          institution: true,
          nickname: true,
          mask: true,
          type: true,
          isPrimaryBusiness: true,
          statementImports: {
            select: {
              id: true,
              originalFilename: true,
              fileType: true,
              institution: true,
              parseStatus: true,
              parseConfidence: true,
              transactionCount: true,
              totalInflows: true,
              totalOutflows: true,
              reconciliationOk: true,
              reconciliationDelta: true,
              parseError: true,
              uploadedAt: true,
              periodStart: true,
              periodEnd: true,
            },
            orderBy: { uploadedAt: "desc" },
          },
        },
        orderBy: { institution: "asc" },
      },
    },
  })

  if (!taxYear) notFound()

  // Serialise Decimals and Dates for client component
  const accounts = taxYear.financialAccounts.map((acct) => ({
    ...acct,
    statementImports: acct.statementImports.map((imp) => ({
      ...imp,
      totalInflows: imp.totalInflows?.toNumber() ?? null,
      totalOutflows: imp.totalOutflows?.toNumber() ?? null,
      reconciliationDelta: imp.reconciliationDelta?.toNumber() ?? null,
      uploadedAt: imp.uploadedAt.toISOString(),
      periodStart: imp.periodStart?.toISOString() ?? null,
      periodEnd: imp.periodEnd?.toISOString() ?? null,
    })),
  }))

  return (
    <UploadClient
      year={year}
      taxYearId={taxYear.id}
      taxYearStatus={taxYear.status}
      accounts={accounts}
    />
  )
}
