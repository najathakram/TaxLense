"use client"

import { useState, useTransition } from "react"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Pencil } from "lucide-react"
import { US_STATES, TOP_NAICS_CODES } from "@/app/(app)/onboarding/constants"
import { saveProfileEdit, saveLegalName } from "@/app/(app)/onboarding/actions"
import Step1 from "@/app/(app)/onboarding/steps/step1"
import Step2 from "@/app/(app)/onboarding/steps/step2"
import Step3 from "@/app/(app)/onboarding/steps/step3"
import Step4 from "@/app/(app)/onboarding/steps/step4"
import Step5 from "@/app/(app)/onboarding/steps/step5"
import Step6 from "@/app/(app)/onboarding/steps/step6"
import Step7 from "@/app/(app)/onboarding/steps/step7"
import Step8 from "@/app/(app)/onboarding/steps/step8"
import Step9 from "@/app/(app)/onboarding/steps/step9"
import type { WizardData } from "@/app/(app)/onboarding/types"

type Props = {
  profileData: Partial<WizardData>
  legalName?: string
  email?: string
}

export default function ProfileEditClient({ profileData, legalName: initialLegalName = "", email = "" }: Props) {
  const [data, setData] = useState<Partial<WizardData>>(profileData)
  const [editStep, setEditStep] = useState<number | null>(null)
  const [legalName, setLegalName] = useState(initialLegalName)
  const [legalNameDraft, setLegalNameDraft] = useState(initialLegalName)
  const [legalNameDialogOpen, setLegalNameDialogOpen] = useState(false)
  const [legalNameError, setLegalNameError] = useState<string | null>(null)
  const [isSavingLegalName, startSavingLegalName] = useTransition()

  const handleSave = (stepData: Partial<WizardData>) => {
    setData((prev) => ({ ...prev, ...stepData }))
    setEditStep(null)
  }

  // Wrap each step's onNext to go through saveProfileEdit as well
  const makeOnNext = (step: number) => async (stepData: Partial<WizardData>) => {
    await saveProfileEdit(step, stepData)
    handleSave(stepData)
  }

  const stateName = US_STATES.find((s) => s.value === data.primaryState)?.label ?? data.primaryState ?? "—"
  const naicsLabel = TOP_NAICS_CODES.find((c) => c.code === data.naicsCode)?.label

  function Section({ title, step, children }: { title: string; step: number; children: React.ReactNode }) {
    return (
      <div className="border rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">{title}</h3>
          <Button variant="ghost" size="sm" onClick={() => setEditStep(step)}>
            <Pencil className="h-3 w-3 mr-1" /> Edit
          </Button>
        </div>
        {children}
      </div>
    )
  }

  const handleSaveLegalName = () => {
    setLegalNameError(null)
    startSavingLegalName(async () => {
      const trimmed = legalNameDraft.trim()
      if (!trimmed) {
        setLegalNameError("Legal name is required")
        return
      }
      const res = await saveLegalName({ name: trimmed })
      if (!res.ok) {
        setLegalNameError(res.error)
        return
      }
      setLegalName(trimmed)
      setLegalNameDialogOpen(false)
    })
  }

  return (
    <div className="space-y-4">
      <div className="border rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-sm">Identity</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setLegalNameDraft(legalName)
              setLegalNameError(null)
              setLegalNameDialogOpen(true)
            }}
          >
            <Pencil className="h-3 w-3 mr-1" /> Edit name
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Legal name</dt>
          <dd>{legalName || <span className="text-muted-foreground italic">Not set</span>}</dd>
          <dt className="text-muted-foreground">Email</dt>
          <dd className="font-mono text-xs">{email || "—"}</dd>
        </dl>
      </div>

      <Section title="Basics" step={1}>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
          <dt className="text-muted-foreground">Tax year</dt><dd>{data.year}</dd>
          <dt className="text-muted-foreground">Entity type</dt><dd>{data.entityType === "SOLE_PROP" ? "Sole Proprietor" : "Single-Member LLC"}</dd>
          <dt className="text-muted-foreground">State</dt><dd>{stateName}</dd>
          <dt className="text-muted-foreground">Accounting</dt><dd>{data.accountingMethod}</dd>
          <dt className="text-muted-foreground">First year</dt><dd>{data.firstYear ? "Yes" : "No"}</dd>
        </dl>
      </Section>

      <Section title="Business description" step={2}>
        <p className="text-sm">{data.businessDescription || <span className="text-muted-foreground italic">Not set</span>}</p>
        <p className="text-xs text-muted-foreground">
          NAICS: {data.naicsCode ? `${data.naicsCode}${naicsLabel ? ` — ${naicsLabel}` : ""}` : "Not set"}
        </p>
      </Section>

      <Section title="Revenue profile" step={3}>
        <div className="flex flex-wrap gap-1">
          {(data.revenueStreams ?? []).length > 0
            ? (data.revenueStreams ?? []).map((s) => <Badge key={s} variant="outline" className="text-xs">{s}</Badge>)
            : <span className="text-sm text-muted-foreground">Not set</span>}
        </div>
        <p className="text-sm">Gross receipts est.: {data.grossReceiptsEstimate != null ? `$${data.grossReceiptsEstimate.toLocaleString()}` : "Not set"}</p>
      </Section>

      <Section title="Home office" step={4}>
        <p className="text-sm">
          {!data.homeOfficeConfig?.has
            ? "No home office"
            : `Yes — ${data.homeOfficeConfig.dedicated ? "dedicated" : "separate structure"}, ${data.homeOfficeConfig.officeSqft} sq ft`}
        </p>
      </Section>

      <Section title="Vehicle" step={5}>
        <p className="text-sm">
          {!data.vehicleConfig?.has
            ? "No vehicle"
            : `${data.vehicleConfig.bizPct === 100 ? "Dedicated (100%)" : `Mixed use — ${data.vehicleConfig.bizPct}% business`}`}
        </p>
      </Section>

      <Section title="Inventory" step={6}>
        <p className="text-sm">
          {!data.inventoryConfig?.has ? "No inventory" : data.inventoryConfig.dropship ? "Dropship" : "Physical"}
        </p>
      </Section>

      <Section title={`Business trips (${(data.trips ?? []).length})`} step={7}>
        {(data.trips ?? []).length === 0
          ? <p className="text-sm text-muted-foreground">No trips added.</p>
          : (data.trips ?? []).map((t, i) => (
            <div key={i} className="text-sm border-b pb-1 mb-1 last:border-0">
              <strong>{t.name}</strong> — {t.destination} ({t.startDate} → {t.endDate})
            </div>
          ))}
      </Section>

      <Section title={`Known entities (${(data.knownEntities ?? []).length})`} step={8}>
        {(data.knownEntities ?? []).length === 0
          ? <p className="text-sm text-muted-foreground">No entities added.</p>
          : (data.knownEntities ?? []).map((e, i) => (
            <div key={i} className="text-sm border-b pb-1 mb-1 last:border-0">
              <strong>{e.displayName}</strong> <Badge variant="outline" className="text-xs">{e.kind}</Badge>
              <span className="text-muted-foreground ml-2">{e.matchKeywords.join(", ")}</span>
            </div>
          ))}
      </Section>

      <Section title={`Income sources (${(data.incomeSources ?? []).length})`} step={9}>
        {(data.incomeSources ?? []).length === 0
          ? <p className="text-sm text-muted-foreground">No income sources added.</p>
          : (data.incomeSources ?? []).map((s, i) => (
            <div key={i} className="text-sm border-b pb-1 mb-1 last:border-0">
              <strong>{s.platform}</strong> — ${s.expectedTotal.toLocaleString()}
            </div>
          ))}
      </Section>

      {/* Legal name edit dialog */}
      <Dialog open={legalNameDialogOpen} onOpenChange={(o) => !o && setLegalNameDialogOpen(false)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Edit legal name</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="legal-name">Legal name</Label>
              <Input
                id="legal-name"
                value={legalNameDraft}
                onChange={(e) => setLegalNameDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") handleSaveLegalName() }}
                disabled={isSavingLegalName}
                autoFocus
              />
            </div>
            {legalNameError && (
              <p className="text-sm text-destructive">{legalNameError}</p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setLegalNameDialogOpen(false)} disabled={isSavingLegalName}>
                Cancel
              </Button>
              <Button onClick={handleSaveLegalName} disabled={isSavingLegalName}>
                {isSavingLegalName ? "Saving…" : "Save"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={editStep !== null} onOpenChange={(o) => !o && setEditStep(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              Edit — {editStep === 1 ? "Basics" : editStep === 2 ? "Business description" : editStep === 3 ? "Revenue profile" : editStep === 4 ? "Home office" : editStep === 5 ? "Vehicle" : editStep === 6 ? "Inventory" : editStep === 7 ? "Business trips" : editStep === 8 ? "Known entities" : "Income sources"}
            </DialogTitle>
          </DialogHeader>
          <div className="mt-4">
            {editStep === 1 && <Step1 data={data} onNext={makeOnNext(1)} />}
            {editStep === 2 && <Step2 data={data} onNext={makeOnNext(2)} onBack={() => setEditStep(null)} />}
            {editStep === 3 && <Step3 data={data} onNext={makeOnNext(3)} onBack={() => setEditStep(null)} />}
            {editStep === 4 && <Step4 data={data} onNext={makeOnNext(4)} onBack={() => setEditStep(null)} />}
            {editStep === 5 && <Step5 data={data} onNext={makeOnNext(5)} onBack={() => setEditStep(null)} />}
            {editStep === 6 && <Step6 data={data} onNext={makeOnNext(6)} onBack={() => setEditStep(null)} />}
            {editStep === 7 && <Step7 data={data} onNext={makeOnNext(7)} onBack={() => setEditStep(null)} />}
            {editStep === 8 && <Step8 data={data} onNext={makeOnNext(8)} onBack={() => setEditStep(null)} />}
            {editStep === 9 && <Step9 data={data} onNext={makeOnNext(9)} onBack={() => setEditStep(null)} />}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
