-- Auto-CPA Framework migration
-- Adds: LedgerFinding model, Classification.cohanFlag, 6 new PipelineRunKind values.
-- See: lib/ai/cpaAudit.ts, lib/ai/cohanSweep.ts, lib/ai/substantiationQueue.ts,
--      lib/cleanup/preClassification.ts, lib/findings/apply.ts, lib/lock/relockVerify.ts.

-- 1. New PipelineRunKind enum values
ALTER TYPE "PipelineRunKind" ADD VALUE IF NOT EXISTS 'PRE_CLEANUP';
ALTER TYPE "PipelineRunKind" ADD VALUE IF NOT EXISTS 'CPA_AUDIT';
ALTER TYPE "PipelineRunKind" ADD VALUE IF NOT EXISTS 'COHAN_SWEEP';
ALTER TYPE "PipelineRunKind" ADD VALUE IF NOT EXISTS 'SUBSTANTIATION_QUEUE';
ALTER TYPE "PipelineRunKind" ADD VALUE IF NOT EXISTS 'FINDINGS_APPLY';
ALTER TYPE "PipelineRunKind" ADD VALUE IF NOT EXISTS 'RELOCK_VERIFY';

-- 2. Classification.cohanFlag — explicit boolean instead of deriving from tier
ALTER TABLE "Classification"
  ADD COLUMN IF NOT EXISTS "cohanFlag" BOOLEAN NOT NULL DEFAULT false;

-- 3. Backfill cohanFlag on existing rows that the audit packet currently
--    treats as Cohan-flagged (evidenceTier >= 4 + deductible code). This
--    preserves the current 03_cohan_labels.csv behavior verbatim. For Atif's
--    ledger today this is a no-op (zero tier-4 rows) but it's the right
--    correctness backfill for any future client.
UPDATE "Classification"
   SET "cohanFlag" = true
 WHERE "isCurrent" = true
   AND "evidenceTier" >= 4
   AND "code" IN (
     'WRITE_OFF', 'WRITE_OFF_TRAVEL', 'WRITE_OFF_COGS',
     'MEALS_50', 'MEALS_100', 'GRAY'
   );

-- 4. LedgerFinding model
CREATE TABLE "LedgerFinding" (
  "id"                  TEXT NOT NULL,
  "taxYearId"           TEXT NOT NULL,
  "generatedRunId"      TEXT,
  "severity"            TEXT NOT NULL,
  "category"            TEXT NOT NULL,
  "title"               TEXT NOT NULL,
  "rationale"           TEXT NOT NULL,
  "autoFixable"         BOOLEAN NOT NULL,
  "proposedAction"      JSONB NOT NULL,
  "citedTxnIds"         TEXT[] NOT NULL,
  "state"               TEXT NOT NULL DEFAULT 'PROPOSED',
  "dismissedRationale"  TEXT,
  "supersedesId"        TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LedgerFinding_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LedgerFinding_taxYearId_state_idx"      ON "LedgerFinding"("taxYearId", "state");
CREATE INDEX "LedgerFinding_taxYearId_severity_idx"   ON "LedgerFinding"("taxYearId", "severity");
CREATE INDEX "LedgerFinding_generatedRunId_idx"       ON "LedgerFinding"("generatedRunId");

ALTER TABLE "LedgerFinding"
  ADD CONSTRAINT "LedgerFinding_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LedgerFinding"
  ADD CONSTRAINT "LedgerFinding_supersedesId_fkey"
  FOREIGN KEY ("supersedesId") REFERENCES "LedgerFinding"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
