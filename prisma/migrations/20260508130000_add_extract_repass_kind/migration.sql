-- Phase A follow-up — extend PipelineRunKind for the Sonnet-vision
-- re-extraction step. ALTER TYPE ADD VALUE is idempotent on Postgres
-- (errors silently if value already exists, then succeeds), so the
-- migration is safe to re-run.

ALTER TYPE "PipelineRunKind" ADD VALUE 'EXTRACT_REPASS';
