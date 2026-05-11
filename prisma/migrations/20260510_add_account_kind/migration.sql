-- AccountKind: orthogonal to AccountType. Distinguishes traditional bank/CC
-- accounts from money-mover wallets (Wise, PayPal, Venmo, Stripe, Cash App,
-- Zelle) where 1:1 transfer pairing fails because the wallet aggregates
-- balance. Outflows TO a money-mover are TRANSFERs (no pair required);
-- outflows FROM a money-mover are the real expenses.

CREATE TYPE "AccountKind" AS ENUM ('TRADITIONAL', 'MONEY_MOVER');

ALTER TABLE "FinancialAccount"
  ADD COLUMN "kind" "AccountKind" NOT NULL DEFAULT 'TRADITIONAL';

-- Backfill known money-mover institutions. Case-insensitive match on
-- institution name. The list mirrors lib/accounts/kind.ts and must stay
-- in sync — if you add a pattern here, add it there too.
UPDATE "FinancialAccount"
SET "kind" = 'MONEY_MOVER'
WHERE
  "institution" ~* 'wise'
  OR "institution" ~* 'paypal'
  OR "institution" ~* 'venmo'
  OR "institution" ~* 'cash ?app'
  OR "institution" ~* 'stripe'
  OR "institution" ~* 'zelle'
  OR "institution" ~* 'pocketsflow'
  OR "institution" ~* 'remitly'
  OR "institution" ~* 'transferwise'
  OR "institution" ~* 'revolut';
