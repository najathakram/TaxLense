/**
 * Risk-signal IDs that admit a "Confirm variance" override (B-23).
 *
 * Lives in a server-importable module (no "use client") so the Risk page can
 * filter signals on the server without dragging the client bundle in.
 *
 * Add a signal here only if the variance is plausibly legitimate
 * (e.g. INCOME_SHORT — Q4 1099-K timing). Hard rules like A07 unpaired
 * transfers should not be overridable; they're a real reconciliation gap.
 */
export const OVERRIDABLE_SIGNALS: ReadonlySet<string> = new Set([
  "INCOME_SHORT",
])
