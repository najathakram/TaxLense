/**
 * Document registry — single source of truth for "what artifacts can be
 * viewed at /years/[year]/documents/[kind]". Each entry maps a URL slug
 * to a builder function (already exists in lib/reports/) and metadata
 * the viewer page uses for header/title/lineage.
 *
 * Stale detection: each viewable doc declares `lineageQuery` — a fingerprint
 * of the underlying ledger state. We compare the current fingerprint to the
 * value stored on Report.transactionSnapshotHash to flag staleness.
 */

import { prisma } from "@/lib/db"
import { computeLedgerHash } from "@/lib/lock/hash"

export type DocKindSlug =
  | "schedule-c-worksheet"
  | "form-8829"
  | "form-1120s-worksheet"
  | "form-1065-worksheet"
  | "form-1120-worksheet"
  | "schedule-se"
  | "form-8995-qbi"
  | "form-1125a-cogs"
  | "form-4562-depreciation"
  | "schedule-m1-1120s"
  | "schedule-m1-1065"
  | "schedule-m1-1120"
  | "schedule-m2-1120s"
  | "schedule-m2-1065"
  | "schedule-l-1120s"
  | "schedule-l-1065"
  | "schedule-l-1120"
  | "client-summary"
  | "depreciation-schedule"
  | "cpa-handoff"
  | "engagement-letter"
  | "form-8879"

export interface DocSpec {
  slug: DocKindSlug
  displayName: string
  shortName: string
  group: "TAX" | "ACCOUNTING" | "WORKFLOW"
  /**
   * Returns a function that, called with the taxYearId, returns a Buffer
   * (PDF). Lazy-imported so we don't load all PDF builders eagerly.
   */
  builder: () => Promise<(taxYearId: string) => Promise<Buffer>>
  /** Authority citation (IRC § / Reg / Rev. Proc.) — shown in viewer header. */
  authority: string
  /**
   * Whether this doc requires the year to be LOCKED before generation.
   * Most do; engagement letter / 8879 are workflow-stage docs that
   * don't (they're drafted before lock).
   */
  requiresLock: boolean
}

export const DOC_REGISTRY: Record<DocKindSlug, DocSpec> = {
  "schedule-c-worksheet": {
    slug: "schedule-c-worksheet",
    displayName: "Schedule C — Profit or Loss From Business",
    shortName: "Schedule C",
    group: "TAX",
    builder: async () => (await import("./pdf/documents")).buildScheduleCWorksheetPdf,
    authority: "IRC §1402; Schedule C (Form 1040) Instructions Rev. 2025",
    requiresLock: true,
  },
  "form-8829": {
    slug: "form-8829",
    displayName: "Form 8829 — Expenses for Business Use of Home",
    shortName: "Form 8829",
    group: "TAX",
    builder: async () => (await import("./pdf/documents")).buildForm8829Pdf,
    authority: "IRC §280A; Form 8829 Instructions Rev. 2025",
    requiresLock: true,
  },
  "form-1120s-worksheet": {
    slug: "form-1120s-worksheet",
    displayName: "Form 1120-S — S-Corporation Income Tax Return",
    shortName: "Form 1120-S",
    group: "TAX",
    builder: async () => (await import("./pdf/entityForms")).buildForm1120SPdf,
    authority: "IRC §1361, §1366; Form 1120-S Instructions Rev. December 2025",
    requiresLock: true,
  },
  "form-1065-worksheet": {
    slug: "form-1065-worksheet",
    displayName: "Form 1065 — Partnership Return of Income",
    shortName: "Form 1065",
    group: "TAX",
    builder: async () => (await import("./pdf/entityForms")).buildForm1065Pdf,
    authority: "IRC §701, §6031; Form 1065 Instructions Rev. December 2025",
    requiresLock: true,
  },
  "form-1120-worksheet": {
    slug: "form-1120-worksheet",
    displayName: "Form 1120 — U.S. Corporation Income Tax Return",
    shortName: "Form 1120",
    group: "TAX",
    builder: async () => (await import("./pdf/entityForms")).buildForm1120Pdf,
    authority: "IRC §11; Form 1120 Instructions Rev. December 2025",
    requiresLock: true,
  },
  "schedule-se": {
    slug: "schedule-se",
    displayName: "Schedule SE — Self-Employment Tax",
    shortName: "Schedule SE",
    group: "TAX",
    builder: async () => (await import("./pdf/schedules")).buildScheduleSePdf,
    authority: "IRC §1401, §1402; Schedule SE Instructions Rev. 2025",
    requiresLock: true,
  },
  "form-8995-qbi": {
    slug: "form-8995-qbi",
    displayName: "Form 8995 — QBI Deduction Simplified",
    shortName: "Form 8995",
    group: "TAX",
    builder: async () => (await import("./pdf/schedules")).buildForm8995Pdf,
    authority: "IRC §199A; Form 8995 Instructions Rev. 2025",
    requiresLock: true,
  },
  "form-1125a-cogs": {
    slug: "form-1125a-cogs",
    displayName: "Form 1125-A — Cost of Goods Sold",
    shortName: "Form 1125-A",
    group: "TAX",
    builder: async () => (await import("./pdf/schedules")).buildForm1125APdf,
    authority: "IRC §263A; Form 1125-A Instructions Rev. 2025",
    requiresLock: true,
  },
  "form-4562-depreciation": {
    slug: "form-4562-depreciation",
    displayName: "Form 4562 — Depreciation and Amortization",
    shortName: "Form 4562",
    group: "TAX",
    builder: async () => (await import("./pdf/schedules")).buildForm4562Pdf,
    authority: "IRC §167, §168, §179; Form 4562 Instructions Rev. 2025",
    requiresLock: true,
  },
  "schedule-m1-1120s": {
    slug: "schedule-m1-1120s",
    displayName: "Schedule M-1 (1120-S) — Books vs. Tax Reconciliation",
    shortName: "Schedule M-1 (1120-S)",
    group: "TAX",
    builder: async () => {
      const m = await import("./pdf/schedules")
      return (taxYearId: string) => m.buildScheduleM1Pdf(taxYearId, "1120-S")
    },
    authority: "Form 1120-S Instructions Rev. 2025",
    requiresLock: true,
  },
  "schedule-m1-1065": {
    slug: "schedule-m1-1065",
    displayName: "Schedule M-1 (1065) — Books vs. Tax Reconciliation",
    shortName: "Schedule M-1 (1065)",
    group: "TAX",
    builder: async () => {
      const m = await import("./pdf/schedules")
      return (taxYearId: string) => m.buildScheduleM1Pdf(taxYearId, "1065")
    },
    authority: "Form 1065 Instructions Rev. 2025",
    requiresLock: true,
  },
  "schedule-m1-1120": {
    slug: "schedule-m1-1120",
    displayName: "Schedule M-1 (1120) — Books vs. Tax Reconciliation",
    shortName: "Schedule M-1 (1120)",
    group: "TAX",
    builder: async () => {
      const m = await import("./pdf/schedules")
      return (taxYearId: string) => m.buildScheduleM1Pdf(taxYearId, "1120")
    },
    authority: "Form 1120 Instructions Rev. 2025",
    requiresLock: true,
  },
  "schedule-m2-1120s": {
    slug: "schedule-m2-1120s",
    displayName: "Schedule M-2 (1120-S) — AAA / Shareholder Capital Roll-Forward",
    shortName: "Schedule M-2 (1120-S)",
    group: "TAX",
    builder: async () => {
      const m = await import("./pdf/schedules")
      return (taxYearId: string) => m.buildScheduleM2Pdf(taxYearId, "1120-S")
    },
    authority: "IRC §1368; Form 1120-S Schedule M-2 Instructions Rev. 2025",
    requiresLock: true,
  },
  "schedule-m2-1065": {
    slug: "schedule-m2-1065",
    displayName: "Schedule M-2 (1065) — Partner Capital Accounts",
    shortName: "Schedule M-2 (1065)",
    group: "TAX",
    builder: async () => {
      const m = await import("./pdf/schedules")
      return (taxYearId: string) => m.buildScheduleM2Pdf(taxYearId, "1065")
    },
    authority: "IRC §704; Form 1065 Schedule M-2 Instructions Rev. 2025",
    requiresLock: true,
  },
  "schedule-l-1120s": {
    slug: "schedule-l-1120s",
    displayName: "Schedule L (1120-S) — Balance Sheet per Books",
    shortName: "Schedule L (1120-S)",
    group: "TAX",
    builder: async () => {
      const m = await import("./pdf/schedules")
      return (taxYearId: string) => m.buildScheduleLPdf(taxYearId, "1120-S")
    },
    authority: "Form 1120-S Instructions Rev. 2025",
    requiresLock: true,
  },
  "schedule-l-1065": {
    slug: "schedule-l-1065",
    displayName: "Schedule L (1065) — Balance Sheet per Books",
    shortName: "Schedule L (1065)",
    group: "TAX",
    builder: async () => {
      const m = await import("./pdf/schedules")
      return (taxYearId: string) => m.buildScheduleLPdf(taxYearId, "1065")
    },
    authority: "Form 1065 Instructions Rev. 2025",
    requiresLock: true,
  },
  "schedule-l-1120": {
    slug: "schedule-l-1120",
    displayName: "Schedule L (1120) — Balance Sheet per Books",
    shortName: "Schedule L (1120)",
    group: "TAX",
    builder: async () => {
      const m = await import("./pdf/schedules")
      return (taxYearId: string) => m.buildScheduleLPdf(taxYearId, "1120")
    },
    authority: "Form 1120 Instructions Rev. 2025",
    requiresLock: true,
  },
  "client-summary": {
    slug: "client-summary",
    displayName: "Client Summary — Bottom-line figures",
    shortName: "Client Summary",
    group: "WORKFLOW",
    builder: async () => (await import("./pdf/documents")).buildClientSummaryPdf,
    authority: "Internal client-communication standard",
    requiresLock: true,
  },
  "depreciation-schedule": {
    slug: "depreciation-schedule",
    displayName: "Depreciation Schedule — Asset detail",
    shortName: "Depreciation",
    group: "ACCOUNTING",
    builder: async () => (await import("./pdf/documents")).buildDepreciationSchedulePdf,
    authority: "IRC §168; Reg §1.167(a)-1",
    requiresLock: true,
  },
  "cpa-handoff": {
    slug: "cpa-handoff",
    displayName: "CPA Handoff Letter — Decision points + open items",
    shortName: "CPA Handoff",
    group: "WORKFLOW",
    builder: async () => (await import("./pdf/documents")).buildCpaHandoffPdf,
    authority: "Internal handoff standard",
    requiresLock: true,
  },
  // Engagement / 8879 are workflow docs that DON'T need lock — they're
  // drafted in pre-lock review.
  "engagement-letter": {
    slug: "engagement-letter",
    displayName: "Engagement Letter (CPA ↔ Client)",
    shortName: "Engagement Letter",
    group: "WORKFLOW",
    builder: async () => (await import("./pdf/engagement")).buildEngagementLetterPdf,
    authority: "AICPA SSARS / Circular 230 §10.30",
    requiresLock: false,
  },
  "form-8879": {
    slug: "form-8879",
    displayName: "Form 8879 — IRS e-file Signature Authorization",
    shortName: "Form 8879",
    group: "WORKFLOW",
    builder: async () => (await import("./pdf/engagement")).buildForm8879Pdf,
    authority: "Pub 1345; Form 8879 Instructions Rev. 2025",
    requiresLock: true,
  },
}

/**
 * Determines which docs are RELEVANT for a given tax year, given its
 * BusinessProfile.entityType. Used to populate the viewer's left rail.
 */
export function relevantDocSlugsForEntity(entityType: string): DocKindSlug[] {
  const base: DocKindSlug[] = ["client-summary", "depreciation-schedule", "cpa-handoff"]

  if (entityType === "SOLE_PROP" || entityType === "LLC_SINGLE") {
    return [
      "schedule-c-worksheet",
      "form-8829",
      "schedule-se",
      "form-8995-qbi",
      "form-1125a-cogs",
      "form-4562-depreciation",
      ...base,
      "engagement-letter",
      "form-8879",
    ]
  }
  if (entityType === "S_CORP") {
    return [
      "form-1120s-worksheet",
      "schedule-m1-1120s",
      "schedule-m2-1120s",
      "schedule-l-1120s",
      "form-1125a-cogs",
      "form-4562-depreciation",
      ...base,
      "engagement-letter",
      "form-8879",
    ]
  }
  if (entityType === "LLC_MULTI" || entityType === "PARTNERSHIP") {
    return [
      "form-1065-worksheet",
      "schedule-m1-1065",
      "schedule-m2-1065",
      "schedule-l-1065",
      "form-1125a-cogs",
      "form-4562-depreciation",
      ...base,
      "engagement-letter",
      "form-8879",
    ]
  }
  if (entityType === "C_CORP") {
    return [
      "form-1120-worksheet",
      "schedule-m1-1120",
      "schedule-l-1120",
      "form-1125a-cogs",
      "form-4562-depreciation",
      ...base,
      "engagement-letter",
      "form-8879",
    ]
  }
  return base
}

/**
 * Stale-detection: a doc is "stale" if a Report row exists for it but its
 * transactionSnapshotHash differs from the current ledger hash.
 */
export interface DocStatus {
  slug: DocKindSlug
  hasReport: boolean
  generatedAt: Date | null
  isStale: boolean
}

export async function getDocStatuses(taxYearId: string): Promise<Map<DocKindSlug, DocStatus>> {
  const reports = await prisma.report.findMany({
    where: { taxYearId, isCurrent: true },
    orderBy: { generatedAt: "desc" },
  })
  const currentHash = await computeLedgerHash(taxYearId)

  // Existing Report records use kind enums (MASTER_LEDGER / FINANCIAL_STATEMENTS
  // / AUDIT_PACKET / TAX_PACKAGE) — they don't carry per-document slugs.
  // For the viewer, we infer freshness from filePath naming convention
  // (e.g. files emitted from buildTaxPackage). Until we extend Report.kind
  // with per-doc enum values (or add a Report.docSlug column), every doc
  // shows as 'never generated' on first load — clicking the slug runs the
  // builder on demand and writes a Report row.
  const map = new Map<DocKindSlug, DocStatus>()
  for (const slug of Object.keys(DOC_REGISTRY) as DocKindSlug[]) {
    const matching = reports.find((r) => r.filePath?.includes(slug))
    map.set(slug, {
      slug,
      hasReport: !!matching,
      generatedAt: matching?.generatedAt ?? null,
      isStale: !!matching && matching.transactionSnapshotHash !== currentHash,
    })
  }
  return map
}
