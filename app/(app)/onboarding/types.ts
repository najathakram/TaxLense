// TaxLens — Onboarding wizard shared types

export type HomeOfficeConfig = {
  has: boolean
  dedicated?: boolean
  officeSqft?: number
  homeSqft?: number
}

export type VehicleConfig = {
  has: boolean
  bizPct?: number
}

export type InventoryConfig = {
  has: boolean
  physical?: boolean
  dropship?: boolean
} | null

export type TripFormData = {
  id?: string
  name: string
  destination: string
  startDate: string
  endDate: string
  purpose: string
  deliverableDescription?: string
  isConfirmed: boolean
}

export type KnownEntityFormData = {
  id?: string
  kind: "PERSON_PERSONAL" | "PERSON_CONTRACTOR" | "PERSON_CLIENT" | "PATTERN_EXCLUDED" | "PATTERN_INCOME"
  displayName: string
  matchKeywords: string[]
  defaultCode?: string | null
  notes?: string
}

export type IncomeSourceFormData = {
  platform: string
  expectedTotal: number
  categories: string[]
}

export type WizardData = {
  year: number
  entityType: "SOLE_PROP" | "LLC_SINGLE"
  primaryState: string
  accountingMethod: "CASH" | "ACCRUAL"
  firstYear: boolean
  businessDescription: string
  naicsCode: string
  revenueStreams: string[]
  grossReceiptsEstimate: number
  homeOfficeConfig: HomeOfficeConfig
  vehicleConfig: VehicleConfig
  inventoryConfig: InventoryConfig
  trips: TripFormData[]
  knownEntities: KnownEntityFormData[]
  incomeSources: IncomeSourceFormData[]
}

export type ActionResult = { ok: true } | { ok: false; error: string }
