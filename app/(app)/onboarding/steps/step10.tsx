"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AlertCircle, CheckCircle2, Pencil } from "lucide-react"
import { finalizeOnboarding } from "../actions"
import { US_STATES, TOP_NAICS_CODES } from "../constants"
import type { WizardData } from "../types"

type Props = {
  data: Partial<WizardData>
  onBack: () => void
  onJumpToStep: (step: number) => void
}

function SectionRow({ label, value, onEdit }: { label: string; value: React.ReactNode; onEdit: () => void }) {
  return (
    <div className="flex items-start justify-between py-2 border-b last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-xs text-muted-foreground">{label}</p>
        <div className="text-sm font-medium">{value}</div>
      </div>
      <Button type="button" variant="ghost" size="sm" onClick={onEdit} className="ml-2 shrink-0">
        <Pencil className="h-3 w-3" />
      </Button>
    </div>
  )
}

export default function Step10({ data, onBack, onJumpToStep }: Props) {
  const [isLoading, setIsLoading] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)

  const stateName = US_STATES.find((s) => s.value === data.primaryState)?.label ?? data.primaryState ?? "—"
  const naicsLabel = TOP_NAICS_CODES.find((c) => c.code === data.naicsCode)?.label
  const homeOfc = data.homeOfficeConfig
  const vehicle = data.vehicleConfig
  const inventory = data.inventoryConfig

  const handleFinalize = async () => {
    setIsLoading(true)
    setServerError(null)
    const result = await finalizeOnboarding()
    setIsLoading(false)
    if (!result.ok) { setServerError(result.error); return }
    // Navigate to dashboard after finalization
    window.location.href = "/dashboard"
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-muted-foreground">
        Review everything below. Click the pencil icon on any section to go back and edit.
        When you're satisfied, click <strong>Confirm & Save</strong> to lock this profile and begin uploading statements.
      </p>

      {/* Step 1 — Basics */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Basics</h4>
        <SectionRow label="Tax year" value={data.year ?? "—"} onEdit={() => onJumpToStep(1)} />
        <SectionRow
          label="Entity type"
          value={data.entityType === "SOLE_PROP" ? "Sole Proprietor" : data.entityType === "LLC_SINGLE" ? "Single-Member LLC" : "—"}
          onEdit={() => onJumpToStep(1)}
        />
        <SectionRow label="Primary state" value={stateName} onEdit={() => onJumpToStep(1)} />
        <SectionRow label="Accounting method" value={data.accountingMethod ?? "CASH"} onEdit={() => onJumpToStep(1)} />
        <SectionRow
          label="First year of business"
          value={data.firstYear ? <Badge variant="secondary">Yes — §195 start-up costs apply</Badge> : "No"}
          onEdit={() => onJumpToStep(1)}
        />
      </div>

      {/* Step 2 — Business */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Business description</h4>
        <SectionRow label="Description" value={data.businessDescription ?? "—"} onEdit={() => onJumpToStep(2)} />
        <SectionRow
          label="NAICS"
          value={data.naicsCode ? `${data.naicsCode}${naicsLabel ? ` — ${naicsLabel}` : ""}` : "—"}
          onEdit={() => onJumpToStep(2)}
        />
      </div>

      {/* Step 3 — Revenue */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Revenue profile</h4>
        <SectionRow
          label="Revenue streams"
          value={(data.revenueStreams ?? []).length > 0
            ? <div className="flex flex-wrap gap-1">{(data.revenueStreams ?? []).map((s) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)}</div>
            : "—"}
          onEdit={() => onJumpToStep(3)}
        />
        <SectionRow
          label="Gross receipts estimate"
          value={data.grossReceiptsEstimate != null ? `$${data.grossReceiptsEstimate.toLocaleString()}` : "—"}
          onEdit={() => onJumpToStep(3)}
        />
      </div>

      {/* Step 4 — Home office */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Home office</h4>
        <SectionRow
          label="Home office"
          value={!homeOfc?.has ? "No" : `Yes — ${homeOfc.dedicated ? "dedicated room" : "separate structure"}, ${homeOfc.officeSqft} sq ft (home: ${homeOfc.homeSqft} sq ft)`}
          onEdit={() => onJumpToStep(4)}
        />
      </div>

      {/* Step 5 — Vehicle */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Vehicle</h4>
        <SectionRow
          label="Vehicle use"
          value={!vehicle?.has ? "No vehicle" : vehicle.bizPct === 100 ? "Dedicated business vehicle (100%)" : `Mixed use — ${vehicle.bizPct ?? 0}% business`}
          onEdit={() => onJumpToStep(5)}
        />
      </div>

      {/* Step 6 — Inventory */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Inventory</h4>
        <SectionRow
          label="Inventory"
          value={!inventory || !inventory.has ? "No inventory" : inventory.dropship ? "Dropship (no physical hold)" : "Physical inventory"}
          onEdit={() => onJumpToStep(6)}
        />
      </div>

      {/* Step 7 — Trips */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Business trips ({(data.trips ?? []).length})</h4>
        {(data.trips ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No trips added.</p>
        ) : (
          (data.trips ?? []).map((t, i) => (
            <div key={i} className="py-1 border-b last:border-0">
              <p className="text-sm font-medium">{t.name} — {t.destination}</p>
              <p className="text-xs text-muted-foreground">{t.startDate} → {t.endDate} · {t.isConfirmed ? "✓ Confirmed" : "Unconfirmed"}</p>
            </div>
          ))
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => onJumpToStep(7)} className="mt-1">
          <Pencil className="h-3 w-3 mr-1" /> Edit trips
        </Button>
      </div>

      {/* Step 8 — Entities */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Known entities ({(data.knownEntities ?? []).length})</h4>
        {(data.knownEntities ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No entities added.</p>
        ) : (
          (data.knownEntities ?? []).map((e, i) => (
            <div key={i} className="py-1 border-b last:border-0">
              <p className="text-sm font-medium">{e.displayName} <Badge variant="outline" className="text-xs ml-1">{e.kind}</Badge></p>
              <p className="text-xs text-muted-foreground">Keywords: {e.matchKeywords.join(", ")}</p>
            </div>
          ))
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => onJumpToStep(8)} className="mt-1">
          <Pencil className="h-3 w-3 mr-1" /> Edit entities
        </Button>
      </div>

      {/* Step 9 — Income sources */}
      <div className="border rounded-lg p-4 space-y-1">
        <h4 className="font-semibold text-sm mb-2">Expected income sources ({(data.incomeSources ?? []).length})</h4>
        {(data.incomeSources ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">No income sources added.</p>
        ) : (
          (data.incomeSources ?? []).map((s, i) => (
            <div key={i} className="py-1 border-b last:border-0">
              <p className="text-sm font-medium">{s.platform} — ${s.expectedTotal.toLocaleString()}</p>
              <p className="text-xs text-muted-foreground">{s.categories.join(", ") || "No categories"}</p>
            </div>
          ))
        )}
        <Button type="button" variant="ghost" size="sm" onClick={() => onJumpToStep(9)} className="mt-1">
          <Pencil className="h-3 w-3 mr-1" /> Edit income sources
        </Button>
      </div>

      {serverError && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{serverError}</AlertDescription>
        </Alert>
      )}

      <div className="flex justify-between">
        <Button type="button" variant="outline" onClick={onBack}>← Back</Button>
        <Button type="button" onClick={handleFinalize} disabled={isLoading} className="gap-2">
          <CheckCircle2 className="h-4 w-4" />
          {isLoading ? "Saving…" : "Confirm & Save"}
        </Button>
      </div>
    </div>
  )
}
