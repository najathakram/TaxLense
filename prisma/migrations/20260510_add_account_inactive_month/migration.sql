-- AccountInactiveMonth — CPA attestation that a (account, year, month)
-- combo had no real activity (account closed, dormant, statement
-- intentionally not uploaded). Without this, A14 (coverage-complete)
-- treats every month with no statement as a gap and blocks lock. Atif's
-- BofA was missing 6 months and Wise 5 months — some are real gaps, some
-- are inactive periods. CPA needs a way to attest the inactive ones.

CREATE TABLE "AccountInactiveMonth" (
  "id"          TEXT        NOT NULL,
  "accountId"   TEXT        NOT NULL,
  "taxYearId"   TEXT        NOT NULL,
  "year"        INTEGER     NOT NULL,
  "month"       INTEGER     NOT NULL,
  "reason"      TEXT        NOT NULL,
  "attestedBy"  TEXT        NOT NULL,
  "attestedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AccountInactiveMonth_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccountInactiveMonth_accountId_year_month_key"
  ON "AccountInactiveMonth"("accountId", "year", "month");

CREATE INDEX "AccountInactiveMonth_taxYearId_idx"
  ON "AccountInactiveMonth"("taxYearId");

ALTER TABLE "AccountInactiveMonth"
  ADD CONSTRAINT "AccountInactiveMonth_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE;

ALTER TABLE "AccountInactiveMonth"
  ADD CONSTRAINT "AccountInactiveMonth_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE;

ALTER TABLE "AccountInactiveMonth"
  ADD CONSTRAINT "AccountInactiveMonth_attestedBy_fkey"
  FOREIGN KEY ("attestedBy") REFERENCES "User"("id");
