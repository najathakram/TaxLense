"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { saveOwner, deleteOwner } from "./actions"

export interface OwnerRow {
  id: string
  kind: string
  name: string
  email: string
  ssnLast4: string
  ein: string
  ownershipPct: number
  w2Wages: number | null
  guaranteedPayments: number | null
  capitalContribution: number | null
  distributions: number | null
  stockBasis: number | null
  debtBasis: number | null
  partnerCapitalStart: number | null
  bookTaxDelta: number | null
  addressLine1: string
  addressLine2: string
  city: string
  stateRegion: string
  postalCode: string
  countryCode: string
  notes: string
}

interface Props {
  year: number
  entityType: string
  isLocked: boolean
  owners: OwnerRow[]
  summary: { byKind: Record<string, { count: number; sumPct: number }>; errors: string[] }
}

const KIND_LABEL: Record<string, string> = {
  PROPRIETOR: "Proprietor (Sole Prop / SMLLC)",
  OFFICER: "Officer-Shareholder (S-Corp)",
  SHAREHOLDER: "Shareholder (S-Corp / C-Corp)",
  GENERAL_PARTNER: "General Partner",
  LIMITED_PARTNER: "Limited Partner",
  MEMBER: "Member (LLC-multi)",
}

const ENTITY_HELPER: Record<string, string> = {
  SOLE_PROP: "Sole proprietors typically have one PROPRIETOR row representing the taxpayer.",
  LLC_SINGLE:
    "Single-Member LLCs typically have one PROPRIETOR row (disregarded for tax).",
  S_CORP:
    "S-Corp shareholders receive Schedule K-1. OFFICER (officer-shareholder) gets W-2 wages too. Allocation across SHAREHOLDER+OFFICER must equal 100%.",
  LLC_MULTI:
    "LLC-multi (taxed as partnership) — partners receive Schedule K-1. Allocation across MEMBER + GENERAL_PARTNER + LIMITED_PARTNER must equal 100%.",
  PARTNERSHIP:
    "Partnership — partners receive Schedule K-1 with §704(b) capital. Allocation across GENERAL_PARTNER + LIMITED_PARTNER + MEMBER must equal 100%.",
  C_CORP:
    "C-Corp shareholders are listed for Schedule G (any owner ≥ 20%). No K-1.",
}

const ALLOWED_KINDS_BY_ENTITY: Record<string, string[]> = {
  SOLE_PROP: ["PROPRIETOR"],
  LLC_SINGLE: ["PROPRIETOR"],
  S_CORP: ["OFFICER", "SHAREHOLDER"],
  LLC_MULTI: ["MEMBER", "GENERAL_PARTNER", "LIMITED_PARTNER"],
  PARTNERSHIP: ["GENERAL_PARTNER", "LIMITED_PARTNER", "MEMBER"],
  C_CORP: ["OFFICER", "SHAREHOLDER"],
}

function emptyOwner(defaultKind: string): OwnerRow {
  return {
    id: "",
    kind: defaultKind,
    name: "",
    email: "",
    ssnLast4: "",
    ein: "",
    ownershipPct: 0,
    w2Wages: null,
    guaranteedPayments: null,
    capitalContribution: null,
    distributions: null,
    stockBasis: null,
    debtBasis: null,
    partnerCapitalStart: null,
    bookTaxDelta: null,
    addressLine1: "",
    addressLine2: "",
    city: "",
    stateRegion: "",
    postalCode: "",
    countryCode: "US",
    notes: "",
  }
}

export function OwnersClient({ year, entityType, isLocked, owners, summary }: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState<OwnerRow | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const allowedKinds = ALLOWED_KINDS_BY_ENTITY[entityType] ?? ["PROPRIETOR"]

  function openCreate() {
    setEditing(emptyOwner(allowedKinds[0]!))
    setError(null)
  }
  function openEdit(o: OwnerRow) {
    setEditing({ ...o })
    setError(null)
  }
  function close() {
    setEditing(null)
    setError(null)
  }

  function submit() {
    if (!editing) return
    startTransition(async () => {
      const res = await saveOwner({
        year,
        id: editing.id || undefined,
        kind: editing.kind as never,
        name: editing.name,
        email: editing.email || null,
        ssnLast4: editing.ssnLast4 || null,
        ein: editing.ein || null,
        ownershipPct: Number(editing.ownershipPct),
        w2Wages: editing.w2Wages ?? null,
        guaranteedPayments: editing.guaranteedPayments ?? null,
        capitalContribution: editing.capitalContribution ?? null,
        distributions: editing.distributions ?? null,
        stockBasis: editing.stockBasis ?? null,
        debtBasis: editing.debtBasis ?? null,
        partnerCapitalStart: editing.partnerCapitalStart ?? null,
        bookTaxDelta: editing.bookTaxDelta ?? null,
        addressLine1: editing.addressLine1 || null,
        addressLine2: editing.addressLine2 || null,
        city: editing.city || null,
        stateRegion: editing.stateRegion || null,
        postalCode: editing.postalCode || null,
        countryCode: editing.countryCode || "US",
        notes: editing.notes || null,
      })
      if (!res.ok) {
        setError(res.error)
        return
      }
      close()
      router.refresh()
    })
  }

  function remove(o: OwnerRow) {
    if (!confirm(`Remove ${o.name}?`)) return
    startTransition(async () => {
      const res = await deleteOwner(year, o.id)
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
          <h1 className="text-2xl font-bold">Owners — Tax Year {year}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {ENTITY_HELPER[entityType] ?? "Add the people / entities that own equity."}
          </p>
        </div>
        <Button onClick={openCreate} disabled={isLocked}>+ Add owner</Button>
      </div>

      {/* Allocation summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Allocation summary</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {Object.keys(summary.byKind).length === 0 ? (
            <p className="text-sm text-muted-foreground">No owners configured.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {Object.entries(summary.byKind).map(([kind, s]) => (
                <li key={kind} className="flex justify-between">
                  <span>{KIND_LABEL[kind] ?? kind} — {s.count} owner{s.count !== 1 ? "s" : ""}</span>
                  <span
                    className={
                      Math.abs(s.sumPct - 100) > 0.01 && (kind === "SHAREHOLDER" || kind === "OFFICER" || kind === "GENERAL_PARTNER" || kind === "LIMITED_PARTNER" || kind === "MEMBER")
                        ? "text-destructive font-mono"
                        : "font-mono"
                    }
                  >
                    {s.sumPct.toFixed(2)}%
                  </span>
                </li>
              ))}
            </ul>
          )}
          {summary.errors.length > 0 && (
            <ul className="text-sm text-destructive mt-2 space-y-1">
              {summary.errors.map((e, i) => <li key={i}>⚠ {e}</li>)}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Owner cards */}
      <div className="grid gap-3 md:grid-cols-2">
        {owners.length === 0 && (
          <p className="text-sm text-muted-foreground col-span-2">
            No owners yet. {isLocked ? "" : "Click '+ Add owner' to start."}
          </p>
        )}
        {owners.map((o) => (
          <Card key={o.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center justify-between">
                <span>{o.name}</span>
                <Badge variant="outline" className="text-xs">{KIND_LABEL[o.kind] ?? o.kind}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="text-xs space-y-1">
              <p>
                <span className="text-muted-foreground">Allocation:</span>{" "}
                <span className="font-mono">{o.ownershipPct.toFixed(2)}%</span>
              </p>
              {o.email && (
                <p><span className="text-muted-foreground">Email:</span> {o.email}</p>
              )}
              {o.ssnLast4 && (
                <p><span className="text-muted-foreground">SSN:</span> ···-··-{o.ssnLast4}</p>
              )}
              {o.ein && (
                <p><span className="text-muted-foreground">EIN:</span> {o.ein}</p>
              )}
              {o.w2Wages != null && (
                <p><span className="text-muted-foreground">W-2 wages:</span> ${o.w2Wages.toLocaleString()}</p>
              )}
              {o.guaranteedPayments != null && (
                <p><span className="text-muted-foreground">Guaranteed payments:</span> ${o.guaranteedPayments.toLocaleString()}</p>
              )}
              {o.capitalContribution != null && (
                <p><span className="text-muted-foreground">Capital contribution:</span> ${o.capitalContribution.toLocaleString()}</p>
              )}
              {o.distributions != null && (
                <p><span className="text-muted-foreground">Distributions:</span> ${o.distributions.toLocaleString()}</p>
              )}
              <div className="pt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openEdit(o)} disabled={isLocked}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => remove(o)} disabled={isLocked}>
                  Remove
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit / create dialog */}
      <Dialog open={!!editing} onOpenChange={(v) => !v && close()}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing?.id ? "Edit owner" : "Add owner"}</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2">
                <Label>Role</Label>
                <select
                  className="w-full border rounded px-2 py-1.5 bg-background mt-1"
                  value={editing.kind}
                  onChange={(e) => setEditing({ ...editing, kind: e.target.value })}
                >
                  {allowedKinds.map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k] ?? k}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-2">
                <Label>Name *</Label>
                <Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} />
              </div>
              <div>
                <Label>Ownership % *</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={editing.ownershipPct}
                  onChange={(e) => setEditing({ ...editing, ownershipPct: Number(e.target.value) })}
                />
              </div>
              <div>
                <Label>SSN last 4</Label>
                <Input
                  maxLength={4}
                  value={editing.ssnLast4}
                  onChange={(e) => setEditing({ ...editing, ssnLast4: e.target.value })}
                />
              </div>
              <div>
                <Label>EIN (entity owner)</Label>
                <Input
                  placeholder="XX-XXXXXXX"
                  value={editing.ein}
                  onChange={(e) => setEditing({ ...editing, ein: e.target.value })}
                />
              </div>
              <div>
                <Label>W-2 wages (S-Corp officer)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.w2Wages ?? ""}
                  onChange={(e) => setEditing({ ...editing, w2Wages: e.target.value ? Number(e.target.value) : null })}
                />
              </div>
              <div>
                <Label>Guaranteed payments (Partnership)</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.guaranteedPayments ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, guaranteedPayments: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </div>
              <div>
                <Label>Capital contribution</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.capitalContribution ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, capitalContribution: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </div>
              <div>
                <Label>Distributions during year</Label>
                <Input
                  type="number"
                  min={0}
                  step="0.01"
                  value={editing.distributions ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, distributions: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </div>
              <div>
                <Label>Stock basis (S-Corp, year-start)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editing.stockBasis ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, stockBasis: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </div>
              <div>
                <Label>Debt basis (S-Corp, year-start)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editing.debtBasis ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, debtBasis: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </div>
              <div>
                <Label>§704(b) capital (Partnership, year-start)</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editing.partnerCapitalStart ?? ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      partnerCapitalStart: e.target.value ? Number(e.target.value) : null,
                    })
                  }
                />
              </div>
              <div>
                <Label>§704(c) book/tax delta</Label>
                <Input
                  type="number"
                  step="0.01"
                  value={editing.bookTaxDelta ?? ""}
                  onChange={(e) =>
                    setEditing({ ...editing, bookTaxDelta: e.target.value ? Number(e.target.value) : null })
                  }
                />
              </div>
              <div className="col-span-2">
                <Label>Address line 1</Label>
                <Input
                  value={editing.addressLine1}
                  onChange={(e) => setEditing({ ...editing, addressLine1: e.target.value })}
                />
              </div>
              <div className="col-span-2">
                <Label>Address line 2</Label>
                <Input
                  value={editing.addressLine2}
                  onChange={(e) => setEditing({ ...editing, addressLine2: e.target.value })}
                />
              </div>
              <div>
                <Label>City</Label>
                <Input value={editing.city} onChange={(e) => setEditing({ ...editing, city: e.target.value })} />
              </div>
              <div>
                <Label>State / Region</Label>
                <Input
                  value={editing.stateRegion}
                  onChange={(e) => setEditing({ ...editing, stateRegion: e.target.value })}
                />
              </div>
              <div>
                <Label>Postal code</Label>
                <Input
                  value={editing.postalCode}
                  onChange={(e) => setEditing({ ...editing, postalCode: e.target.value })}
                />
              </div>
              <div>
                <Label>Country</Label>
                <Input
                  value={editing.countryCode}
                  maxLength={2}
                  onChange={(e) => setEditing({ ...editing, countryCode: e.target.value.toUpperCase() })}
                />
              </div>
              <div className="col-span-2">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  value={editing.notes}
                  onChange={(e) => setEditing({ ...editing, notes: e.target.value })}
                />
              </div>
              {error && <p className="col-span-2 text-sm text-destructive">{error}</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={close} disabled={isPending}>Cancel</Button>
            <Button onClick={submit} disabled={isPending || !editing?.name || editing.ownershipPct == null}>
              {isPending ? "Saving…" : editing?.id ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
