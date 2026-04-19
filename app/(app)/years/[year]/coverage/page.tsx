import { requireAuth } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { CoverageGrid } from "./coverage-grid"

interface Props {
  params: Promise<{ year: string }>
}

/** Which months have at least one SUCCESS/PARTIAL import, keyed by "accountId:YYYY-MM" */
type MonthCoverage = {
  accountId: string
  month: string       // "YYYY-MM"
  txCount: number
  hasGap: boolean     // month has 0 transactions from this account
}

export default async function CoveragePage({ params }: Props) {
  const { year: yearParam } = await params
  const session = await requireAuth()
  const userId = session.user!.id!

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
          statementImports: {
            where: { parseStatus: { in: ["SUCCESS", "PARTIAL"] } },
            select: {
              id: true,
              parseStatus: true,
              periodStart: true,
              periodEnd: true,
              transactionCount: true,
            },
          },
          transactions: {
            select: { postedDate: true },
          },
        },
        orderBy: { institution: "asc" },
      },
    },
  })

  if (!taxYear) notFound()

  // Build month-level coverage: for each account, which months of the tax year have transactions?
  const months: string[] = []
  for (let m = 1; m <= 12; m++) {
    months.push(`${year}-${String(m).padStart(2, "0")}`)
  }

  const accounts = taxYear.financialAccounts.map((acct) => {
    // Count transactions per month
    const txByMonth: Record<string, number> = {}
    for (const tx of acct.transactions) {
      const month = tx.postedDate.toISOString().slice(0, 7)
      txByMonth[month] = (txByMonth[month] ?? 0) + 1
    }

    const coverage: MonthCoverage[] = months.map((month) => ({
      accountId: acct.id,
      month,
      txCount: txByMonth[month] ?? 0,
      hasGap: (txByMonth[month] ?? 0) === 0,
    }))

    return {
      id: acct.id,
      institution: acct.institution,
      nickname: acct.nickname,
      mask: acct.mask,
      type: acct.type,
      importCount: acct.statementImports.length,
      coverage,
    }
  })

  // Total gap count (months × accounts where txCount=0 and account has at least 1 import)
  const totalGaps = accounts
    .filter((a) => a.importCount > 0)
    .flatMap((a) => a.coverage)
    .filter((c) => c.hasGap).length

  return (
    <CoverageGrid
      year={year}
      months={months}
      accounts={accounts}
      totalGaps={totalGaps}
    />
  )
}
