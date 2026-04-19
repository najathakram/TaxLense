/**
 * TaxLens — Deduplication helpers
 * Spec §4.2: SHA-256 on file bytes + transaction idempotency key.
 */

import crypto from "node:crypto"

/**
 * File-level dedup: SHA-256 of raw file bytes.
 * Used as StatementImport.sourceHash with @@unique([accountId, sourceHash]).
 */
export function fileHash(buffer: Buffer): string {
  return crypto.createHash("sha256").update(buffer).digest("hex")
}

/**
 * Transaction-level dedup key.
 * Deterministic: same transaction appearing in two different uploads → same key.
 *
 * Components:
 *  - accountId  (scopes to the account)
 *  - postedDate (date-only, YYYY-MM-DD — absorbs timezone edge cases)
 *  - amountNormalized in integer cents (avoids float representation drift)
 *  - merchantRaw lowercased + trimmed
 */
export function transactionKey(
  accountId: string,
  postedDate: Date,
  amountNormalized: number,
  merchantRaw: string,
): string {
  const parts = [
    accountId,
    postedDate.toISOString().slice(0, 10),
    Math.round(amountNormalized * 100).toString(),
    merchantRaw.trim().toLowerCase(),
  ]
  return crypto.createHash("sha256").update(parts.join("|")).digest("hex")
}
