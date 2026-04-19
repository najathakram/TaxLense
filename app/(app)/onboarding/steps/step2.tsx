"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle } from "lucide-react"
import { TOP_NAICS_CODES } from "../constants"
import { saveStep2 } from "../actions"
import type { WizardData } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
  onBack: () => void
}

type FormValues = {
  businessDescription: string
  naicsCode: string
  naicsSearch: string
  customNaics: string
}

export default function Step2({ data, onNext, onBack }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [useCustom, setUseCustom] = useState(false)

  const { register, handleSubmit, watch, setValue, formState: { errors } } = useForm<FormValues>({
    defaultValues: {
      businessDescription: data.businessDescription ?? "",
      naicsCode: data.naicsCode ?? "",
      naicsSearch: "",
      customNaics: data.naicsCode ?? "",
    },
  })

  const naicsCode = watch("naicsCode")
  const naicsSearch = watch("naicsSearch").toLowerCase()

  const filteredCodes = naicsSearch.length >= 2
    ? TOP_NAICS_CODES.filter(
        (c) => c.label.toLowerCase().includes(naicsSearch) || c.code.includes(naicsSearch)
      )
    : TOP_NAICS_CODES

  const selectedLabel = TOP_NAICS_CODES.find((c) => c.code === naicsCode)?.label

  const onSubmit = async (values: FormValues) => {
    const effectiveCode = useCustom ? values.customNaics : values.naicsCode
    setIsLoading(true)
    setServerError(null)
    const result = await saveStep2({ businessDescription: values.businessDescription, naicsCode: effectiveCode })
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ businessDescription: values.businessDescription, naicsCode: effectiveCode })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <Label htmlFor="businessDescription">Describe your primary business activity</Label>
        <Textarea
          id="businessDescription"
          placeholder="e.g., Wedding photography and travel content creation"
          rows={3}
          {...register("businessDescription", {
            required: "Business description is required",
            minLength: { value: 5, message: "Please write at least 5 characters" },
            maxLength: { value: 500, message: "Maximum 500 characters" },
          })}
        />
        {errors.businessDescription && <p className="text-sm text-destructive">{errors.businessDescription.message}</p>}
        <p className="text-xs text-muted-foreground">One sentence. This seeds the AI's understanding of your work.</p>
      </div>

      <div className="space-y-2">
        <Label>NAICS code</Label>
        {/* Hidden input so react-hook-form tracks naicsCode value */}
        <input type="hidden" {...register("naicsCode", { required: !useCustom ? "NAICS code is required" : false })} />

        {!useCustom ? (
          <div className="space-y-2">
            <Input
              placeholder="Search codes (e.g. 'photography', 'consulting', '711')…"
              {...register("naicsSearch")}
            />
            <select
              value={naicsCode}
              onChange={(e) => {
                if (e.target.value === "OTHER") { setUseCustom(true); return }
                setValue("naicsCode", e.target.value, { shouldValidate: true })
              }}
              className="flex h-32 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
              size={6}
            >
              <option value="">— Select a NAICS code —</option>
              {filteredCodes.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.label}
                </option>
              ))}
            </select>
            {selectedLabel && (
              <p className="text-sm text-muted-foreground">Selected: <strong>{naicsCode}</strong> — {selectedLabel}</p>
            )}
            <button type="button" onClick={() => setUseCustom(true)} className="text-xs text-primary underline">
              Enter a custom 6-digit code instead
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <Input
              placeholder="Enter exact 6-digit NAICS code (e.g. 711510)"
              {...register("customNaics", {
                required: "NAICS code is required",
                pattern: { value: /^\d{6}$/, message: "Must be exactly 6 digits" },
              })}
            />
            {errors.customNaics && <p className="text-sm text-destructive">{errors.customNaics.message}</p>}
            <button type="button" onClick={() => setUseCustom(false)} className="text-xs text-primary underline">
              ← Back to dropdown
            </button>
          </div>
        )}
        {errors.naicsCode && !useCustom && <p className="text-sm text-destructive">{errors.naicsCode.message}</p>}
        <p className="text-xs text-muted-foreground">
          Used on Schedule C line 1. Find yours at{" "}
          <a href="https://www.census.gov/naics/" target="_blank" rel="noopener noreferrer" className="text-primary underline">
            census.gov/naics
          </a>
        </p>
      </div>

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
