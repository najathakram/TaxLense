"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Checkbox } from "@/components/ui/checkbox"
import { approveCandidate, recordW9, deleteFiling, markW9Requested } from "./actions"

interface Candidate {
  payeeName: string
  totalDollars: number
  txCount: number
  txIds: string[]
  hasW9: boolean
  isCorporationExempt: boolean
  isLegalOrMedical: boolean
  existingFilingId: string | null
}
interface Filing {
  id: string
  recipientName: string
  recipientTin: string
  box1NonemployeeComp: number
  filingPath: string
  filedAt: string | null
  sourceTransactionIds: string[]
}
interface W9 {
  payeeName: string
  payeeEmail: string
  businessName: string
  taxClassification: string
  tin: string
  isEntityCorporation: boolean
  isExempt: boolean
  exemptCode: string
  addressLine1: string
  addressLine2: string
  city: string
  stateRegion: string
  postalCode: string
  notes: string
  status: string
}

interface Props {
  year: number
  isLocked: boolean
  candidates: Candidate[]
  filings: Filing[]
  w9Map: Record<string, W9>
}

const TAX_CLASSIFICATIONS = [
  "Individual / sole proprietor",
  "C Corporation",
  "S Corporation",
  "Partnership",
  "Trust / estate",
  "LLC — taxed as C Corp",
  "LLC — taxed as S Corp",
  "LLC — taxed as partnership",
  "Other",
]

function fmt(n: number) {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 })
}

export function Filings1099Client({ year, isLocked, candidates, filings, w9Map }: Props) {
  const router = useRouter()
  const [editingW9, setEditingW9] = useState<W9 | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const filingMap = new Map(filings.map((f) => [f.recipientName.toUpperCase(), f]))

  function openW9(c: Candidate) {
    const existing = w9Map[c.payeeName.toUpperCase()]
    setEditingW9(
      existing ?? {
        payeeName: c.payeeName,
        payeeEmail: "",
        businessName: "",
        taxClassification: "Individual / sole proprietor",
        tin: "",
        isEntityCorporation: false,
        isExempt: false,
        exemptCode: "",
        addressLine1: "",
        addressLine2: "",
        city: "",
        stateRegion: "",
        postalCode: "",
        notes: "",
        status: "REQUESTED",
      },
    )
    setError(null)
  }

  function approve(c: Candidate) {
    setError(null)
    startTransition(async () => {
      const res = await approveCandidate({
        year,
        payeeName: c.payeeName,
        totalDollars: c.totalDollars,
        txIds: c.txIds,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  function requestW9(c: Candidate) {
    setError(null)
    startTransition(async () => {
      const res = await markW9Requested(year, c.payeeName)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  function saveW9() {
    if (!editingW9) return
    setError(null)
    startTransition(async () => {
      const res = await recordW9({
        year,
        ...editingW9,
        payeeEmail: editingW9.payeeEmail || null,
        businessName: editingW9.businessName || null,
        taxClassification: editingW9.taxClassification || null,
        tin: editingW9.tin || null,
        exemptCode: editingW9.exemptCode || null,
        addressLine1: editingW9.addressLine1 || null,
        addressLine2: editingW9.addressLine2 || null,
        city: editingW9.city || null,
        stateRegion: editingW9.stateRegion || null,
        postalCode: editingW9.postalCode || null,
        notes: editingW9.notes || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      setEditingW9(null)
      router.refresh()
    })
  }

  function removeFiling(f: Filing) {
    if (!confirm(`Delete 1099-NEC filing for ${f.recipientName}?`)) return
    setError(null)
    startTransition(async () => {
      const res = await deleteFiling(year, f.id)
      if (!res.ok) {
        setError(res.error)
        return
      }
      router.refresh()
    })
  }

  return (
    <div className="p-6 space-y-6 max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">1099-NEC Filings — Tax Year {year}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Issue Form 1099-NEC to any non-corporate contractor paid ≥ $600 (Reg §1.6041-1).
            Per T.D. 9972, file via IRS IRIS / FIRE if you have ≥ 10 returns total.
          </p>
        </div>
        {filings.length > 0 && (
          <a
            href={`/api/years/${year}/1099s/iris-csv`}
            className="text-sm underline"
            download
          >
            Download IRIS CSV ({filings.length})
          </a>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Candidate list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Candidates from ledger ({candidates.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {candidates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No contractors paid ≥ $600 found. (Looks at WRITE_OFF classifications on
              Schedule C Line 11 / Compensation / Salaries / Guaranteed payments.)
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2">Payee</th>
                  <th className="text-right">Total ($)</th>
                  <th className="text-right">Txns</th>
                  <th className="text-center">W-9</th>
                  <th className="text-center">Filing</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => {
                  const f = filingMap.get(c.payeeName.toUpperCase())
                  const w9 = w9Map[c.payeeName.toUpperCase()]
                  const filed = !!f
                  const exempt = c.isCorporationExempt && !c.isLegalOrMedical
                  return (
                    <tr key={c.payeeName} className="border-b">
                      <td className="py-2">
                        <div className="font-medium">{c.payeeName}</div>
                        {exempt && (
                          <Badge variant="outline" className="text-xs mt-1">
                            Corporation exempt (Reg §1.6049-4(c)(1)(ii))
                          </Badge>
                        )}
                      </td>
                      <td className="text-right font-mono">{fmt(c.totalDollars)}</td>
                      <td className="text-right text-xs text-muted-foreground">{c.txCount}</td>
                      <td className="text-center">
                        {c.hasW9 ? (
                          <Badge variant="default" className="text-xs">on file</Badge>
                        ) : w9?.status === "REQUESTED" ? (
                          <Badge variant="outline" className="text-xs">requested</Badge>
                        ) : (
                          <Badge variant="destructive" className="text-xs">missing</Badge>
                        )}
                      </td>
                      <td className="text-center">
                        {filed ? (
                          <Badge variant="default" className="text-xs">filed</Badge>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="text-right space-x-1">
                        <Button size="sm" variant="outline" onClick={() => openW9(c)} disabled={isLocked}>
                          {c.hasW9 ? "Edit W-9" : "Capture W-9"}
                        </Button>
                        {!c.hasW9 && w9?.status !== "REQUESTED" && (
                          <Button size="sm" variant="ghost" onClick={() => requestW9(c)} disabled={isLocked}>
                            Mark requested
                          </Button>
                        )}
                        <Button
                          size="sm"
                          onClick={() => approve(c)}
                          disabled={isLocked || (!c.hasW9 && !exempt)}
                        >
                          {filed ? "Update filing" : "Approve filing"}
                        </Button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Approved filings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Approved 1099-NEC filings ({filings.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {filings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No filings approved yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-muted-foreground border-b">
                <tr>
                  <th className="text-left py-2">Recipient</th>
                  <th className="text-right">Box 1 ($)</th>
                  <th className="text-left">TIN</th>
                  <th className="text-left">Path</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filings.map((f) => (
                  <tr key={f.id} className="border-b">
                    <td className="py-2 font-medium">{f.recipientName}</td>
                    <td className="text-right font-mono">{fmt(f.box1NonemployeeComp)}</td>
                    <td className="font-mono text-xs">
                      {f.recipientTin || <span className="text-destructive">missing</span>}
                    </td>
                    <td className="text-xs">{f.filingPath}</td>
                    <td className="text-right space-x-1">
                      <a
                        href={`/api/years/${year}/1099s/pdf?recipient=${encodeURIComponent(f.recipientName)}`}
                        className="text-xs underline mr-2"
                        download
                      >
                        Download PDF
                      </a>
                      <Button size="sm" variant="ghost" onClick={() => removeFiling(f)} disabled={isLocked}>
                        Remove
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {filings.length > 0 && (
            <div className="mt-4 flex gap-2">
              <a
                href={`/api/years/${year}/1099s/1096`}
                className="text-xs underline"
                download
              >
                Download Form 1096 transmittal (paper-filing only)
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* W-9 capture dialog */}
      <Dialog open={!!editingW9} onOpenChange={(v) => !v && setEditingW9(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>W-9 — {editingW9?.payeeName}</DialogTitle>
          </DialogHeader>
          {editingW9 && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={editingW9.payeeEmail}
                  onChange={(e) => setEditingW9({ ...editingW9, payeeEmail: e.target.value })}
                />
              </div>
              <div>
                <Label>Business name (if different)</Label>
                <Input
                  value={editingW9.businessName}
                  onChange={(e) => setEditingW9({ ...editingW9, businessName: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label>Tax classification (W-9 line 3)</Label>
                <select
                  className="w-full border rounded px-2 py-1.5 bg-background mt-1"
                  value={editingW9.taxClassification}
                  onChange={(e) =>
                    setEditingW9({
                      ...editingW9,
                      taxClassification: e.target.value,
                      isEntityCorporation: /Corporation|LLC.*Corp/i.test(e.target.value),
                    })
                  }
                >
                  {TAX_CLASSIFICATIONS.map((tc) => (
                    <option key={tc} value={tc}>{tc}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>TIN (SSN or EIN)</Label>
                <Input
                  value={editingW9.tin}
                  placeholder="XXX-XX-XXXX or XX-XXXXXXX"
                  onChange={(e) => setEditingW9({ ...editingW9, tin: e.target.value })}
                />
              </div>
              <div className="flex items-center gap-2 mt-6">
                <Checkbox
                  checked={editingW9.isExempt}
                  onCheckedChange={(v) => setEditingW9({ ...editingW9, isExempt: !!v })}
                  id="isExempt"
                />
                <Label htmlFor="isExempt">Exempt payee</Label>
              </div>
              {editingW9.isExempt && (
                <div className="col-span-2">
                  <Label>Exempt payee code (W-9 line 4)</Label>
                  <Input
                    value={editingW9.exemptCode}
                    onChange={(e) => setEditingW9({ ...editingW9, exemptCode: e.target.value })}
                  />
                </div>
              )}
              <div className="col-span-2">
                <Label>Address line 1</Label>
                <Input
                  value={editingW9.addressLine1}
                  onChange={(e) => setEditingW9({ ...editingW9, addressLine1: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label>Address line 2</Label>
                <Input
                  value={editingW9.addressLine2}
                  onChange={(e) => setEditingW9({ ...editingW9, addressLine2: e.target.value })}
                />
              </div>
              <div>
                <Label>City</Label>
                <Input value={editingW9.city} onChange={(e) => setEditingW9({ ...editingW9, city: e.target.value })} />
              </div>
              <div>
                <Label>State</Label>
                <Input
                  value={editingW9.stateRegion}
                  onChange={(e) => setEditingW9({ ...editingW9, stateRegion: e.target.value })}
                />
              </div>
              <div>
                <Label>Postal code</Label>
                <Input
                  value={editingW9.postalCode}
                  onChange={(e) => setEditingW9({ ...editingW9, postalCode: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={2}
                  value={editingW9.notes}
                  onChange={(e) => setEditingW9({ ...editingW9, notes: e.target.value })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditingW9(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button onClick={saveW9} disabled={isPending}>
              {isPending ? "Saving…" : "Save W-9"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
