/**
 * Single source of truth for "is this Transaction within the TaxYear's
 * calendar year?" — used by every total-rendering surface (ledger header,
 * Schedule C totals, risk dashboard, dashboard year cards).
 *
 * Why this exists: imports prior to the parser's `partitionByTaxYear` fix
 * left out-of-year rows attached to in-year TaxYears (typical statement
 * cross-boundary cases like a 2024-12 → 2025-01 PDF). Schema-level
 * Transactions are append-only per CLAUDE.md, so we cannot retroactively
 * delete or tag them. This helper applies the same `postedDate.UTCFullYear
 * === year` rule that A10_YEAR_BOUNDARY enforces, but at query time so
 * existing offenders are excluded from displayed totals.
 *
 * A10 (year-boundary detector) intentionally does NOT use this — its whole
 * job is to detect the leakage. Every other assertion (A01–A09, A11–A13) and
 * all reports + UI totals do filter by year window so the numbers shown to
 * the user agree across pages.
 */
export function inYearWindow(year: number) {
  return {
    postedDate: {
      gte: new Date(Date.UTC(year, 0, 1)),
      lt: new Date(Date.UTC(year + 1, 0, 1)),
    },
  }
}
