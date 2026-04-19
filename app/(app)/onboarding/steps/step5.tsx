"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, AlertTriangle } from "lucide-react"
import { saveStep5 } from "../actions"
import type { WizardData, VehicleConfig } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
  onBack: () => void
}

type FormValues = { vehicleUse: "no" | "mixed" | "dedicated" }

export default function Step5({ data, onNext, onBack }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const cfg = data.vehicleConfig
  const defaultUse = !cfg?.has ? "no" : (cfg.bizPct ?? 100) < 100 ? "mixed" : "dedicated"

  const { register, handleSubmit, watch } = useForm<FormValues>({
    defaultValues: { vehicleUse: defaultUse },
  })

  const vehicleUse = watch("vehicleUse")
  const [bizPct, setBizPct] = useState(cfg?.bizPct ?? 50)

  const onSubmit = async (values: FormValues) => {
    const config: VehicleConfig =
      values.vehicleUse === "no"
        ? { has: false }
        : values.vehicleUse === "dedicated"
        ? { has: true, bizPct: 100 }
        : { has: true, bizPct }

    setIsLoading(true)
    setServerError(null)
    const result = await saveStep5(config)
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ vehicleConfig: config })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <Label>Vehicle used for business</Label>
        <div className="space-y-2">
          {[
            { value: "no", label: "No — I don't use a vehicle for business" },
            { value: "mixed", label: "Yes — mixed personal and business use" },
            { value: "dedicated", label: "Yes — dedicated business vehicle only" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={opt.value} {...register("vehicleUse")} className="h-4 w-4 accent-primary" />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {vehicleUse === "mixed" && (
        <div className="space-y-4 border rounded-lg p-4 bg-muted/30">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Estimated business use</Label>
              <span className="text-2xl font-bold tabular-nums">{bizPct}%</span>
            </div>
            <Slider
              min={1}
              max={100}
              step={1}
              value={[bizPct]}
              onValueChange={([v]) => setBizPct(v)}
              className="w-full"
            />
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>1%</span>
              <span>50%</span>
              <span>100%</span>
            </div>
          </div>

          {bizPct >= 75 && bizPct < 90 && (
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>IRS scrutiny zone:</strong> Vehicle business use above 75% draws heightened
                examination. Make sure you have a mileage log to substantiate this claim.
              </AlertDescription>
            </Alert>
          )}
          {bizPct >= 90 && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Statistically implausible:</strong> Vehicle business use above 90% is
                an audit red flag. Only select this if you genuinely have a separate personal vehicle
                and can document every business mile.
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

      {vehicleUse !== "no" && (
        <p className="text-xs text-muted-foreground">
          §274(d) requires a contemporaneous mileage log. The app will prompt you for this during the STOP review phase.
        </p>
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
