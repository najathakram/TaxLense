/**
 * Form Registry — single source of truth for "which entity files which form,
 * with which line set, and whether shareholders/partners get a K-1."
 *
 * Replaces the hard-coded SCHEDULE_C_LINES assumption that was scattered
 * through the codebase. The CPA agent reads this map; the report builders
 * branch on it; the onboarding wizard renders allowed entity choices from
 * the same source.
 *
 * Phase 2 ships SOLE_PROP / LLC_SINGLE (Schedule C) and S_CORP (Form 1120-S
 * + K-1). Phases 3/4 add LLC_MULTI (Form 1065 + K-1) and C_CORP (Form 1120).
 *
 * Line strings are the strings the AI uses verbatim in its `scheduleLine`
 * field — they read like the on-form labels so the generated PDFs can
 * render them as-is.
 */

import { SCHEDULE_C_LINES } from "@/lib/classification/constants"

// IRS Form 1120-S (S-Corp income tax return) — line numbers per 2025 form.
export const FORM_1120S_LINES: string[] = [
  // Page 1 income section
  "1a Gross receipts or sales",
  "1b Returns and allowances",
  "2 Cost of goods sold",
  "3 Gross profit",
  "4 Net gain (loss) from Form 4797",
  "5 Other income (loss)",
  // Page 1 deductions section
  "7 Compensation of officers",
  "8 Salaries and wages (less employment credits)",
  "9 Repairs and maintenance",
  "10 Bad debts",
  "11 Rents",
  "12 Taxes and licenses",
  "13 Interest expense",
  "14 Depreciation",
  "15 Depletion",
  "16 Advertising",
  "17 Pension, profit-sharing, etc., plans",
  "18 Employee benefit programs",
  "19 Other deductions",
  // Schedule K — separately stated items
  "K-1 Box 1 Ordinary business income (loss)",
  "K-1 Box 2 Net rental real estate income (loss)",
  "K-1 Box 3 Other net rental income (loss)",
  "K-1 Box 4 Interest income",
  "K-1 Box 5a Ordinary dividends",
  "K-1 Box 11 Section 179 deduction",
  "K-1 Box 12 Other deductions (charitable, §59(e), §163(j) interest)",
  "K-1 Box 16 Items affecting shareholder basis",
  "K-1 Box 17 Other information",
]

// IRS Form 1065 (partnership return) — line numbers per 2025 form.
export const FORM_1065_LINES: string[] = [
  "1a Gross receipts or sales",
  "1b Returns and allowances",
  "2 Cost of goods sold",
  "3 Gross profit",
  "4 Ordinary income (loss) from other partnerships",
  "5 Net farm profit (loss)",
  "6 Net gain (loss) from Form 4797",
  "7 Other income (loss)",
  "9 Salaries and wages (less employment credits)",
  "10 Guaranteed payments to partners",
  "11 Repairs and maintenance",
  "12 Bad debts",
  "13 Rent",
  "14 Taxes and licenses",
  "15 Interest expense",
  "16a Depreciation",
  "17 Depletion",
  "18 Retirement plans",
  "19 Employee benefit programs",
  "20 Other deductions",
  // Schedule K — separately stated items per partner
  "K-1 Box 1 Ordinary business income (loss)",
  "K-1 Box 2 Net rental real estate income (loss)",
  "K-1 Box 4a Guaranteed payments for services",
  "K-1 Box 5 Interest income",
  "K-1 Box 6a Ordinary dividends",
  "K-1 Box 12 Section 179 deduction",
  "K-1 Box 13 Other deductions",
  "K-1 Box 14 Self-employment earnings (loss)",
  "K-1 Box 19 Distributions",
  "K-1 Box 20 Other information",
]

// IRS Form 1120 (C-Corp income tax return) — line numbers per 2025 form.
export const FORM_1120_LINES: string[] = [
  "1a Gross receipts or sales",
  "1b Returns and allowances",
  "2 Cost of goods sold",
  "3 Gross profit",
  "4 Dividends and inclusions",
  "5 Interest",
  "6 Gross rents",
  "7 Gross royalties",
  "8 Capital gain net income",
  "9 Net gain (loss) from Form 4797",
  "10 Other income",
  "12 Compensation of officers",
  "13 Salaries and wages (less employment credits)",
  "14 Repairs and maintenance",
  "15 Bad debts",
  "16 Rents",
  "17 Taxes and licenses",
  "18 Interest",
  "19 Charitable contributions",
  "20 Depreciation",
  "21 Depletion",
  "22 Advertising",
  "23 Pension, profit-sharing, etc., plans",
  "24 Employee benefit programs",
  "26 Other deductions",
  "29a Net operating loss deduction",
  "29b Special deductions",
]

// Database EntityType enum mirror (keep in sync with prisma/schema.prisma).
type EntityKey = "SOLE_PROP" | "LLC_SINGLE" | "S_CORP" | "LLC_MULTI" | "C_CORP" | "PARTNERSHIP"

export interface FormSpec {
  /** Display name of the primary return form. */
  primaryReturn: string
  /** Allowed `scheduleLine` values for this entity, in display order. */
  lines: string[]
  /** Whether this entity issues Schedule K-1 to owners. */
  k1: boolean
  /** Whether the owner pays SE tax on the entity's net income. */
  seTax: boolean
  /** Whether the entity must run owner-payroll (W-2) to claim deductions. */
  requiresOwnerPayroll: boolean
  /** Whether this entity is supported in the current build. */
  supported: boolean
  /** Friendly name for entity-selection UIs. */
  displayName: string
  /** Short description for tooltips / wizard help text. */
  description: string
}

export const FORM_REGISTRY: Record<EntityKey, FormSpec> = {
  SOLE_PROP: {
    primaryReturn: "Schedule C (Form 1040)",
    lines: SCHEDULE_C_LINES,
    k1: false,
    seTax: true,
    requiresOwnerPayroll: false,
    supported: true,
    displayName: "Sole Proprietor",
    description: "Self-employed individual filing Schedule C with their personal Form 1040. Pays SE tax on net Schedule C income.",
  },
  LLC_SINGLE: {
    primaryReturn: "Schedule C (Form 1040, disregarded)",
    lines: SCHEDULE_C_LINES,
    k1: false,
    seTax: true,
    requiresOwnerPayroll: false,
    supported: true,
    displayName: "Single-Member LLC (disregarded entity)",
    description: "Single-owner LLC treated as a disregarded entity for tax purposes. Files Schedule C on the owner's 1040.",
  },
  S_CORP: {
    primaryReturn: "Form 1120-S",
    lines: FORM_1120S_LINES,
    k1: true,
    seTax: false,
    requiresOwnerPayroll: true,
    supported: true,
    displayName: "S-Corporation",
    description: "Pass-through corporation. Files Form 1120-S; income/deductions flow to shareholders via K-1. Owner W-2 required (reasonable comp).",
  },
  LLC_MULTI: {
    primaryReturn: "Form 1065 (partnership)",
    lines: FORM_1065_LINES,
    k1: true,
    seTax: true,
    requiresOwnerPayroll: false,
    supported: true,
    displayName: "Multi-Member LLC (taxed as partnership)",
    description: "Multi-owner LLC default-taxed as partnership. Files Form 1065; income/deductions flow to partners via K-1. General partners pay SE tax.",
  },
  C_CORP: {
    primaryReturn: "Form 1120",
    lines: FORM_1120_LINES,
    k1: false,
    seTax: false,
    requiresOwnerPayroll: true,
    supported: true,
    displayName: "C-Corporation",
    description: "Standalone taxable corporation. Files Form 1120 at 21% flat rate. Officers paid via W-2; dividends reported on 1099-DIV.",
  },
  PARTNERSHIP: {
    primaryReturn: "Form 1065 (general partnership)",
    lines: FORM_1065_LINES,
    k1: true,
    seTax: true,
    requiresOwnerPayroll: false,
    supported: false,
    displayName: "General Partnership (not LLC)",
    description: "Two or more partners without limited liability. Files Form 1065; all partners pay SE tax on K-1 ordinary income.",
  },
}

export function getFormSpec(entityType: string | null | undefined): FormSpec {
  if (!entityType) return FORM_REGISTRY.SOLE_PROP
  const spec = FORM_REGISTRY[entityType as EntityKey]
  return spec ?? FORM_REGISTRY.SOLE_PROP
}

/** Entity types selectable in onboarding right now. */
export function supportedEntityTypes(): EntityKey[] {
  return (Object.keys(FORM_REGISTRY) as EntityKey[]).filter((k) => FORM_REGISTRY[k].supported)
}

/**
 * Short column-header label per entity. Drives the ledger's form-line column
 * header and the STOP merchant-form line picker so an S-Corp user sees
 * "Form 1120-S Line" instead of "Sch C Line".
 */
export function formLineLabel(entityType: string | null | undefined): string {
  switch (entityType) {
    case "S_CORP":
      return "Form 1120-S Line"
    case "LLC_MULTI":
    case "PARTNERSHIP":
      return "Form 1065 Line"
    case "C_CORP":
      return "Form 1120 Line"
    case "SOLE_PROP":
    case "LLC_SINGLE":
    default:
      return "Sch C Line"
  }
}
