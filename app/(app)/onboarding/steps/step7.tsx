"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Checkbox } from "@/components/ui/checkbox"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, Plus, Trash2 } from "lucide-react"
import { saveStep7 } from "../actions"
import type { WizardData, TripFormData } from "../types"

type Props = {
  data: Partial<WizardData>
  onNext: (d: Partial<WizardData>) => void
  onBack: () => void
}

const emptyTrip = (): TripFormData => ({
  name: "", destination: "", startDate: "", endDate: "",
  purpose: "", deliverableDescription: "", isConfirmed: false,
})

export default function Step7({ data, onNext, onBack }: Props) {
  const [trips, setTrips] = useState<TripFormData[]>(data.trips ?? [])
  const [fieldErrors, setFieldErrors] = useState<Record<number, Record<string, string>>>({})
  const [serverError, setServerError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  const updateTrip = (i: number, field: keyof TripFormData, value: string | boolean) => {
    setTrips((prev) => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t))
    // Clear field error on change
    setFieldErrors((prev) => {
      const next = { ...prev }
      if (next[i]) { const { [field]: _, ...rest } = next[i]; next[i] = rest }
      return next
    })
  }

  const validate = (): boolean => {
    const errs: Record<number, Record<string, string>> = {}
    trips.forEach((t, i) => {
      const e: Record<string, string> = {}
      if (!t.name.trim()) e.name = "Trip name required"
      if (!t.destination.trim()) e.destination = "Destination required"
      if (!t.startDate) e.startDate = "Start date required"
      if (!t.endDate) e.endDate = "End date required"
      if (t.startDate && t.endDate && new Date(t.endDate) < new Date(t.startDate))
        e.endDate = "End date must be on or after start date"
      if (!t.purpose.trim() || t.purpose.length < 5) e.purpose = "Describe the business purpose (at least 5 chars)"
      if (Object.keys(e).length > 0) errs[i] = e
    })
    setFieldErrors(errs)
    return Object.keys(errs).length === 0
  }

  const handleSave = async () => {
    if (!validate()) return
    setIsLoading(true)
    setServerError(null)
    const result = await saveStep7({ trips })
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    onNext({ trips })
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        List all confirmed business trips for {data.year ?? 2025}. Trip windows drive the AI's
        classification of travel, lodging, and meals during those dates.
      </p>

      {trips.length === 0 && (
        <p className="text-sm text-muted-foreground italic">No trips added yet. You can skip this step if you had no business trips.</p>
      )}

      {trips.map((trip, i) => (
        <div key={i} className="border rounded-lg p-4 space-y-4 relative">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Trip {i + 1}</h4>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setTrips((prev) => prev.filter((_, idx) => idx !== i))}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">Trip name</Label>
              <Input value={trip.name} onChange={(e) => updateTrip(i, "name", e.target.value)} placeholder="e.g., Alaska Content Trip" />
              {fieldErrors[i]?.name && <p className="text-xs text-destructive">{fieldErrors[i].name}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Destination</Label>
              <Input value={trip.destination} onChange={(e) => updateTrip(i, "destination", e.target.value)} placeholder="e.g., Juneau, AK" />
              {fieldErrors[i]?.destination && <p className="text-xs text-destructive">{fieldErrors[i].destination}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Start date</Label>
              <Input type="date" value={trip.startDate} onChange={(e) => updateTrip(i, "startDate", e.target.value)} />
              {fieldErrors[i]?.startDate && <p className="text-xs text-destructive">{fieldErrors[i].startDate}</p>}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">End date</Label>
              <Input type="date" value={trip.endDate} onChange={(e) => updateTrip(i, "endDate", e.target.value)} />
              {fieldErrors[i]?.endDate && <p className="text-xs text-destructive">{fieldErrors[i].endDate}</p>}
            </div>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Business purpose</Label>
            <Textarea
              value={trip.purpose}
              onChange={(e) => updateTrip(i, "purpose", e.target.value)}
              placeholder="e.g., Film wedding content and photograph northern lights for client deliverables"
              rows={2}
            />
            {fieldErrors[i]?.purpose && <p className="text-xs text-destructive">{fieldErrors[i].purpose}</p>}
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Expected deliverables (optional)</Label>
            <Input
              value={trip.deliverableDescription ?? ""}
              onChange={(e) => updateTrip(i, "deliverableDescription", e.target.value)}
              placeholder="e.g., 30-min wedding film, 500 photos, 3 Instagram reels"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={trip.isConfirmed}
              onCheckedChange={(v) => updateTrip(i, "isConfirmed", !!v)}
            />
            <span className="text-xs">Confirmed (I have documentation — flights, itinerary, or invoices)</span>
          </label>
        </div>
      ))}

      <Button
        type="button"
        variant="outline"
        onClick={() => setTrips((prev) => [...prev, emptyTrip()])}
        className="w-full"
      >
        <Plus className="h-4 w-4 mr-2" />
        Add a trip
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
