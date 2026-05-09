/**
 * Single source of truth for displaying dollar amounts in TaxLens.
 *
 * Why this file exists: prior to B-01 (cpa-review/round-6), the codebase had
 * 137 occurrences of `.toFixed(2)` scattered across server-side string
 * assembly (assertions, risk signals, agent output, position memos, audit-
 * packet CSVs, ledger client, STOPs client, etc). None of them used
 * `toLocaleString`, so every dollar amount displayed without thousands
 * separators — `$26700.00` instead of `$26,700.00`. The headline cards used
 * the v2-component `fmtUSD`, which made the inconsistency worse, not better.
 *
 * Rule: every dollar amount displayed to the user (web UI, server-rendered
 * strings, CSVs, PDF text, log lines a CPA may read) must flow through one of
 * these helpers. ESLint blocks raw `.toFixed(2)` outside this file.
 *
 * Server-importable. NO `"use client"` directive — these are pure functions.
 */

export interface FmtUSDOptions {
  /** Show two decimals. Default: false (matches the prior v2 `fmtUSD` behavior). */
  cents?: boolean
  /** Force a leading `+` for non-negative numbers. Default: false. */
  signed?: boolean
}

/**
 * Format a number as USD with thousands separators.
 *
 * Default is whole dollars (matches the prior v2 `fmtUSD`). Pass
 * `{ cents: true }` for two-decimal display — that's what every
 * `.toFixed(2)` swap should request.
 *
 * Examples:
 *   fmtUSD(26700)                    → "$26,700"
 *   fmtUSD(26700, { cents: true })   → "$26,700.00"
 *   fmtUSD(-2624, { cents: true })   → "-$2,624.00"
 *   fmtUSD(2624, { signed: true })   → "+$2,624"
 *   fmtUSD(null)                     → "—"
 */
export function fmtUSD(n: number | null | undefined, opts: FmtUSDOptions = {}): string {
  if (n == null || isNaN(n)) return "—"
  const cents = opts.cents === true
  const sign = n < 0 ? "-" : opts.signed ? "+" : ""
  const abs = Math.abs(n)
  const s = abs.toLocaleString("en-US", {
    minimumFractionDigits: cents ? 2 : 0,
    maximumFractionDigits: cents ? 2 : 0,
  })
  return `${sign}$${s}`
}

/**
 * Format a number with thousands separators but no `$` prefix.
 * Useful for transaction counts, row counts, etc.
 */
export function fmtNum(n: number | null | undefined): string {
  return n == null ? "—" : n.toLocaleString("en-US")
}

/**
 * Convenience: format `cents` (an integer count of cents) as USD.
 * `lib/risk/score.ts` and `lib/validation/assertions.ts` track money in
 * integer cents; this avoids the `(x / 100).toFixed(2)` pattern there.
 */
export function fmtUSDFromCents(cents: number | null | undefined, opts: FmtUSDOptions = {}): string {
  if (cents == null || isNaN(cents)) return "—"
  return fmtUSD(cents / 100, opts)
}
