"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Info } from "lucide-react"
import { saveStep4 } from "../actions"
import type { WizardData, HomeOfficeConfig } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
  onBack: () => void
}

type FormValues = {
  hasOffice: "no" | "dedicated" | "separate"
  officeSqft: number
  homeSqft: number
}

export default function Step4({ data, onNext, onBack }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const cfg = data.homeOfficeConfig
  const defaultHas = !cfg?.has ? "no" : cfg.dedicated === false ? "separate" : "dedicated"

  const { register, handleSubmit, watch, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      hasOffice: defaultHas,
      officeSqft: cfg?.officeSqft ?? 0,
      homeSqft: cfg?.homeSqft ?? 0,
    },
  })

  const hasOffice = watch("hasOffice")
  const officeSqft = watch("officeSqft") ?? 0
  const homeSqft = watch("homeSqft") ?? 0

  // §280A simplified method preview: min(officeSqft, 300) * $5
  const simplifiedDeduction = Math.min(officeSqft, 300) * 5

  const onSubmit = async (values: FormValues) => {
    const config: HomeOfficeConfig =
      values.hasOffice === "no"
        ? { has: false }
        : { has: true, dedicated: values.hasOffice === "dedicated", officeSqft: values.officeSqft, homeSqft: values.homeSqft }

    setIsLoading(true)
    setServerError(null)
    const result = await saveStep4(config)
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ homeOfficeConfig: config })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <Label>Home office</Label>
        <div className="space-y-2">
          {[
            { value: "no", label: "No home office" },
            { value: "dedicated", label: "Yes — dedicated room (regularly and exclusively used for business)" },
            { value: "separate", label: "Yes — separate structure on property" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={opt.value} {...register("hasOffice")} className="h-4 w-4 accent-primary" />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {hasOffice !== "no" && (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="officeSqft">Office sq ft</Label>
              <Input
                id="officeSqft"
                type="number"
                min={1}
                {...register("officeSqft", {
                  required: "Office sq ft required",
                  min: { value: 1, message: "Must be at least 1" },
                  valueAsNumber: true,
                })}
              />
              {errors.officeSqft && <p className="text-sm text-destructive">{errors.officeSqft.message}</p>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="homeSqft">Total home sq ft</Label>
              <Input
                id="homeSqft"
                type="number"
                min={1}
                {...register("homeSqft", {
                  required: "Home sq ft required",
                  min: { value: 1, message: "Must be at least 1" },
                  valueAsNumber: true,
                })}
              />
              {errors.homeSqft && <p className="text-sm text-destructive">{errors.homeSqft.message}</p>}
            </div>
          </div>

          {officeSqft > 0 && (
            <Alert>
              <Info className="h-4 w-4" />
              <AlertDescription>
                <strong>Simplified method preview (§280A):</strong>{" "}
                min({officeSqft}, 300) × $5 = <strong>${simplifiedDeduction.toLocaleString()}</strong>/year.
                {officeSqft > 300 && " (Capped at 300 sq ft for simplified method.)"}
                <br />
                <span className="text-xs text-muted-foreground">
                  Regular method (actual expense allocation) may yield more — calculated at output time.
                </span>
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {serverError && (
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
