import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { after } from "next/server"
import { UploadClient } from "./upload-client"
import { parseImport } from "./actions"

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
            orderBy: { periodStart: { sort: "asc", nulls: "last" } },
          },
        },
        orderBy: { institution: "asc" },
      },
    },
  })

  if (!taxYear) notFound()

  // Auto-resume any PENDING imports left by a prior after() that was cut off
  const orphanedPending = taxYear.financialAccounts
    .flatMap((a) => a.statementImports)
    .filter((imp) => imp.parseStatus === "PENDING")
  if (orphanedPending.length > 0) {
    after(async () => {
      for (const imp of orphanedPending) {
        await parseImport(imp.id, year)
      }
    })
  }

  const currentSession = await prisma.importSession.findFirst({
    where: { taxYearId: taxYear.id, status: "IN_PROGRESS" },
    orderBy: { uploadedAt: "desc" },
    select: {
      id: true,
      totalApiCalls: true,
      apiCallLimit: true,
      notes: true,
      uploadedAt: true,
    },
  })

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
      session={
        currentSession
          ? {
              id: currentSession.id,
              totalApiCalls: currentSession.totalApiCalls,
              apiCallLimit: currentSession.apiCallLimit,
              notes: currentSession.notes,
              uploadedAt: currentSession.uploadedAt.toISOString(),
            }
          : null
      }
    />
  )
}
