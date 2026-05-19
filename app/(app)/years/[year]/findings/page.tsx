import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { fmtUSD } from "@/lib/format/currency"
import { FindingsClient } from "./findings-client"

interface Props {
  params: Promise<{ year: string }>
}

const severityRank: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  COSMETIC: 4,
}

const severityColor: Record<string, string> = {
  CRITICAL: "bg-red-500 text-white",
  HIGH: "bg-orange-500 text-white",
  MEDIUM: "bg-yellow-500 text-black",
  LOW: "bg-blue-500 text-white",
  COSMETIC: "bg-gray-500 text-white",
}

export default async function FindingsPage(props: Props) {
  const params = await props.params
  const year = Number.parseInt(params.year, 10)
  if (Number.isNaN(year)) notFound()
  const userId = await getCurrentUserId()

  const taxYear = await prisma.taxYear.findUnique({
    where: { userId_year: { userId, year } },
    select: { id: true, status: true },
  })
  if (!taxYear) notFound()

  const findings = await prisma.ledgerFinding.findMany({
    where: { taxYearId: taxYear.id },
    orderBy: [{ createdAt: "desc" }],
  })

  // Group by state
  const proposed = findings.filter((f) => f.state === "PROPOSED")
  const accepted = findings.filter((f) => f.state === "ACCEPTED")
  const applied = findings.filter((f) => f.state === "APPLIED")
  const dismissed = findings.filter((f) => f.state === "DISMISSED")
  const superseded = findings.filter((f) => f.state === "SUPERSEDED")

  proposed.sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9))

  // Hydrate cited transactions for display
  const allTxnIds = Array.from(
    new Set(findings.flatMap((f) => f.citedTxnIds).slice(0, 200))
  )
  const txns = await prisma.transaction.findMany({
    where: { id: { in: allTxnIds } },
    select: { id: true, merchantRaw: true, postedDate: true, amountNormalized: true },
  })
  const txnById = new Map(txns.map((t) => [t.id, t]))

  const autoFixableProposed = proposed.filter((f) => f.autoFixable).length

  return (
    <div className="container mx-auto py-6 space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">CPA Audit Findings</h1>
          <p className="text-muted-foreground mt-1">
            Tax Year {year} · {findings.length} total findings ({proposed.length} pending review)
          </p>
        </div>
        <div className="flex gap-2">
          <Link href={`/years/${year}/finalize`}>
            <Button variant="outline">Back to Finalize</Button>
          </Link>
        </div>
      </div>

      <FindingsClient
        year={year}
        proposed={proposed.map((f) => ({
          id: f.id,
          severity: f.severity,
          category: f.category,
          title: f.title,
          rationale: f.rationale,
          autoFixable: f.autoFixable,
          proposedAction: f.proposedAction as unknown,
          citedTxns: f.citedTxnIds.map((id) => {
            const t = txnById.get(id)
            return t
              ? {
                  id: t.id,
                  merchant: t.merchantRaw,
                  date: t.postedDate.toISOString().slice(0, 10),
                  amount: Number(t.amountNormalized),
                }
              : { id, merchant: "(unknown)", date: "—", amount: 0 }
          }),
        }))}
        accepted={accepted.length}
        applied={applied.length}
        autoFixableCount={autoFixableProposed}
      />

      {(applied.length > 0 || dismissed.length > 0 || superseded.length > 0) && (
        <Card>
          <CardHeader>
            <CardTitle>History</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1 text-sm text-muted-foreground">
              <div>{applied.length} applied</div>
              <div>{dismissed.length} dismissed</div>
              <div>{superseded.length} superseded by later runs</div>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="text-xs text-muted-foreground">
        Findings are produced by the CPA_AUDIT (Opus 4.7) and COHAN_SWEEP (Sonnet 4.6) pipeline stages.
        Auto-fixable findings are applied via flip-and-insert; non-auto-fixable findings become STOPs or
        BLOCK notes. §274(d) categories are hard-blocked from Cohan reconstruction at apply time.
      </div>
    </div>
  )
}

// Re-export severity color so the client can use the same mapping.
export { severityColor }
