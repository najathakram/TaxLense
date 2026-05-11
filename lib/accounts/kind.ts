/**
 * Account-kind inference — maps an institution name to TRADITIONAL or
 * MONEY_MOVER. Money-mover wallets (Wise, PayPal, Venmo, Cash App, Stripe
 * Balance, Zelle, Pocketsflow, Remitly, Revolut) aggregate balance: top-ups
 * IN don't pair 1:1 with payments OUT, so the standard transfer-pair
 * detector fails on them.
 *
 * Used at:
 *   - FinancialAccount creation (default kind)
 *   - Migration 20260510_add_account_kind backfill (the SQL list mirrors
 *     this regex — keep them in sync if you add a pattern here)
 *   - Transfer pairing (lib/pairing/transfers.ts) — outflows naming a
 *     money-mover destination are classified TRANSFER without requiring
 *     an inflow pair on the destination account
 */

import type { AccountKind } from "@/app/generated/prisma/client"

/**
 * Institutions that operate as wallets / money-movers. Lower-case match
 * so the regex stays cheap; institution names are normalised to lower
 * before applying.
 */
export const MONEY_MOVER_INSTITUTIONS = [
  "wise",
  "transferwise",
  "paypal",
  "venmo",
  "cash app",
  "cashapp",
  "stripe",
  "zelle",
  "pocketsflow",
  "remitly",
  "revolut",
] as const

/**
 * Merchant-text patterns on outflows that indicate the destination is a
 * money-mover wallet (top-up). Used in transfer pairing to classify an
 * outflow as TRANSFER when no 1:1 inflow match is found in any other
 * account.
 *
 * IMPORTANT: distinguish wallet TOP-UPS from wallet PURCHASES. When a
 * card is used through a wallet as a payment rail, the merchant string
 * looks like "PAYPAL*WALMART" or "CASHAPP*VENDOR" — the `*` separator
 * means "wallet → some merchant". Those are real purchases and must
 * NOT be classified as TRANSFER. Top-ups look like "PAYPAL ACH
 * WITHDRAWAL", "WISE INC", "VENMO PAYMENT" — no asterisk.
 *
 * The pattern requires "cash app" with whitespace (not "cashapp") so
 * "CASHAPP*MERCHANT" doesn't match. Asterisk negative-lookahead on the
 * single-token names handles the same case for paypal/venmo/wise.
 */
export const MONEY_MOVER_OUTFLOW_RX =
  /\b(wise(?!\*)(?:\s*inc)?|transferwise|paypal(?!\*)|venmo(?!\*)|cash\s+app|stripe|zelle\s*(?:to|payment)?|pocketsflow|remitly|revolut)\b/i

export function inferAccountKind(institution: string): AccountKind {
  const norm = institution.trim().toLowerCase()
  if (!norm) return "TRADITIONAL"
  for (const m of MONEY_MOVER_INSTITUTIONS) {
    if (norm.includes(m)) return "MONEY_MOVER"
  }
  return "TRADITIONAL"
}

/**
 * True if the merchant text on an OUTFLOW indicates the money is moving
 * into a money-mover wallet (top-up). Use after 1:1 pair-matching has
 * failed — these outflows are correctly TRANSFER even without a paired
 * inflow on a known account.
 */
export function isMoneyMoverOutflow(merchantRaw: string): boolean {
  return MONEY_MOVER_OUTFLOW_RX.test(merchantRaw)
}
