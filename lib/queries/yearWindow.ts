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
 * Assertion runners (A10, etc.) intentionally do NOT use this — they need
 * to see ALL rows to detect the leakage. Reports + UI totals always do.
 */
export function inYearWindow(year: number) {
  return {
    postedDate: {
      gte: new Date(Date.UTC(year, 0, 1)),
      lt: new Date(Date.UTC(year + 1, 0, 1)),
    },
  }
}
