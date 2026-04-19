"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Plus, Trash2, X } from "lucide-react"
import { KNOWN_ENTITY_KINDS, TRANSACTION_CODES } from "../constants"
import { saveStep8 } from "../actions"
import type { WizardData, KnownEntityFormData } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
  onBack: () => void
}

const emptyEntity = (): KnownEntityFormData => ({
  kind: "PERSON_PERSONAL", displayName: "", matchKeywords: [],
  defaultCode: null, notes: "",
})

export default function Step8({ data, onNext, onBack }: Props) {
  const [entities, setEntities] = useState<KnownEntityFormData[]>(data.knownEntities ?? [])
  const [kwInputs, setKwInputs] = useState<string[]>((data.knownEntities ?? []).map(() => ""))
  const [fieldErrors, setFieldErrors] = useState<Record<number, Record<string, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const update = (i: number, field: keyof KnownEntityFormData, value: unknown) => {
    setEntities((prev) => prev.map((e, idx) => idx === i ? { ...e, [field]: value } : e))
  }

  const addKeyword = (i: number) => {
    const kw = kwInputs[i]?.trim()
    if (!kw) return
    setEntities((prev) => prev.map((e, idx) => idx === i ? { ...e, matchKeywords: [...e.matchKeywords, kw.toUpperCase()] } : e))
    setKwInputs((prev) => prev.map((v, idx) => idx === i ? "" : v))
  }

  const removeKeyword = (i: number, kw: string) => {
    setEntities((prev) => prev.map((e, idx) => idx === i ? { ...e, matchKeywords: e.matchKeywords.filter((k) => k !== kw) } : e))
  }

  const addEntity = () => {
    setEntities((prev) => [...prev, emptyEntity()])
    setKwInputs((prev) => [...prev, ""])
  }

  const removeEntity = (i: number) => {
    setEntities((prev) => prev.filter((_, idx) => idx !== i))
    setKwInputs((prev) => prev.filter((_, idx) => idx !== i))
    setFieldErrors((prev) => {
      const next = { ...prev }
      delete next[i]
      return next
    })
  }

  const validate = (): boolean => {
    const errs: Record<number, Record<string, string>> = {}
    entities.forEach((e, i) => {
      const err: Record<string, string> = {}
      if (!e.displayName.trim()) err.displayName = "Display name required"
      if (e.matchKeywords.length === 0) err.matchKeywords = "At least one match keyword required"
      if (Object.keys(err).length > 0) errs[i] = err
    })
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setIsLoading(true)
    setServerError(null)
    const result = await saveStep8({ knownEntities: entities })
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ knownEntities: entities })
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Tell TaxLens who appears in your transaction descriptions. This prevents the AI from mis-classifying
        personal Zelle transfers as expenses, or missing contractor payments.
      </p>

      {entities.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No entities added. You can skip this step.</p>
      )}

      {entities.map((entity, i) => (
        <div key={i} className="border rounded-lg p-4 space-y-3 relative">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Entity {i + 1}</h4>
            <Button type="button" variant="ghost" size="sm" onClick={() => removeEntity(i)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Type</Label>
            <select
              value={entity.kind}
              onChange={(e) => update(i, "kind", e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
            >
              {KNOWN_ENTITY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>{k.label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Display name</Label>
              <Input
                value={entity.displayName}
                onChange={(e) => update(i, "displayName", e.target.value)}
                placeholder="e.g., Spouse — Randi"
              />
              {fieldErrors[i]?.displayName && <p className="text-xs text-destructive">{fieldErrors[i].displayName}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Default classification (optional)</Label>
              <select
                value={entity.defaultCode ?? ""}
                onChange={(e) => update(i, "defaultCode", e.target.value || null)}
                className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
              >
                <option value="">— None —</option>
                {TRANSACTION_CODES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">
              Match keywords{" "}
              <span className="text-muted-foreground">(strings to search in transaction descriptions — uppercase)</span>
            </Label>
            <div className="flex flex-wrap gap-1 mb-2">
              {entity.matchKeywords.map((kw) => (
                <Badge key={kw} variant="secondary" className="gap-1 pr-1">
                  {kw}
                  <button type="button" onClick={() => removeKeyword(i, kw)}>
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <div className="flex gap-2">
              <Input
                value={kwInputs[i] ?? ""}
                onChange={(e) => setKwInputs((prev) => prev.map((v, idx) => idx === i ? e.target.value : v))}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addKeyword(i) } }}
                placeholder="e.g., ZELLE RANDI (press Enter to add)"
                className="flex-1"
              />
              <Button type="button" variant="outline" size="sm" onClick={() => addKeyword(i)}>Add</Button>
            </div>
            {fieldErrors[i]?.matchKeywords && <p className="text-xs text-destructive">{fieldErrors[i].matchKeywords}</p>}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Notes (optional)</Label>
            <Input
              value={entity.notes ?? ""}
              onChange={(e) => update(i, "notes", e.target.value)}
              placeholder="e.g., Personal transfers to spouse — not deductible"
            />
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" onClick={addEntity} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Add a person or pattern
      </Button>

      {serverError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>← Back</Button>
        <Button type="button" onClick={handleSave} disabled={isLoading}>
          {isLoading ? "Saving…" : "Next →"}
        </Button>
      </div>
    </div>
  )
}
