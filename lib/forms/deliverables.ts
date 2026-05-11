/**
 * Deliverables registry — for a given entity type and ledger snapshot,
 * computes the full list of artifacts that should be generated at lock
 * time, with each item's required/triggered/blocked state.
 *
 * Single source of truth for the Final Dump panel (server + client),
 * the Audit Packet builder, and the Tax Package builder.
 *
 * Trigger evaluation is PURE — it reads pre-fetched LedgerSummary +
 * BusinessProfile + Owner data, never the DB directly. That makes the
 * panel's reactivity instant and deterministic across renders.
 *
 * Authority citations follow IRC § / Reg / Rev. Proc. format and reflect
 * TY2025 IRS rules (post-OBBBA).
 */

import { getFormSpec } from "@/lib/forms/registry"

export type EntityType =
  | "SOLE_PROP"
  | "LLC_SINGLE"
  | "S_CORP"
  | "LLC_MULTI"
  | "C_CORP"
  | "PARTNERSHIP"

export type DeliverableGroup = "TAX" | "ACCOUNTING" | "INFO_RETURN" | "WORKFLOW" | "STATE"

export interface Deliverable {
  formId: string
  displayName: string
  group: DeliverableGroup
  /** Triggered = the rule says this entity needs it given current ledger state. */
  triggered: boolean
  /** Required = if triggered, must be in the dump (vs. optional/skipped). */
  required: boolean
  /** Skipped reason — shown when triggered=false. Improves CPA confidence
   *  that the system considered the form. */
  skipReason?: string
  /** Blockers prevent dump generation for this item. Shown as red bullets
   *  in the panel; if any blocker exists across the bundle, the dump
   *  button is disabled. */
  blockers: string[]
  /** Authority citation for the audit-packet README. */
  authority: string
  /** Form revision — pinned per tax year so re-generation in 2027 of a
   *  2025 lock uses TY2025 forms. */
  formRevision?: string
}

export interface LedgerSummary {
  /** Sum of BIZ_INCOME classifications, dollars (positive). */
  grossReceipts: number
  /** Sum of all deductible classifications, dollars (positive). */
  totalDeductions: number
  /** Schedule C Line 31 net profit / loss, dollars (signed). */
  netProfit: number
  /** Average / total assets — used for Schedule L threshold ($250K). */
  totalAssets: number
  /** True if any classification has scheduleCLine starting with 'Part III COGS'. */
  hasCOGS: boolean
  /** True if any depreciation rows exist (4562 trigger). */
  hasDepreciation: boolean
  /** True if BusinessProfile.homeOfficeConfig.has === true (8829 trigger). */
  hasHomeOffice: boolean
  /** Method override: "ACTUAL" requires Form 8829; "SIMPLIFIED" is a
   *  Schedule C line-30 calc only (no separate form). */
  homeOfficeMethod: "ACTUAL" | "SIMPLIFIED" | null
  /** Net SE earnings × 92.35% — Schedule SE trigger when ≥ $400. */
  netSeEarnings: number
  /** Number of payroll runs found (W-2 employees / S-Corp officer comp). */
  payrollRunCount: number
  /** Contractor candidates: payee → annual total ($) for 1099-NEC. */
  contractorCandidates: Array<{ payee: string; totalDollars: number; missingTin: boolean }>
  /** Has any rent / royalty payment ≥ $600 to a non-corporation (1099-MISC). */
  has1099MiscCandidate: boolean
}

export interface OwnerSummary {
  count: number
  /** True if every owner has SSN/EIN + capital contribution recorded. */
  allOwnersComplete: boolean
}

export interface DeliverableContext {
  entityType: EntityType
  state: string                     // "TX", "CA", etc. Empty string = unknown.
  taxYear: number
  ledger: LedgerSummary
  owners: OwnerSummary
  /** True if assertion run currently passes (all blocking checks ok). */
  assertionsPass: boolean
}

// ── TY2025 thresholds (per IRS guidance) ─────────────────────────────────────
const SCHEDULE_L_THRESHOLD_DOLLARS = 250_000
const SCHEDULE_M3_THRESHOLD_DOLLARS = 10_000_000
const SE_TAX_THRESHOLD_DOLLARS = 400
const FORM_1099_NEC_THRESHOLD_DOLLARS = 600

// IRS Notice 2024-85: TY2025 1099-K reporting threshold is $2,500
// (transitional; reverts to $600 in TY2026 absent further guidance).
const FORM_1099_K_THRESHOLD_DOLLARS_TY2025 = 2_500

// ── Builder ──────────────────────────────────────────────────────────────────

export function buildDeliverableList(ctx: DeliverableContext): Deliverable[] {
  const list: Deliverable[] = []

  switch (ctx.entityType) {
    case "SOLE_PROP":
    case "LLC_SINGLE":
      list.push(...soleProprietorBundle(ctx))
      break
    case "S_CORP":
      list.push(...sCorpBundle(ctx))
      break
    case "LLC_MULTI":
    case "PARTNERSHIP":
      list.push(...partnershipBundle(ctx))
      break
    case "C_CORP":
      list.push(...cCorpBundle(ctx))
      break
  }

  // Always-on: 1099 information returns (any entity)
  list.push(...informationReturnsBundle(ctx))

  // Always-on: accounting statements (any entity)
  list.push(...accountingStatementsBundle(ctx))

  // Always-on: workflow/audit (any entity)
  list.push(...workflowBundle(ctx))

  // State layer
  list.push(...stateLayerBundle(ctx))

  return list
}

// ── SOLE_PROP / LLC_SINGLE bundle ───────────────────────────────────────────

function soleProprietorBundle(ctx: DeliverableContext): Deliverable[] {
  const seTriggered = ctx.ledger.netSeEarnings >= SE_TAX_THRESHOLD_DOLLARS
  return [
    {
      formId: "schedule-c",
      displayName: "Schedule C (Profit or Loss from Business)",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "IRC §1402; Reg §1.6017-1; Schedule C (Form 1040) Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "schedule-se",
      displayName: "Schedule SE (Self-Employment Tax)",
      group: "TAX",
      triggered: seTriggered,
      required: seTriggered,
      skipReason: seTriggered
        ? undefined
        : `Net SE earnings $${ctx.ledger.netSeEarnings.toFixed(0)} below $${SE_TAX_THRESHOLD_DOLLARS} threshold (IRC §1402(b))`,
      blockers: [],
      authority: "IRC §1401, §1402; Schedule SE (Form 1040) Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-8995",
      displayName: "Form 8995 (QBI Simplified)",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "IRC §199A; Reg §1.199A-1; Form 8995 Instructions Rev. 2025. TY2025 threshold $241,950 single / $483,900 MFJ — over: use 8995-A.",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-8829",
      displayName: "Form 8829 (Expenses for Business Use of Home)",
      group: "TAX",
      triggered: ctx.ledger.hasHomeOffice && ctx.ledger.homeOfficeMethod === "ACTUAL",
      required: ctx.ledger.hasHomeOffice && ctx.ledger.homeOfficeMethod === "ACTUAL",
      skipReason: !ctx.ledger.hasHomeOffice
        ? "No home office configured in BusinessProfile"
        : ctx.ledger.homeOfficeMethod === "SIMPLIFIED"
          ? "Simplified method elected (§280A safe harbor) — claim on Schedule C Line 30 directly, no 8829 required"
          : undefined,
      blockers: [],
      authority: "IRC §280A; Rev. Proc. 2013-13 (simplified method); Form 8829 Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-4562",
      displayName: "Form 4562 (Depreciation and Amortization)",
      group: "TAX",
      triggered: ctx.ledger.hasDepreciation,
      required: ctx.ledger.hasDepreciation,
      skipReason: ctx.ledger.hasDepreciation ? undefined : "No depreciation classifications found",
      blockers: [],
      authority:
        "IRC §167, §168, §179; Form 4562 Instructions Rev. 2025. TY2025 §168(k) bonus = 40% (post-OBBBA phase-down). §179 cap $1,250,000 (Rev. Proc. 2024-40).",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-1125-a",
      displayName: "Form 1125-A (Cost of Goods Sold)",
      group: "TAX",
      triggered: ctx.ledger.hasCOGS,
      required: ctx.ledger.hasCOGS,
      skipReason: ctx.ledger.hasCOGS ? undefined : "No COGS classifications",
      blockers: [],
      authority: "IRC §263A; Reg §1.471-1; Form 1125-A Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "schedule-1",
      displayName: "Schedule 1 (Form 1040) — Additional Income & Adjustments",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "Form 1040 Instructions Rev. 2025 (carries SE-tax deduction, SE health-ins, retirement contrib, NOL carryforward)",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-1040es",
      displayName: "Form 1040-ES (Estimated Tax Vouchers — next year)",
      group: "TAX",
      triggered: ctx.ledger.netSeEarnings >= 1_000,
      required: false,
      skipReason: ctx.ledger.netSeEarnings >= 1_000 ? undefined : "Estimated tax not required when net SE < $1,000",
      blockers: [],
      authority: "IRC §6654; Form 1040-ES Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
  ]
}

// ── S_CORP bundle ─────────────────────────────────────────────────────────────

function sCorpBundle(ctx: DeliverableContext): Deliverable[] {
  const meetsScheduleL =
    ctx.ledger.grossReceipts >= SCHEDULE_L_THRESHOLD_DOLLARS &&
    ctx.ledger.totalAssets >= SCHEDULE_L_THRESHOLD_DOLLARS
  const meetsScheduleM3 = ctx.ledger.totalAssets >= SCHEDULE_M3_THRESHOLD_DOLLARS
  const meetsSchedM1 =
    ctx.ledger.grossReceipts >= SCHEDULE_L_THRESHOLD_DOLLARS ||
    ctx.ledger.totalAssets >= SCHEDULE_L_THRESHOLD_DOLLARS

  const noPayrollBlocker =
    ctx.ledger.payrollRunCount === 0
      ? "No payroll runs found in tax year — S-Corp officer must take reasonable compensation per Rev. Rul. 59-221. Add payroll or attest no services performed."
      : null

  return [
    {
      formId: "form-1120s",
      displayName: "Form 1120-S (S-Corporation Income Tax Return)",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: noPayrollBlocker ? [noPayrollBlocker] : [],
      authority: "IRC §1361, §1366; Reg §1.6037-1; Form 1120-S Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-k-1120s",
      displayName: "Schedule K (Form 1120-S) — Shareholders' Pro Rata Share",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "IRC §1366(a); Reg §1.1366-1; Form 1120-S Schedule K Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-k1-1120s",
      displayName: `Schedule K-1 (Form 1120-S) × ${Math.max(ctx.owners.count, 1)} shareholder(s)`,
      group: "TAX",
      triggered: true,
      required: true,
      blockers: ctx.owners.count === 0
        ? ["No shareholders configured — add at least one Shareholder before generating K-1s"]
        : ctx.owners.allOwnersComplete
          ? []
          : ["One or more shareholders missing SSN/EIN or capital contribution"],
      authority: "IRC §1366; Reg §1.6037-2; Schedule K-1 (Form 1120-S) Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-m1-1120s",
      displayName: "Schedule M-1 (Form 1120-S) — Reconciliation of Income/Loss per Books",
      group: "TAX",
      triggered: meetsSchedM1,
      required: meetsSchedM1,
      skipReason: meetsSchedM1
        ? undefined
        : `Optional unless gross receipts ≥ $${SCHEDULE_L_THRESHOLD_DOLLARS.toLocaleString()} OR assets ≥ $${SCHEDULE_L_THRESHOLD_DOLLARS.toLocaleString()}`,
      blockers: [],
      authority: "Form 1120-S Instructions Rev. 2025; Schedule B questions 11a-11c",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-m2-1120s",
      displayName: "Schedule M-2 (Form 1120-S) — AAA / OAA / Shareholders' Undistributed",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "IRC §1368; Reg §1.1368-2; Form 1120-S Schedule M-2 Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-l-1120s",
      displayName: "Schedule L (Form 1120-S) — Balance Sheet per Books",
      group: "TAX",
      triggered: meetsScheduleL,
      required: meetsScheduleL,
      skipReason: meetsScheduleL
        ? undefined
        : `Optional unless gross receipts ≥ $${SCHEDULE_L_THRESHOLD_DOLLARS.toLocaleString()} AND assets ≥ $${SCHEDULE_L_THRESHOLD_DOLLARS.toLocaleString()}`,
      blockers: [],
      authority: "Form 1120-S Instructions Rev. 2025; Schedule B questions 11a-11c",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-m3-1120s",
      displayName: "Schedule M-3 (Form 1120-S) — Net Income (Loss) Reconciliation",
      group: "TAX",
      triggered: meetsScheduleM3,
      required: meetsScheduleM3,
      skipReason: meetsScheduleM3 ? undefined : `Required only when total assets ≥ $${SCHEDULE_M3_THRESHOLD_DOLLARS.toLocaleString()}`,
      blockers: [],
      authority: "Schedule M-3 (Form 1120-S) Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "form-4562",
      displayName: "Form 4562 (Depreciation and Amortization)",
      group: "TAX",
      triggered: ctx.ledger.hasDepreciation,
      required: ctx.ledger.hasDepreciation,
      skipReason: ctx.ledger.hasDepreciation ? undefined : "No depreciation classifications found",
      blockers: [],
      authority: "IRC §167, §168, §179; Form 4562 Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-1125-a",
      displayName: "Form 1125-A (Cost of Goods Sold)",
      group: "TAX",
      triggered: ctx.ledger.hasCOGS,
      required: ctx.ledger.hasCOGS,
      skipReason: ctx.ledger.hasCOGS ? undefined : "No COGS classifications",
      blockers: [],
      authority: "IRC §263A; Form 1125-A Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-1125-e",
      displayName: "Form 1125-E (Compensation of Officers)",
      group: "TAX",
      triggered: ctx.ledger.grossReceipts >= 500_000,
      required: ctx.ledger.grossReceipts >= 500_000,
      skipReason: ctx.ledger.grossReceipts >= 500_000 ? undefined : "Required only when gross receipts ≥ $500,000",
      blockers: [],
      authority: "Form 1125-E Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-941",
      displayName: "Form 941 × 4 (Employer's Quarterly Federal Tax)",
      group: "TAX",
      triggered: ctx.ledger.payrollRunCount > 0,
      required: ctx.ledger.payrollRunCount > 0,
      skipReason: ctx.ledger.payrollRunCount > 0 ? undefined : "No payroll runs in tax year",
      blockers: [],
      authority: "IRC §3402, §3102; Form 941 Instructions Rev. March 2025",
      formRevision: "Rev. March 2025",
    },
    {
      formId: "form-940",
      displayName: "Form 940 (FUTA Annual Return)",
      group: "TAX",
      triggered: ctx.ledger.payrollRunCount > 0,
      required: ctx.ledger.payrollRunCount > 0,
      skipReason: ctx.ledger.payrollRunCount > 0 ? undefined : "No payroll runs in tax year",
      blockers: [],
      authority: "IRC §3301; Form 940 Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-w2-w3",
      displayName: "W-2 × N (Employee Wage Statements) + W-3 (Transmittal)",
      group: "TAX",
      triggered: ctx.ledger.payrollRunCount > 0,
      required: ctx.ledger.payrollRunCount > 0,
      skipReason: ctx.ledger.payrollRunCount > 0 ? undefined : "No employees / no W-2s required",
      blockers: [],
      authority: "IRC §6051; W-2/W-3 Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
  ]
}

// ── PARTNERSHIP / LLC_MULTI bundle ───────────────────────────────────────────

function partnershipBundle(ctx: DeliverableContext): Deliverable[] {
  const meetsScheduleL =
    ctx.ledger.grossReceipts >= SCHEDULE_L_THRESHOLD_DOLLARS &&
    ctx.ledger.totalAssets >= SCHEDULE_L_THRESHOLD_DOLLARS

  return [
    {
      formId: "form-1065",
      displayName: "Form 1065 (Partnership Return of Income)",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: ctx.owners.count < 2 ? ["Partnership requires at least 2 partners"] : [],
      authority: "IRC §701, §6031; Reg §1.6031(a)-1; Form 1065 Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-k-1065",
      displayName: "Schedule K (Form 1065) — Partners' Distributive Share",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "IRC §702; Form 1065 Schedule K Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-k1-1065",
      displayName: `Schedule K-1 (Form 1065) × ${Math.max(ctx.owners.count, 1)} partner(s) — with §704(b) capital and §704(c) built-in gain/loss`,
      group: "TAX",
      triggered: true,
      required: true,
      blockers: ctx.owners.count === 0
        ? ["No partners configured — add Partner records before generating K-1s"]
        : ctx.owners.allOwnersComplete
          ? []
          : ["One or more partners missing SSN/EIN or capital account"],
      authority: "IRC §704; Reg §1.704-1, §1.704-3; Schedule K-1 (Form 1065) Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-m2-1065",
      displayName: "Schedule M-2 (Form 1065) — Partners' Capital Accounts",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "IRC §704; Form 1065 Schedule M-2 Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-l-1065",
      displayName: "Schedule L (Form 1065) — Balance Sheet per Books",
      group: "TAX",
      triggered: meetsScheduleL,
      required: meetsScheduleL,
      skipReason: meetsScheduleL ? undefined : `Optional unless thresholds met`,
      blockers: [],
      authority: "Form 1065 Instructions Rev. 2025; Schedule B questions",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "form-4562",
      displayName: "Form 4562 (Depreciation and Amortization)",
      group: "TAX",
      triggered: ctx.ledger.hasDepreciation,
      required: ctx.ledger.hasDepreciation,
      skipReason: ctx.ledger.hasDepreciation ? undefined : "No depreciation classifications found",
      blockers: [],
      authority: "IRC §167, §168; Form 4562 Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-1125-a",
      displayName: "Form 1125-A (Cost of Goods Sold)",
      group: "TAX",
      triggered: ctx.ledger.hasCOGS,
      required: ctx.ledger.hasCOGS,
      skipReason: ctx.ledger.hasCOGS ? undefined : "No COGS classifications",
      blockers: [],
      authority: "IRC §263A; Form 1125-A Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
  ]
}

// ── C_CORP bundle ─────────────────────────────────────────────────────────────

function cCorpBundle(ctx: DeliverableContext): Deliverable[] {
  const meetsScheduleM3 = ctx.ledger.totalAssets >= SCHEDULE_M3_THRESHOLD_DOLLARS
  return [
    {
      formId: "form-1120",
      displayName: "Form 1120 (U.S. Corporation Income Tax Return)",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "IRC §11, §6012; Form 1120 Instructions Rev. 2025. Flat 21% rate per TCJA.",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-m1-1120",
      displayName: "Schedule M-1 (Form 1120) — Reconciliation of Income/Loss per Books",
      group: "TAX",
      triggered: !meetsScheduleM3,
      required: !meetsScheduleM3,
      skipReason: meetsScheduleM3 ? "M-3 supersedes M-1 at $10M+ assets" : undefined,
      blockers: [],
      authority: "Form 1120 Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-m3-1120",
      displayName: "Schedule M-3 (Form 1120) — Net Income (Loss) Reconciliation",
      group: "TAX",
      triggered: meetsScheduleM3,
      required: meetsScheduleM3,
      skipReason: meetsScheduleM3 ? undefined : `Required only when total assets ≥ $${SCHEDULE_M3_THRESHOLD_DOLLARS.toLocaleString()}`,
      blockers: [],
      authority: "Schedule M-3 (Form 1120) Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "schedule-l-1120",
      displayName: "Schedule L (Form 1120) — Balance Sheet per Books",
      group: "TAX",
      triggered: true,
      required: true,
      blockers: [],
      authority: "Form 1120 Instructions Rev. 2025",
      formRevision: "Rev. December 2025",
    },
    {
      formId: "form-4562",
      displayName: "Form 4562 (Depreciation and Amortization)",
      group: "TAX",
      triggered: ctx.ledger.hasDepreciation,
      required: ctx.ledger.hasDepreciation,
      skipReason: ctx.ledger.hasDepreciation ? undefined : "No depreciation classifications found",
      blockers: [],
      authority: "IRC §167, §168; Form 4562 Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-1125-a",
      displayName: "Form 1125-A (Cost of Goods Sold)",
      group: "TAX",
      triggered: ctx.ledger.hasCOGS,
      required: ctx.ledger.hasCOGS,
      skipReason: ctx.ledger.hasCOGS ? undefined : "No COGS classifications",
      blockers: [],
      authority: "IRC §263A; Form 1125-A Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "form-1125-e",
      displayName: "Form 1125-E (Compensation of Officers)",
      group: "TAX",
      triggered: ctx.ledger.grossReceipts >= 500_000,
      required: ctx.ledger.grossReceipts >= 500_000,
      skipReason: ctx.ledger.grossReceipts >= 500_000 ? undefined : "Required only when gross receipts ≥ $500,000",
      blockers: [],
      authority: "Form 1125-E Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
  ]
}

// ── 1099 / W-2 information returns (any entity) ─────────────────────────────

function informationReturnsBundle(ctx: DeliverableContext): Deliverable[] {
  const candidates = ctx.ledger.contractorCandidates.filter(
    (c) => c.totalDollars >= FORM_1099_NEC_THRESHOLD_DOLLARS,
  )
  const missingTinCount = candidates.filter((c) => c.missingTin).length
  return [
    {
      formId: "form-1099-nec",
      displayName: `Form 1099-NEC × ${candidates.length} (Nonemployee Compensation, ≥ $${FORM_1099_NEC_THRESHOLD_DOLLARS}/yr)`,
      group: "INFO_RETURN",
      triggered: candidates.length > 0,
      required: candidates.length > 0,
      skipReason: candidates.length === 0
        ? `No contractors paid ≥ $${FORM_1099_NEC_THRESHOLD_DOLLARS} in tax year`
        : undefined,
      blockers: missingTinCount > 0
        ? [`Missing W-9 / TIN for ${missingTinCount} of ${candidates.length} 1099-NEC recipients — collect TIN before generation`]
        : [],
      authority:
        "IRC §6041A; Reg §1.6041-1; Form 1099-NEC Instructions Rev. January 2025. Corporations exempt except legal/medical (Reg §1.6049-4(c)(1)(ii)).",
      formRevision: "Rev. January 2025",
    },
    {
      formId: "form-1099-misc",
      displayName: "Form 1099-MISC (Rents, Royalties, Other ≥ $600)",
      group: "INFO_RETURN",
      triggered: ctx.ledger.has1099MiscCandidate,
      required: ctx.ledger.has1099MiscCandidate,
      skipReason: ctx.ledger.has1099MiscCandidate ? undefined : "No rent/royalty payments ≥ $600 to non-corporations",
      blockers: [],
      authority: "IRC §6041; Reg §1.6041-1; Form 1099-MISC Instructions Rev. January 2025",
      formRevision: "Rev. January 2025",
    },
    {
      formId: "form-1096",
      displayName: "Form 1096 (Annual Summary & Transmittal — paper-file only)",
      group: "INFO_RETURN",
      triggered: candidates.length > 0 && candidates.length < 10,
      required: candidates.length > 0 && candidates.length < 10,
      skipReason: candidates.length >= 10
        ? "10+ information returns require electronic filing via IRIS / FIRE per T.D. 9972 (no Form 1096 needed)"
        : candidates.length === 0
          ? "No information returns to transmit"
          : undefined,
      blockers: [],
      authority: "IRC §6011; T.D. 9972 (e-file threshold lowered to 10 returns starting TY2023)",
      formRevision: "Rev. 2025",
    },
  ]
}

// ── Accounting statements (any entity) ──────────────────────────────────────

function accountingStatementsBundle(ctx: DeliverableContext): Deliverable[] {
  void ctx
  return [
    {
      formId: "income-statement",
      displayName: "Income Statement (P&L) — Cash & Accrual columns",
      group: "ACCOUNTING",
      triggered: true,
      required: true,
      blockers: [],
      authority: "GAAP / IRS conformity; AICPA AR-C §70 (preparation engagement)",
    },
    {
      formId: "balance-sheet",
      displayName: "Balance Sheet (opening + closing)",
      group: "ACCOUNTING",
      triggered: true,
      required: true,
      blockers: [],
      authority: "GAAP / IRS conformity",
    },
    {
      formId: "cash-flow",
      displayName: "Statement of Cash Flows",
      group: "ACCOUNTING",
      triggered: true,
      required: false,
      blockers: [],
      authority: "GAAP ASC 230",
    },
    {
      formId: "general-ledger",
      displayName: "General Ledger (Master Transaction Ledger)",
      group: "ACCOUNTING",
      triggered: true,
      required: true,
      blockers: [],
      authority: "Reg §1.6001-1 (record retention)",
    },
    {
      formId: "trial-balance",
      displayName: "Trial Balance",
      group: "ACCOUNTING",
      triggered: true,
      required: false,
      blockers: [],
      authority: "GAAP / record-keeping standard",
    },
    {
      formId: "depreciation-schedule",
      displayName: "Schedule of Depreciation (per asset)",
      group: "ACCOUNTING",
      triggered: ctx.ledger.hasDepreciation,
      required: ctx.ledger.hasDepreciation,
      skipReason: ctx.ledger.hasDepreciation ? undefined : "No fixed assets / depreciation tracked",
      blockers: [],
      authority: "IRC §168, §179; Form 4562 supporting workpaper",
    },
    {
      formId: "vendor-list",
      displayName: "Vendor List with annual totals",
      group: "ACCOUNTING",
      triggered: true,
      required: false,
      blockers: [],
      authority: "Internal record-keeping; supports 1099 candidate identification",
    },
  ]
}

// ── Workflow / audit (any entity) ───────────────────────────────────────────

function workflowBundle(ctx: DeliverableContext): Deliverable[] {
  return [
    {
      formId: "position-memos",
      displayName: "Position Memos (gray-zone defenses)",
      group: "WORKFLOW",
      triggered: true,
      required: false,
      blockers: ctx.assertionsPass
        ? []
        : ["Memo generation requires lock-assertions to pass first — current ledger has blockers"],
      authority: "Internal workpaper standard; Circular 230 §10.34 (positions on returns)",
    },
    {
      formId: "audit-defense-packet",
      displayName: "Audit Defense Packet (§274(d) substantiation, Cohan flags, evidence-tier inventory)",
      group: "WORKFLOW",
      triggered: true,
      required: true,
      blockers: [],
      authority: "IRC §6001; Reg §1.6001-1; §274(d) substantiation rules",
    },
    {
      formId: "engagement-letter",
      displayName: "Engagement Letter",
      group: "WORKFLOW",
      triggered: true,
      required: false,
      blockers: [],
      authority: "AICPA SSARS / Circular 230 §10.30",
    },
    {
      formId: "form-8879",
      displayName: "Form 8879 (IRS e-file Signature Authorization)",
      group: "WORKFLOW",
      triggered: true,
      required: false,
      blockers: [],
      authority: "Pub 1345; Form 8879 Instructions Rev. 2025",
      formRevision: "Rev. 2025",
    },
    {
      formId: "cover-memo",
      displayName: "Cover Memo to Taxpayer",
      group: "WORKFLOW",
      triggered: true,
      required: true,
      blockers: [],
      authority: "Internal client-communication standard",
    },
  ]
}

// ── State layer ─────────────────────────────────────────────────────────────

function stateLayerBundle(ctx: DeliverableContext): Deliverable[] {
  const list: Deliverable[] = []
  if (ctx.state === "TX") {
    // Texas Franchise Tax Public Information Report (PIR) + No-Tax-Due
    // Report for revenues ≤ $2.47M (TY2025 threshold). Sole props are
    // exempt; LLC_SINGLE / S_CORP / C_CORP / PARTNERSHIP file PIR.
    const piExempt = ctx.entityType === "SOLE_PROP"
    list.push({
      formId: "tx-franchise-pir",
      displayName: "TX Franchise Tax — Public Information Report (PIR)",
      group: "STATE",
      triggered: !piExempt,
      required: !piExempt,
      skipReason: piExempt ? "Sole proprietors are exempt from TX Franchise Tax" : undefined,
      blockers: [],
      authority: "TX Tax Code Ch. 171; Comptroller Form 05-102 Rev. 2025. TY2025 No-Tax-Due threshold $2.47M revenue.",
      formRevision: "Rev. 2025",
    })
  }
  // Other states (CA, NY, NJ, etc.) deferred to v2 — but include a stub so
  // the panel surfaces "no state forms generated" rather than silence.
  if (ctx.state && ctx.state !== "TX") {
    list.push({
      formId: `state-${ctx.state.toLowerCase()}`,
      displayName: `${ctx.state} state filings`,
      group: "STATE",
      triggered: false,
      required: false,
      skipReason: `${ctx.state} state-form generation not yet supported in this build — file separately`,
      blockers: [],
      authority: `${ctx.state} Department of Revenue / Franchise Tax Board`,
    })
  }
  return list
}

// ── Compliance flags (informational only — not deliverables) ────────────────

export interface ComplianceFlag {
  id: string
  message: string
  severity: "info" | "warning"
  authority: string
}

export function buildComplianceFlags(ctx: DeliverableContext): ComplianceFlag[] {
  const flags: ComplianceFlag[] = []

  // BOI under FinCEN final rule (March 21, 2025) — domestic exempt
  flags.push({
    id: "boi-not-required",
    message: "Beneficial Ownership Information (BOI) report not required for domestic reporting companies (FinCEN final rule, March 21, 2025).",
    severity: "info",
    authority: "FinCEN final rule 31 CFR §1010.380 (effective March 21, 2025)",
  })

  // §168(k) bonus depreciation phase-down
  if (ctx.ledger.hasDepreciation) {
    flags.push({
      id: "section-168k-phasedown",
      message: "TY2025 §168(k) bonus depreciation = 40% (post-OBBBA phase-down: 60% for 2024, 40% for 2025, 20% for 2026, 0% for 2027).",
      severity: "info",
      authority: "IRC §168(k)(6); H.R. ___ (OBBBA) §13201",
    })
  }

  // Standard mileage rate
  flags.push({
    id: "mileage-rate-2025",
    message: "TY2025 standard mileage rate: 70.0¢ per business mile (IRS Notice 2025-5).",
    severity: "info",
    authority: "IRS Notice 2025-5",
  })

  // 1099-K threshold
  flags.push({
    id: "1099k-threshold-2025",
    message: `TY2025 1099-K reporting threshold = $${FORM_1099_K_THRESHOLD_DOLLARS_TY2025.toLocaleString()} per IRS Notice 2024-85 (transitional; reverts to $600 in TY2026 absent further guidance).`,
    severity: "info",
    authority: "IRS Notice 2024-85",
  })

  // §179 cap
  flags.push({
    id: "section-179-cap-2025",
    message: "TY2025 §179 expensing cap: $1,250,000 with phase-out starting at $3,130,000 (Rev. Proc. 2024-40).",
    severity: "info",
    authority: "IRC §179; Rev. Proc. 2024-40",
  })

  // QBI threshold
  flags.push({
    id: "qbi-threshold-2025",
    message: "TY2025 §199A QBI threshold: $241,950 single / $483,900 MFJ. Above: use Form 8995-A.",
    severity: "info",
    authority: "IRC §199A; Rev. Proc. 2024-40",
  })

  // S-Corp reasonable compensation flag
  if (ctx.entityType === "S_CORP" && ctx.ledger.payrollRunCount === 0 && ctx.ledger.netProfit > 10_000) {
    flags.push({
      id: "s-corp-reasonable-comp",
      message: "S-Corp officer must take reasonable compensation per Rev. Rul. 59-221 — no payroll runs detected. IRS commonly recharacterizes distributions as wages on audit.",
      severity: "warning",
      authority: "Rev. Rul. 59-221; Watson v. Commissioner (8th Cir. 2012)",
    })
  }

  // Texas franchise reminder
  if (ctx.state === "TX" && ctx.entityType !== "SOLE_PROP") {
    flags.push({
      id: "tx-franchise-due",
      message: "Texas Franchise Tax PIR due May 15 following the report year. No-Tax-Due threshold $2.47M revenue.",
      severity: "info",
      authority: "TX Tax Code Ch. 171; Comptroller deadline calendar",
    })
  }

  // Memo timing (P1.5 carryover)
  if (!ctx.assertionsPass) {
    flags.push({
      id: "assertions-failing",
      message: "Lock assertions are currently failing — position memos and the audit packet will be drafted on top of in-flux data. Resolve blockers before generating the dump.",
      severity: "warning",
      authority: "Internal: P1.5 memo-timing rule",
    })
  }

  return flags
}

// ── Summary helpers for the UI ──────────────────────────────────────────────

export function summarizeDeliverables(items: Deliverable[]): {
  triggeredCount: number
  blockerCount: number
  byGroup: Record<DeliverableGroup, Deliverable[]>
} {
  const triggered = items.filter((d) => d.triggered)
  const blockerCount = items.flatMap((d) => d.blockers).length
  const byGroup: Record<DeliverableGroup, Deliverable[]> = {
    TAX: [],
    ACCOUNTING: [],
    INFO_RETURN: [],
    WORKFLOW: [],
    STATE: [],
  }
  for (const d of items) byGroup[d.group].push(d)
  return { triggeredCount: triggered.length, blockerCount, byGroup }
}

// Re-export for convenience
export { getFormSpec }
