"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { REVENUE_STREAMS } from "../constants"
import { saveStep3 } from "../actions"
import type { WizardData } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
  onBack: () => void
}

export default function Step3({ data, onNext, onBack }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [selected, setSelected] = useState<string[]>(data.revenueStreams ?? [])

  const { register, handleSubmit, formState: { errors } } = useForm({
    defaultValues: {
      grossReceiptsEstimate: data.grossReceiptsEstimate ?? 0,
    },
  })

  const toggleStream = (v: string) =>
    setSelected((prev) => prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v])

  const onSubmit = async (values: { grossReceiptsEstimate: number }) => {
    if (selected.length === 0) { setServerError("Select at least one revenue stream."); return }
    setIsLoading(true)
    setServerError(null)
    const result = await saveStep3({ revenueStreams: selected, grossReceiptsEstimate: values.grossReceiptsEstimate })
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ revenueStreams: selected, grossReceiptsEstimate: values.grossReceiptsEstimate })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-3">
        <Label>Revenue streams (select all that apply)</Label>
        {REVENUE_STREAMS.map((s) => (
          <label key={s.value} className="flex items-start gap-2 cursor-pointer">
            <Checkbox
              id={`rs-${s.value}`}
              checked={selected.includes(s.value)}
              onCheckedChange={() => toggleStream(s.value)}
              className="mt-0.5"
            />
            <span className="text-sm">{s.label}</span>
          </label>
        ))}
        {selected.length === 0 && serverError?.includes("revenue") && (
          <p className="text-sm text-destructive">Select at least one revenue stream.</p>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="grossReceiptsEstimate">Estimated gross receipts for {data.year ?? 2025}</Label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">$</span>
          <Input
            id="grossReceiptsEstimate"
            type="number"
            min={0}
            step={1000}
            className="pl-7"
            {...register("grossReceiptsEstimate", {
              required: "Gross receipts estimate is required",
              min: { value: 0, message: "Must be 0 or greater" },
              valueAsNumber: true,
            })}
          />
        </div>
        {errors.grossReceiptsEstimate && <p className="text-sm text-destructive">{errors.grossReceiptsEstimate.message}</p>}
        <p className="text-xs text-muted-foreground">
          Your best estimate. Used for §448(c) threshold check and sanity-checking AI classifications.
          Exact numbers come from your statements — this is just context.
        </p>
      </div>

      {serverError && !serverError.includes("revenue") && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>← Back</Button>
        <Button type="submit" disabled={isLoading}>{isLoading ? "Saving…" : "Next →"}</Button>
      </div>
    </form>
  )
}
