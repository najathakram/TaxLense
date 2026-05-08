-- ──────────────────────────────────────────────────────────────────────────
-- Owner model — one row per shareholder / partner / member. Drives multi-
-- owner Schedule K-1 generation. For SOLE_PROP / LLC_SINGLE the table is
-- unused; the owner is the User row implicitly.
--
-- Ownership values are decimal percent (0-100). The application enforces
-- the sum-to-100 invariant at write time; the DB stores them as Decimal.
--
-- Sensitive PII: only ssnLast4 (matches what the K-1 form requires) and
-- ein (for entity owners). Full SSN is never stored.
-- ──────────────────────────────────────────────────────────────────────────

CREATE TABLE "Owner" (
  "id"                 TEXT          NOT NULL,
  "profileId"          TEXT          NOT NULL,
  "kind"               TEXT          NOT NULL,
  "name"               TEXT          NOT NULL,
  "ssnLast4"           TEXT,
  "ein"                TEXT,
  "ownershipPct"       DECIMAL(7,4)  NOT NULL,
  "w2Wages"            DECIMAL(15,2),
  "guaranteedPayments" DECIMAL(15,2),
  "notes"              TEXT,
  "createdAt"          TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Owner_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Owner_profileId_idx" ON "Owner"("profileId");

ALTER TABLE "Owner"
  ADD CONSTRAINT "Owner_profileId_fkey"
  FOREIGN KEY ("profileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
