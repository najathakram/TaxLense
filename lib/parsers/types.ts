/**
 * TaxLens — Parser types
 * Spec §4.2 Phase 1 Ingestion
 *
 * Sign convention: outflows POSITIVE, inflows NEGATIVE (spec §4.2 sign normalisation).
 */

export type RawTx = {
  postedDate: Date
  transactionDate?: Date
  /** Signed exactly as it appears in the source file */
  amountOriginal: number
  /** Outflows +, inflows – per spec §4.2 */
  amountNormalized: number
  merchantRaw: string
  descriptionRaw?: string
}

export type ReconciliationResult = {
  ok: boolean
  /** From PDF header "Total Fees and Charges" */
  statedCharges?: number
  /** From PDF header "Total Payments and Credits" */
  statedCredits?: number
  /** sum(amountNormalized > 0) */
  computedCharges?: number
  /** sum(abs(amountNormalized < 0)) */
  computedCredits?: number
  /** abs(statedTotal – computedTotal); present when !ok */
  delta?: number
}

export type ParseResult = {
  ok: boolean
  error?: string
  institution?: string
  periodStart?: Date
  periodEnd?: Date
  transactions: RawTx[]
  /** abs sum of negative amountNormalized (money that came IN) */
  totalInflows: number
  /** sum of positive amountNormalized (money that went OUT) */
  totalOutflows: number
  reconciliation: ReconciliationResult
  /** 0.0–1.0 confidence in the parse result */
  parseConfidence: number
}
