-- Phase A cleanup follow-up — mark transactions that the original (low-
-- quality) extraction created but the higher-quality Sonnet vision
-- re-extraction did NOT confirm. Excluded from totals + ledger views;
-- kept on disk for audit (no row deletion).

ALTER TABLE "Transaction" ADD COLUMN "isStale"     BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Transaction" ADD COLUMN "staleReason" TEXT;

CREATE INDEX "Transaction_taxYearId_isStale_idx" ON "Transaction"("taxYearId", "isStale");
