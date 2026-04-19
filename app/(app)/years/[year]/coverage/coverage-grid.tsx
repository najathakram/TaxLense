"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"

interface MonthCoverage {
  accountId: string
  month: string
  txCount: number
  hasGap: boolean
}

interface AccountCoverage {
  id: string
  institution: string
  nickname: string | null
  mask: string | null
  type: string
  importCount: number
  coverage: MonthCoverage[]
}

interface Props {
  year: number
  months: string[]
  accounts: AccountCoverage[]
  totalGaps: number
}

const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                     "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function cellColor(txCount: number, importCount: number): string {
  if (importCount === 0) return "bg-muted/30 text-muted-foreground"
  if (txCount === 0) return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
  if (txCount <= 5) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
  return "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
}

export function CoverageGrid({ year, months, accounts, totalGaps }: Props) {
  if (accounts.length === 0) {
    return (
      <div className="p-6 space-y-4">
        <h1 className="text-2xl font-bold">Coverage Grid — {year}</h1>
        <Card>
          <CardContent className="py-12 text-center">
            <p className="text-muted-foreground text-sm">
              No accounts yet.{" "}
              <Link href={`/years/${year}/upload`} className="underline">
                Upload statements
              </Link>{" "}
              to see coverage.
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Coverage Grid</h1>
          <p className="text-sm text-muted-foreground">Tax Year {year} — statement coverage by month</p>
        </div>
        <div className="flex items-center gap-3">
          {totalGaps > 0 ? (
            <Badge variant="destructive">{totalGaps} gap{totalGaps !== 1 ? "s" : ""}</Badge>
          ) : (
            <Badge variant="default">Full coverage</Badge>
          )}
          <Link href={`/years/${year}/upload`}>
            <Badge variant="outline" className="cursor-pointer hover:bg-accent">+ Upload</Badge>
          </Link>
        </div>
      </div>

      {totalGaps > 0 && (
        <Alert>
          <AlertDescription>
            <strong>{totalGaps} month{totalGaps !== 1 ? "s" : ""}</strong> with no transactions detected.
            Upload missing statements or confirm the account was inactive for those months.
          </AlertDescription>
        </Alert>
      )}

      {/* Legend */}
      <div className="flex gap-4 text-xs">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-green-100 dark:bg-green-950 inline-block" />
          Has transactions
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-yellow-100 dark:bg-yellow-950 inline-block" />
          1–5 transactions
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-red-100 dark:bg-red-950 inline-block" />
          Gap (0 transactions)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-muted/30 inline-block" />
          No statement uploaded
        </span>
      </div>

      {/* Grid */}
      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b">
                <th className="text-left px-4 py-2 font-medium text-muted-foreground w-48">Account</th>
                {months.map((m, i) => (
                  <th key={m} className="px-2 py-2 font-medium text-muted-foreground text-center w-12">
                    {MONTH_SHORT[i]}
                  </th>
                ))}
                <th className="px-4 py-2 font-medium text-muted-foreground text-right">Imports</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((acct) => (
                <tr key={acct.id} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-4 py-2">
                    <div className="font-medium">{acct.nickname ?? acct.institution}</div>
                    {acct.mask && (
                      <div className="text-muted-foreground">···{acct.mask}</div>
                    )}
                  </td>
                  {acct.coverage.map((cell) => (
                    <td key={cell.month} className="px-1 py-1 text-center">
                      <span
                        className={`inline-block w-9 h-7 rounded text-xs font-medium leading-7 ${cellColor(cell.txCount, acct.importCount)}`}
                        title={`${cell.month}: ${cell.txCount} transaction${cell.txCount !== 1 ? "s" : ""}`}
                      >
                        {acct.importCount > 0 ? (cell.txCount === 0 ? "—" : cell.txCount) : ""}
                      </span>
                    </td>
                  ))}
                  <td className="px-4 py-2 text-right text-muted-foreground">
                    {acct.importCount}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      {/* Account detail cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.filter((a) => a.importCount > 0).map((acct) => {
          const gapMonths = acct.coverage.filter((c) => c.hasGap).map((c) => {
            const idx = parseInt(c.month.slice(5, 7), 10) - 1
            return MONTH_SHORT[idx]
          })
          const totalTx = acct.coverage.reduce((s, c) => s + c.txCount, 0)
          return (
            <Card key={acct.id}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  {acct.nickname ?? acct.institution}
                  {acct.mask && <span className="text-muted-foreground font-normal"> ···{acct.mask}</span>}
                </CardTitle>
              </CardHeader>
              <CardContent className="text-xs space-y-1">
                <p><span className="text-muted-foreground">Type:</span> {acct.type.replace("_", " ")}</p>
                <p><span className="text-muted-foreground">Statements:</span> {acct.importCount}</p>
                <p><span className="text-muted-foreground">Total transactions:</span> {totalTx}</p>
                {gapMonths.length > 0 ? (
                  <p className="text-red-600 dark:text-red-400">
                    <span className="font-medium">Missing:</span> {gapMonths.join(", ")}
                  </p>
                ) : (
                  <p className="text-green-600 dark:text-green-400 font-medium">All 12 months covered</p>
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>
    </div>
  )
}
