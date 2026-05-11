import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { CoverageGrid } from "./coverage-grid"

interface Props {
  params: Promise<{ year: string }>
}

/** Per-month coverage cell. `attestedInactive` clears the gap flag for A14. */
type MonthCoverage = {
  accountId: string
  month: string       // "YYYY-MM"
  txCount: number
  hasGap: boolean              // month has 0 transactions AND no attestation
  attestedInactive: boolean    // CPA marked the month inactive (A14 ok)
  attestationReason: string | null
}

export default async function CoveragePage({ params }: Props) {
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
          kind: true,
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
          // A14 attestations for this account in this tax year — clear
          // the gap flag for the month/year combos the CPA confirmed.
          inactiveMonths: {
            where: { year },
            select: { month: true, reason: true },
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

    // Index attestations by 1-12 month number → reason
    const attestationByMonth: Record<number, string> = {}
    for (const m of acct.inactiveMonths) {
      attestationByMonth[m.month] = m.reason
    }

    const coverage: MonthCoverage[] = months.map((monthStr) => {
      const monthNum = parseInt(monthStr.slice(5), 10)
      const txCount = txByMonth[monthStr] ?? 0
      const attestation = attestationByMonth[monthNum] ?? null
      return {
        accountId: acct.id,
        month: monthStr,
        txCount,
        // Gap = no txns AND no inactive attestation. With an attestation
        // the cell is "explained inactive" — A14 ok, no gap.
        hasGap: txCount === 0 && attestation === null,
        attestedInactive: attestation !== null,
        attestationReason: attestation,
      }
    })

    return {
      id: acct.id,
      institution: acct.institution,
      nickname: acct.nickname,
      mask: acct.mask,
      type: acct.type,
      kind: acct.kind,
      importCount: acct.statementImports.length,
      coverage,
    }
  })

  // Total gap count (months × accounts where txCount=0 AND no attestation,
  // restricted to accounts that have at least 1 import or at least 1
  // attestation — fully unused accounts are not flagged as 12 gaps).
  const totalGaps = accounts
    .filter((a) => a.importCount > 0 || a.coverage.some((c) => c.attestedInactive))
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
