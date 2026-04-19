"use client"

import { useState } from "react"
import { useForm } from "react-hook-form"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Info } from "lucide-react"
import { saveStep6 } from "../actions"
import type { WizardData, InventoryConfig } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
  onBack: () => void
}

type FormValues = { inventory: "no" | "physical" | "dropship" }

export default function Step6({ data, onNext, onBack }: Props) {
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const cfg = data.inventoryConfig
  const defaultInventory = !cfg || !cfg.has ? "no" : cfg.dropship ? "dropship" : "physical"

  const { register, handleSubmit, watch } = useForm<FormValues>({
    defaultValues: { inventory: defaultInventory },
  })

  const inventory = watch("inventory")

  const onSubmit = async (values: FormValues) => {
    const config: InventoryConfig =
      values.inventory === "no"
        ? { has: false }
        : values.inventory === "physical"
        ? { has: true, physical: true, dropship: false }
        : { has: true, physical: false, dropship: true }

    setIsLoading(true)
    setServerError(null)
    const result = await saveStep6(config)
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ inventoryConfig: config })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      <div className="space-y-2">
        <Label>Inventory</Label>
        <div className="space-y-2">
          {[
            { value: "no", label: "No inventory — service-based or digital products only" },
            { value: "physical", label: "Yes — physical inventory I purchase and hold" },
            { value: "dropship", label: "Yes — dropship only (I never hold physical stock)" },
          ].map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 cursor-pointer">
              <input type="radio" value={opt.value} {...register("inventory")} className="h-4 w-4 accent-primary" />
              <span className="text-sm">{opt.label}</span>
            </label>
          ))}
        </div>
      </div>

      {inventory !== "no" && (
        <Alert>
          <Info className="h-4 w-4" />
          <AlertDescription>
            <strong>V1 supports COGS tracking</strong> (purchase price of goods sold appears on Schedule C Part III).
            Full §471(c) inventory accounting method choices and year-end inventory valuation are in <strong>V2</strong>.
          </AlertDescription>
        </Alert>
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
