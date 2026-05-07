-- ──────────────────────────────────────────────────────────────────────────
-- Phase 0.4 — PipelineRun row backs the live-progress UI on the pipeline
-- page. Allows long-running operations (Apply Rules, the future CPA agent)
-- to execute in a background container while the page-level server action
-- returns within a second. Replaces the 30s server-action ceiling.
-- ──────────────────────────────────────────────────────────────────────────

-- CreateEnum: PipelineRunStatus
CREATE TYPE "PipelineRunStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED', 'CANCELLED');

-- CreateEnum: PipelineRunKind
CREATE TYPE "PipelineRunKind" AS ENUM (
  'NORMALIZE_MERCHANTS',
  'MATCH_TRANSFERS',
  'MATCH_PAYMENTS',
  'MATCH_REFUNDS',
  'MERCHANT_AI',
  'APPLY_RULES',
  'RESIDUAL_AI',
  'BULK_CLASSIFY',
  'AUTO_RESOLVE_STOPS',
  'CPA_AGENT'
);

-- CreateTable: PipelineRun
CREATE TABLE "PipelineRun" (
  "id"                TEXT                NOT NULL,
  "taxYearId"         TEXT                NOT NULL,
  "kind"              "PipelineRunKind"   NOT NULL,
  "status"            "PipelineRunStatus" NOT NULL DEFAULT 'RUNNING',
  "progress"          JSONB               NOT NULL DEFAULT '{}'::jsonb,
  "result"            JSONB,
  "lastError"         TEXT,
  "startedAt"         TIMESTAMP(3)        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt"        TIMESTAMP(3),
  "initiatedByUserId" TEXT,
  "actorCpaUserId"    TEXT,
  "actorAdminUserId"  TEXT,

  CONSTRAINT "PipelineRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: most-recent-first lookup per TaxYear
CREATE INDEX "PipelineRun_taxYearId_startedAt_idx" ON "PipelineRun"("taxYearId", "startedAt" DESC);

-- AddForeignKey
ALTER TABLE "PipelineRun"
  ADD CONSTRAINT "PipelineRun_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
