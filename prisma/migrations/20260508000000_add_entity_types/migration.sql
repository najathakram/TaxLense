-- ──────────────────────────────────────────────────────────────────────────
-- Phase 2 — extend EntityType to cover S-Corp, multi-member LLC, C-Corp,
-- and a stub for general partnerships. Phase 2 ships S_CORP filing through
-- Form 1120-S + per-shareholder K-1; Phases 3/4 add LLC_MULTI (Form 1065)
-- and C_CORP (Form 1120).
-- ──────────────────────────────────────────────────────────────────────────

ALTER TYPE "EntityType" ADD VALUE 'S_CORP';
ALTER TYPE "EntityType" ADD VALUE 'LLC_MULTI';
ALTER TYPE "EntityType" ADD VALUE 'C_CORP';
ALTER TYPE "EntityType" ADD VALUE 'PARTNERSHIP';
