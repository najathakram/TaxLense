"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Plus, Trash2 } from "lucide-react"
import { INCOME_CATEGORIES } from "../constants"
import { saveStep9 } from "../actions"
import type { WizardData, IncomeSourceFormData } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
  onBack: () => void
}

const emptySource = (): IncomeSourceFormData => ({ platform: "", expectedTotal: 0, categories: [] })

export default function Step9({ data, onNext, onBack }: Props) {
  const [sources, setSources] = useState<IncomeSourceFormData[]>(data.incomeSources ?? [])
  const [fieldErrors, setFieldErrors] = useState<Record<number, Record<string, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const update = (i: number, field: keyof IncomeSourceFormData, value: unknown) =>
    setSources((prev) => prev.map((s, idx) => idx === i ? { ...s, [field]: value } : s))

  const toggleCategory = (i: number, cat: string) => {
    setSources((prev) => prev.map((s, idx) => {
      if (idx !== i) return s
      const cats = s.categories.includes(cat) ? s.categories.filter((c) => c !== cat) : [...s.categories, cat]
      return { ...s, categories: cats }
    }))
  }

  const validate = (): boolean => {
    const errs: Record<number, Record<string, string>> = {}
    sources.forEach((s, i) => {
      const err: Record<string, string> = {}
      if (!s.platform.trim()) err.platform = "Platform name required"
      if (s.expectedTotal < 0) err.expectedTotal = "Must be 0 or greater"
      if (Object.keys(err).length > 0) errs[i] = err
    })
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setIsLoading(true)
    setServerError(null)
    const result = await saveStep9({ incomeSources: sources })
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ incomeSources: sources })
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        List where you expect income to land in {data.year ?? 2025}. This enables deposit reconciliation —
        TaxLens will flag any deposits that don't match an expected source.
      </p>

      {sources.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No income sources added. You can skip this step.</p>
      )}

      {sources.map((source, i) => (
        <div key={i} className="border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Income source {i + 1}</h4>
            <Button type="button" variant="ghost" size="sm" onClick={() => setSources((prev) => prev.filter((_, idx) => idx !== i))}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Platform / payer name</Label>
              <Input
                value={source.platform}
                onChange={(e) => update(i, "platform", e.target.value)}
                placeholder="e.g., TheKnot, Stripe, PayPal Business"
              />
              {fieldErrors[i]?.platform && <p className="text-xs text-destructive">{fieldErrors[i].platform}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Approximate total expected</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-xs">$</span>
                <Input
                  type="number"
                  min={0}
                  className="pl-6"
                  value={source.expectedTotal}
                  onChange={(e) => update(i, "expectedTotal", parseFloat(e.target.value) || 0)}
                />
              </div>
              {fieldErrors[i]?.expectedTotal && <p className="text-xs text-destructive">{fieldErrors[i].expectedTotal}</p>}
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs">How does the money arrive? (select all that apply)</Label>
            <div className="grid grid-cols-2 gap-1">
              {INCOME_CATEGORIES.map((cat) => (
                <label key={cat.value} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={source.categories.includes(cat.value)}
                    onCheckedChange={() => toggleCategory(i, cat.value)}
                  />
                  <span className="text-xs">{cat.label}</span>
                </label>
              ))}
            </div>
          </div>
        </div>
      ))}

      <Button type="button" variant="outline" onClick={() => setSources((prev) => [...prev, emptySource()])} className="w-full">
        <Plus className="h-4 w-4 mr-2" />
        Add an income source
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
