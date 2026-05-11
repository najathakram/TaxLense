"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { attestInactiveMonth, clearInactiveAttestation } from "./actions"

interface MonthCoverage {
  accountId: string
  month: string                        // YYYY-MM
  txCount: number
  hasGap: boolean
  attestedInactive: boolean
  attestationReason: string | null
}

interface AccountCoverage {
  id: string
  institution: string
  nickname: string | null
  mask: string | null
  type: string
  kind: string
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

function cellColor(cell: MonthCoverage, importCount: number): string {
  if (cell.attestedInactive) return "bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300"
  if (importCount === 0 && !cell.attestedInactive) return "bg-muted/30 text-muted-foreground"
  if (cell.txCount === 0) return "bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300"
  if (cell.txCount <= 5) return "bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-300"
  return "bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300"
}

function cellLabel(cell: MonthCoverage, importCount: number): string {
  if (cell.attestedInactive) return "n/a"
  if (importCount === 0) return ""
  if (cell.txCount === 0) return "—"
  return String(cell.txCount)
}

export function CoverageGrid({ year, months, accounts, totalGaps }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [selected, setSelected] = useState<{
    accountId: string
    accountLabel: string
    month: number
    monthLabel: string
    existingReason: string | null
  } | null>(null)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)

  function openCellDialog(acct: AccountCoverage, cell: MonthCoverage) {
    const monthNum = parseInt(cell.month.slice(5, 7), 10)
    setSelected({
      accountId: acct.id,
      accountLabel: acct.nickname ?? `${acct.institution}${acct.mask ? " ··" + acct.mask : ""}`,
      month: monthNum,
      monthLabel: MONTH_SHORT[monthNum - 1] ?? cell.month,
      existingReason: cell.attestationReason,
    })
    setReason(cell.attestationReason ?? "")
    setError(null)
  }

  function close() {
    setSelected(null)
    setReason("")
    setError(null)
  }

  function submitAttestation() {
    if (!selected) return
    startTransition(async () => {
      setError(null)
      const res = await attestInactiveMonth({
        year,
        accountId: selected.accountId,
        month: selected.month,
        reason: reason.trim(),
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      close()
      router.refresh()
    })
  }

  function clearAttestation() {
    if (!selected) return
    startTransition(async () => {
      setError(null)
      const res = await clearInactiveAttestation({
        year,
        accountId: selected.accountId,
        month: selected.month,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      close()
      router.refresh()
    })
  }

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
          <p className="text-sm text-muted-foreground">Tax Year {year} — statement coverage by month. Click any cell to mark it inactive.</p>
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
            Upload missing statements OR click the cell and attest the account was inactive
            for that month — A14 (lock assertion) accepts either.
          </AlertDescription>
        </Alert>
      )}

      {/* Legend */}
      <div className="flex gap-4 text-xs flex-wrap">
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
          Gap (0 transactions, no attestation)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded-sm bg-blue-100 dark:bg-blue-950 inline-block" />
          Attested inactive (A14 ok)
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
                    <div className="font-medium flex items-center gap-2">
                      {acct.nickname ?? acct.institution}
                      {acct.kind === "MONEY_MOVER" && (
                        <Badge variant="outline" className="text-[10px] px-1 py-0">wallet</Badge>
                      )}
                    </div>
                    {acct.mask && (
                      <div className="text-muted-foreground">···{acct.mask}</div>
                    )}
                  </td>
                  {acct.coverage.map((cell) => {
                    const title = cell.attestedInactive
                      ? `${cell.month}: attested inactive — ${cell.attestationReason}`
                      : `${cell.month}: ${cell.txCount} transaction${cell.txCount !== 1 ? "s" : ""} — click to mark inactive`
                    return (
                      <td key={cell.month} className="px-1 py-1 text-center">
                        <button
                          type="button"
                          onClick={() => openCellDialog(acct, cell)}
                          className={`inline-block w-9 h-7 rounded text-xs font-medium leading-7 cursor-pointer hover:ring-2 hover:ring-offset-1 hover:ring-foreground/20 ${cellColor(cell, acct.importCount)}`}
                          title={title}
                        >
                          {cellLabel(cell, acct.importCount)}
                        </button>
                      </td>
                    )
                  })}
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
        {accounts.filter((a) => a.importCount > 0 || a.coverage.some((c) => c.attestedInactive)).map((acct) => {
          const gapMonths = acct.coverage.filter((c) => c.hasGap).map((c) => {
            const idx = parseInt(c.month.slice(5, 7), 10) - 1
            return MONTH_SHORT[idx]
          })
          const attestedMonths = acct.coverage.filter((c) => c.attestedInactive).map((c) => {
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
                <p><span className="text-muted-foreground">Type:</span> {acct.type.replace("_", " ")}{acct.kind === "MONEY_MOVER" ? " · wallet" : ""}</p>
                <p><span className="text-muted-foreground">Statements:</span> {acct.importCount}</p>
                <p><span className="text-muted-foreground">Total transactions:</span> {totalTx}</p>
                {attestedMonths.length > 0 && (
                  <p className="text-blue-600 dark:text-blue-400">
                    <span className="font-medium">Attested inactive:</span> {attestedMonths.join(", ")}
                  </p>
                )}
                {gapMonths.length > 0 ? (
                  <p className="text-red-600 dark:text-red-400">
                    <span className="font-medium">Missing:</span> {gapMonths.join(", ")}
                  </p>
                ) : (
                  attestedMonths.length === 0 && (
                    <p className="text-green-600 dark:text-green-400 font-medium">All 12 months covered</p>
                  )
                )}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Attestation dialog */}
      <Dialog open={!!selected} onOpenChange={(open) => !open && close()}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected?.existingReason ? "Edit attestation" : "Mark month inactive"}
              {selected && ` — ${selected.accountLabel}, ${selected.monthLabel} ${year}`}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Confirm there was no real activity in this month (e.g. account closed, dormant, or
              statement intentionally not uploaded). The attestation is recorded in the audit trail
              and clears A14 for this cell.
            </p>
            <Textarea
              placeholder="Reason — minimum 10 characters (e.g. 'Account opened June 2025; no activity prior')"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>
          <DialogFooter>
            {selected?.existingReason && (
              <Button variant="outline" onClick={clearAttestation} disabled={isPending}>
                Clear attestation
              </Button>
            )}
            <Button variant="ghost" onClick={close} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={submitAttestation} disabled={isPending || reason.trim().length < 10}>
              {isPending ? "Saving…" : selected?.existingReason ? "Update" : "Mark inactive"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
