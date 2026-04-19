"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Info } from "lucide-react"
import { US_STATES } from "../constants"
import { saveStep1 } from "../actions"
import type { WizardData } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
}

type FormValues = {
  year: number
  entityType: "SOLE_PROP" | "LLC_SINGLE" | "OTHER"
  primaryState: string
  accountingMethod: "CASH" | "ACCRUAL"
  firstYear: boolean
}

export default function Step1({ data, onNext }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      year: data.year ?? 2025,
      entityType: (data.entityType as FormValues["entityType"]) ?? "SOLE_PROP",
      primaryState: data.primaryState ?? "",
      accountingMethod: data.accountingMethod ?? "CASH",
      firstYear: data.firstYear ?? false,
    },
  })

  const entityType = watch("entityType")

  const onSubmit = async (values: FormValues) => {
    if (values.entityType === "OTHER") return // wall prevents progression
    setIsLoading(true)
    setServerError(null)
    const result = await saveStep1(values)
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ year: values.year, entityType: values.entityType as "SOLE_PROP" | "LLC_SINGLE", primaryState: values.primaryState, accountingMethod: values.accountingMethod, firstYear: values.firstYear })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="year">Tax year</Label>
        <Input
          id="year"
          type="number"
          min={2020}
          max={2030}
          {...register("year", { required: "Year is required", min: { value: 2020, message: "Year must be 2020 or later" }, max: { value: 2030, message: "Year must be 2030 or earlier" }, valueAsNumber: true })}
        />
        {errors.year && <p className="text-sm text-destructive">{errors.year.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Entity type</Label>
        <div className="space-y-2">
          {[
            { value: "SOLE_PROP", label: "Sole Proprietor (Schedule C / 1040)" },
            { value: "LLC_SINGLE", label: "Single-Member LLC (disregarded entity)" },
            { value: "OTHER", label: "Other (S-Corp, partnership, C-Corp…)" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value={opt.value}
                {...register("entityType", { required: "Entity type is required" })}
                className="h-4 w-4 accent-primary"
              />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
        {errors.entityType && <p className="text-sm text-destructive">{errors.entityType.message}</p>}
        {entityType === "OTHER" && (
          <Alert className="mt-2">
            <Info className="h-4 w-4" />
            <AlertDescription>
              S-Corps, partnerships, and C-Corps are supported in <strong>TaxLens V2</strong>.
              For now, please work with your CPA for these entity types.
            </AlertDescription>
          </Alert>
        )}
      </div>

      <div className="space-y-2">
        <Label htmlFor="primaryState">Primary state of operation</Label>
        <select
          id="primaryState"
          {...register("primaryState", { required: "State is required" })}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">Select a state…</option>
          {US_STATES.map((s) => (
            <option key={s.value} value={s.value}>{s.label}</option>
          ))}
        </select>
        {errors.primaryState && <p className="text-sm text-destructive">{errors.primaryState.message}</p>}
      </div>

      <div className="space-y-2">
        <Label>Accounting method</Label>
        <div className="flex gap-4">
          {[
            { value: "CASH", label: "Cash (default — most sole props)" },
            { value: "ACCRUAL", label: "Accrual" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={opt.value} {...register("accountingMethod")} className="h-4 w-4 accent-primary" />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Checkbox
          id="firstYear"
          checked={watch("firstYear")}
          onCheckedChange={(v) => setValue("firstYear", !!v)}
        />
        <Label htmlFor="firstYear" className="cursor-pointer">
          This is the first year of this business (activates §195 start-up cost treatment)
        </Label>
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button type="submit" disabled={isLoading || entityType === "OTHER"}>
          {isLoading ? "Saving…" : "Next →"}
        </Button>
      </div>
    </form>
  )
}
