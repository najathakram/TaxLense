"use client"

/**
 * Owners panel — manages Schedule K-1 recipients on a BusinessProfile.
 *
 * Surface area: list owners, add a new owner via inline form, edit an
 * existing owner via inline form, remove. Sums ownership% and warns when
 * the total drifts from 100. Hidden when the entity type doesn't issue
 * K-1s (SOLE_PROP, LLC_SINGLE, C_CORP) — those entities have no
 * shareholder/partner concept, so the table doesn't apply.
 */

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Pencil, Trash2, Plus } from "lucide-react"
import { addOwner, updateOwner, removeOwner } from "@/lib/owners/actions"

export interface OwnerRow {
  id: string
  kind: string
  name: string
  ssnLast4: string | null
  ein: string | null
  ownershipPct: number
  w2Wages: number | null
  guaranteedPayments: number | null
  notes: string | null
}

interface Props {
  profileId: string
  entityType: string
  initialOwners: OwnerRow[]
}

const KIND_OPTIONS_BY_ENTITY: Record<string, Array<{ value: string; label: string }>> = {
  S_CORP: [
    { value: "OFFICER", label: "Officer-shareholder (W-2 required)" },
    { value: "SHAREHOLDER", label: "Plain shareholder" },
  ],
  LLC_MULTI: [
    { value: "MEMBER", label: "Member" },
    { value: "GENERAL_PARTNER", label: "General partner (SE tax)" },
    { value: "LIMITED_PARTNER", label: "Limited partner (no SE tax)" },
  ],
  PARTNERSHIP: [
    { value: "GENERAL_PARTNER", label: "General partner (SE tax)" },
    { value: "LIMITED_PARTNER", label: "Limited partner (no SE tax)" },
  ],
}

const ENTITIES_WITH_K1 = new Set(["S_CORP", "LLC_MULTI", "PARTNERSHIP"])

export default function OwnersPanel({ profileId, entityType, initialOwners }: Props) {
  const [owners, setOwners] = useState<OwnerRow[]>(initialOwners)
  const [editingId, setEditingId] = useState<string | "new" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!ENTITIES_WITH_K1.has(entityType)) {
    return (
      <div className="border rounded-lg p-4 space-y-2">
        <h3 className="font-semibold text-sm">Owners</h3>
        <p className="text-sm text-muted-foreground">
          Owner records (Schedule K-1) only apply to S-Corp, multi-member LLC, and partnership
          entities. Your current entity ({entityType.replace(/_/g, " ").toLowerCase()}) reports
          income directly on the owner&apos;s 1040 — no K-1 needed.
        </p>
      </div>
    )
  }

  const kindOptions = KIND_OPTIONS_BY_ENTITY[entityType] ?? KIND_OPTIONS_BY_ENTITY.LLC_MULTI!
  const ownershipSum = owners.reduce((a, b) => a + b.ownershipPct, 0)
  const sumOk = Math.abs(ownershipSum - 100) < 0.001

  const onAdd = (data: Omit<OwnerRow, "id">) => {
    setError(null)
    start(async () => {
      const res = await addOwner({ profileId, ...data })
      if (!res.ok) { setError(res.error); return }
      setOwners((prev) => [...prev, { id: res.id, ...data }])
      setEditingId(null)
    })
  }

  const onUpdate = (id: string, data: Omit<OwnerRow, "id">) => {
    setError(null)
    start(async () => {
      const res = await updateOwner(id, { profileId, ...data })
      if (!res.ok) { setError(res.error); return }
      setOwners((prev) => prev.map((o) => (o.id === id ? { ...o, ...data } : o)))
      setEditingId(null)
    })
  }

  const onRemove = (id: string) => {
    if (!confirm("Remove this owner? Their K-1 will no longer be generated.")) return
    setError(null)
    start(async () => {
      const res = await removeOwner(id)
      if (!res.ok) { setError(res.error); return }
      setOwners((prev) => prev.filter((o) => o.id !== id))
    })
  }

  return (
    <div className="border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-sm">Owners ({owners.length})</h3>
        {editingId === null && (
          <Button variant="ghost" size="sm" onClick={() => setEditingId("new")} disabled={pending}>
            <Plus className="h-3 w-3 mr-1" /> Add owner
          </Button>
        )}
      </div>

      {!sumOk && owners.length > 0 && (
        <div className="text-xs px-3 py-2 rounded bg-amber-100 dark:bg-amber-950/30 text-amber-900 dark:text-amber-100">
          Ownership sum: {ownershipSum.toFixed(2)}% (expected 100%). The K-1 builder will render the
          allocations but the CPA should reconcile before filing.
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <div className="space-y-2">
        {owners.map((o) =>
          editingId === o.id ? (
            <OwnerForm
              key={o.id}
              kindOptions={kindOptions}
              initial={o}
              onCancel={() => setEditingId(null)}
              onSave={(data) => onUpdate(o.id, data)}
              pending={pending}
            />
          ) : (
            <div key={o.id} className="flex items-center justify-between gap-3 p-3 border rounded text-sm">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <strong>{o.name}</strong>
                  <Badge variant="outline" className="text-xs">{o.kind.replace(/_/g, " ")}</Badge>
                  <span className="font-mono text-xs text-muted-foreground">
                    {o.ownershipPct.toFixed(2)}%
                  </span>
                </div>
                <div className="text-xs text-muted-foreground mt-0.5 flex gap-3 flex-wrap">
                  {o.ssnLast4 && <span>SSN ending {o.ssnLast4}</span>}
                  {o.ein && <span className="font-mono">EIN {o.ein}</span>}
                  {o.w2Wages != null && <span>W-2 ${o.w2Wages.toLocaleString()}</span>}
                  {o.guaranteedPayments != null && <span>GP ${o.guaranteedPayments.toLocaleString()}</span>}
                </div>
              </div>
              <div className="flex gap-1 shrink-0">
                <Button variant="ghost" size="sm" onClick={() => setEditingId(o.id)} disabled={pending}>
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onRemove(o.id)} disabled={pending}>
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ),
        )}
        {owners.length === 0 && editingId !== "new" && (
          <p className="text-sm text-muted-foreground italic">
            No owners recorded yet. Until you add at least one owner, K-1s default to the
            taxpayer at 100% — useful for a single-shareholder S-Corp but wrong for any entity
            with multiple owners.
          </p>
        )}
      </div>

      {editingId === "new" && (
        <OwnerForm
          kindOptions={kindOptions}
          initial={null}
          onCancel={() => setEditingId(null)}
          onSave={(data) => onAdd(data)}
          pending={pending}
        />
      )}
    </div>
  )
}

interface OwnerFormProps {
  kindOptions: Array<{ value: string; label: string }>
  initial: OwnerRow | null
  onCancel: () => void
  onSave: (data: Omit<OwnerRow, "id">) => void
  pending: boolean
}

function OwnerForm({ kindOptions, initial, onCancel, onSave, pending }: OwnerFormProps) {
  const [kind, setKind] = useState(initial?.kind ?? kindOptions[0]!.value)
  const [name, setName] = useState(initial?.name ?? "")
  const [ssnLast4, setSsnLast4] = useState(initial?.ssnLast4 ?? "")
  const [ein, setEin] = useState(initial?.ein ?? "")
  const [ownershipPct, setOwnershipPct] = useState(
    initial?.ownershipPct != null ? String(initial.ownershipPct) : "",
  )
  const [w2Wages, setW2Wages] = useState(
    initial?.w2Wages != null ? String(initial.w2Wages) : "",
  )
  const [guaranteedPayments, setGuaranteedPayments] = useState(
    initial?.guaranteedPayments != null ? String(initial.guaranteedPayments) : "",
  )
  const [notes, setNotes] = useState(initial?.notes ?? "")

  const handleSubmit = () => {
    const pct = Number.parseFloat(ownershipPct)
    if (!name.trim() || !Number.isFinite(pct)) return
    onSave({
      kind,
      name: name.trim(),
      ssnLast4: ssnLast4.trim() ? ssnLast4.trim() : null,
      ein: ein.trim() ? ein.trim() : null,
      ownershipPct: pct,
      w2Wages: w2Wages.trim() ? Number.parseFloat(w2Wages) : null,
      guaranteedPayments: guaranteedPayments.trim() ? Number.parseFloat(guaranteedPayments) : null,
      notes: notes.trim() ? notes.trim() : null,
    })
  }

  return (
    <div className="border-2 border-primary/40 rounded p-3 space-y-3 bg-muted/30">
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Kind</Label>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm"
          >
            {kindOptions.map((k) => (
              <option key={k.value} value={k.value}>{k.label}</option>
            ))}
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Ownership %</Label>
          <Input
            type="number"
            min="0"
            max="100"
            step="0.01"
            value={ownershipPct}
            onChange={(e) => setOwnershipPct(e.target.value)}
            placeholder="50.00"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Name (as on K-1)</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Jane Doe" />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">SSN last 4</Label>
          <Input
            value={ssnLast4}
            onChange={(e) => setSsnLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
            placeholder="1234"
            maxLength={4}
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">EIN (entity owner)</Label>
          <Input
            value={ein}
            onChange={(e) => setEin(e.target.value.replace(/\D/g, "").slice(0, 9))}
            placeholder="123456789"
            maxLength={9}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">W-2 wages from this entity</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={w2Wages}
            onChange={(e) => setW2Wages(e.target.value)}
            placeholder="0.00"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Guaranteed payments (1065 only)</Label>
          <Input
            type="number"
            min="0"
            step="0.01"
            value={guaranteedPayments}
            onChange={(e) => setGuaranteedPayments(e.target.value)}
            placeholder="0.00"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Notes (capital account, special allocations)</Label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel} disabled={pending}>Cancel</Button>
        <Button size="sm" onClick={handleSubmit} disabled={pending}>
          {pending ? "Saving…" : initial ? "Save" : "Add owner"}
        </Button>
      </div>
    </div>
  )
}
