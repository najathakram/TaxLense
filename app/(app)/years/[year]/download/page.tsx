import { getCurrentUserId } from "@/lib/auth"
import { prisma } from "@/lib/db"
import { notFound } from "next/navigation"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { DownloadClient } from "./download-client"

interface Props {
  params: Promise<{ year: string }>
}

export default async function DownloadPage({ params }: Props) {
  const { year: yearParam } = await params
  const userId = await getCurrentUserId()
  const year = parseInt(yearParam, 10)
  if (isNaN(year)) notFound()

  const taxYear = await prisma.taxYear.findUnique({ where: { userId_year: { userId, year } } })
  if (!taxYear) notFound()

  const isLocked = taxYear.status === "LOCKED"

  // Fetch current reports for last-generated timestamps
  const reports = await prisma.report.findMany({
    where: { taxYearId: taxYear.id, isCurrent: true },
  })

  const reportMap = new Map(reports.map((r) => [r.kind, r]))

  const artifacts = [
    {
      kind: "MASTER_LEDGER" as const,
      title: "Master Ledger",
      description:
        "Locked transaction ledger with all classifications, IRC citations, evidence tiers, Merchant Rules, Stop Resolutions, and Profile Snapshot. Five-sheet XLSX.",
      filename: `taxlens-${year}-master-ledger.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    {
      kind: "FINANCIAL_STATEMENTS" as const,
      title: "Financial Statements",
      description:
        "General Ledger, Schedule C totals, P&L statement, Balance Sheet (cash method), and Schedule C Detail. Five-sheet XLSX. Schedule C totals match the locked ledger.",
      filename: `taxlens-${year}-financial-statements.xlsx`,
      contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    },
    {
      kind: "AUDIT_PACKET" as const,
      title: "Audit Defense Packet",
      description:
        "ZIP containing: transaction ledger XLSX, §274(d) substantiation CSVs, Cohan labels, position memos (§183/§274(n)(2)/§280A/wardrobe as applicable), income reconciliation, and source documents inventory.",
      filename: `taxlens-${year}-audit-packet.zip`,
      contentType: "application/zip",
    },
  ]

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Download Artifacts — {year}</h1>
        <Badge variant={isLocked ? "default" : "outline"}>{taxYear.status}</Badge>
      </div>

      {!isLocked && (
        <Alert variant="destructive">
          <AlertTitle>Tax year not locked</AlertTitle>
          <AlertDescription>
            All three artifacts require a locked ledger. Lock the year at{" "}
            <a href={`/years/${year}/lock`} className="underline font-medium">
              /years/{year}/lock
            </a>{" "}
            before generating reports.
          </AlertDescription>
        </Alert>
      )}

      <div className="space-y-4">
        {artifacts.map((a) => {
          const report = reportMap.get(a.kind)
          return (
            <Card key={a.kind}>
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base">{a.title}</CardTitle>
                  {report && (
                    <span className="text-xs text-muted-foreground shrink-0">
                      Last generated: {report.generatedAt.toISOString().slice(0, 19).replace("T", " ")} UTC
                    </span>
                  )}
                </div>
                <CardDescription className="text-sm">{a.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <DownloadClient
                  year={year}
                  kind={a.kind}
                  filename={a.filename}
                  disabled={!isLocked}
                />
              </CardContent>
            </Card>
          )
        })}
      </div>

      {isLocked && (
        <p className="text-xs text-muted-foreground">
          Reports are generated fresh on each download from the locked ledger snapshot (hash:{" "}
          <code className="text-xs">{taxYear.lockedSnapshotHash?.slice(0, 16)}…</code>).
          The Audit Packet includes AI-generated position memos — generation may take 30–60 seconds.
        </p>
      )}
    </div>
  )
}
