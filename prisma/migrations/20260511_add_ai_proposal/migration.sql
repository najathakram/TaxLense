-- Add aiProposal JSON column for the review-first auto-resolve flow.
-- Carries the rich proposal (answer, code, confidence, reasoning, prior cases)
-- that the new generateAiProposals engine writes for every PENDING stop.
-- Distinct from the existing aiSuggestion column (which is just a radio
-- pre-fill) so the /review screen has a dedicated, opinionated payload.
ALTER TABLE "StopItem" ADD COLUMN "aiProposal" JSONB;

-- Add new PipelineRunKind for the proposal-generation background job.
ALTER TYPE "PipelineRunKind" ADD VALUE IF NOT EXISTS 'GENERATE_AI_PROPOSALS';
