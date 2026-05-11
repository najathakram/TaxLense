-- Phase A: schema additions for the rest of the plan
--   - Owner             (per-shareholder/partner records for K-1)
--   - PriorYearContext  (carryforward engine)
--   - EngagementLetter  (P6 engagement workflow)
--   - Form8879          (P6 e-file authorization)
--   - FilingMilestone   (P6 filing status tracker)
--   - W9Submission      (P2.3 1099 contractor TIN capture)
--   - Form1099Filing    (P2.3 1099-NEC issuance record)
--   - ClassificationNote (P7 per-classification CPA notes)

-- ── Enums ───────────────────────────────────────────────────────────────────
-- (OwnerRole intentionally omitted — existing Owner.kind is a free-text
-- field already covering OFFICER/SHAREHOLDER/GENERAL_PARTNER/LIMITED_PARTNER/
-- MEMBER. We extend it with PROPRIETOR via convention, not enum.)

CREATE TYPE "SignatureStatus" AS ENUM (
  'NOT_REQUESTED', 'REQUESTED', 'SIGNED', 'DECLINED', 'EXPIRED'
);

CREATE TYPE "FilingStatus" AS ENUM (
  'NOT_STARTED',
  'ENGAGEMENT_SIGNED',
  'TAXPAYER_8879_SIGNED',
  'EFILED',
  'ACCEPTED_BY_IRS',
  'REJECTED_BY_IRS',
  'PAPER_FILED',
  'REFUND_RECEIVED',
  'BALANCE_PAID'
);

CREATE TYPE "W9Status" AS ENUM ('NOT_REQUESTED', 'REQUESTED', 'RECEIVED', 'EXEMPT');

-- ── Owner — extend existing model with K-1 / 1099 / M-2 fields ─────────────
-- The Owner table already exists (per prior migration) attached to
-- BusinessProfile via profileId. We add the per-shareholder/partner fields
-- needed for K-1 box A (address), engagement letter delivery (email), and
-- M-2 capital roll-forward (capitalContribution / distributions / basis).

ALTER TABLE "Owner"
  ADD COLUMN IF NOT EXISTS "email"               TEXT,
  ADD COLUMN IF NOT EXISTS "addressLine1"        TEXT,
  ADD COLUMN IF NOT EXISTS "addressLine2"        TEXT,
  ADD COLUMN IF NOT EXISTS "city"                TEXT,
  ADD COLUMN IF NOT EXISTS "stateRegion"         TEXT,
  ADD COLUMN IF NOT EXISTS "postalCode"          TEXT,
  ADD COLUMN IF NOT EXISTS "countryCode"         TEXT     NOT NULL DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS "capitalContribution" DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "distributions"       DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "stockBasis"          DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "debtBasis"           DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "partnerCapitalStart" DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "bookTaxDelta"        DECIMAL(15,2),
  ADD COLUMN IF NOT EXISTS "isActive"            BOOLEAN  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "Owner_profileId_kind_idx" ON "Owner"("profileId", "kind");

-- ── PriorYearContext ────────────────────────────────────────────────────────
CREATE TABLE "PriorYearContext" (
  "id"                       TEXT      NOT NULL,
  "taxYearId"                TEXT      NOT NULL,
  "sourcePriorYearId"        TEXT,
  "sourceLockedHash"         TEXT,
  "netOperatingLoss"         DECIMAL(15,2),
  "section179Carryover"      DECIMAL(15,2),
  "passiveLossCarryforward"  DECIMAL(15,2),
  "capitalLossShortTerm"     DECIMAL(15,2),
  "capitalLossLongTerm"      DECIMAL(15,2),
  "charitableCarryforward"   JSONB,
  "amtCreditCarryforward"    DECIMAL(15,2),
  "qbiLossCarryforward"      DECIMAL(15,2),
  "section163jCarryforward"  DECIMAL(15,2),
  "depreciationSchedule"     JSONB,
  "shareholderBasis"         JSONB,
  "partnerCapital"           JSONB,
  "suspendedLosses"          JSONB,
  "computedAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PriorYearContext_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriorYearContext_taxYearId_key" ON "PriorYearContext"("taxYearId");

ALTER TABLE "PriorYearContext"
  ADD CONSTRAINT "PriorYearContext_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE;

ALTER TABLE "PriorYearContext"
  ADD CONSTRAINT "PriorYearContext_sourcePriorYearId_fkey"
  FOREIGN KEY ("sourcePriorYearId") REFERENCES "TaxYear"("id");

-- ── EngagementLetter ────────────────────────────────────────────────────────
CREATE TABLE "EngagementLetter" (
  "id"               TEXT      NOT NULL,
  "taxYearId"        TEXT      NOT NULL,
  "bodyMarkdown"     TEXT      NOT NULL,
  "cpaUserId"        TEXT      NOT NULL,
  "cpaSignedAt"      TIMESTAMP(3),
  "clientSignedAt"   TIMESTAMP(3),
  "clientName"       TEXT,
  "clientEmail"      TEXT,
  "signatureStatus"  "SignatureStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "signatureToken"   TEXT,
  "signedPdfPath"    TEXT,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL,
  CONSTRAINT "EngagementLetter_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EngagementLetter_taxYearId_key" ON "EngagementLetter"("taxYearId");
CREATE UNIQUE INDEX "EngagementLetter_signatureToken_key" ON "EngagementLetter"("signatureToken");

ALTER TABLE "EngagementLetter"
  ADD CONSTRAINT "EngagementLetter_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE;

ALTER TABLE "EngagementLetter"
  ADD CONSTRAINT "EngagementLetter_cpaUserId_fkey"
  FOREIGN KEY ("cpaUserId") REFERENCES "User"("id");

-- ── Form8879 ────────────────────────────────────────────────────────────────
CREATE TABLE "Form8879" (
  "id"                TEXT      NOT NULL,
  "taxYearId"         TEXT      NOT NULL,
  "totalIncomeUsd"    DECIMAL(15,2) NOT NULL,
  "taxableIncomeUsd"  DECIMAL(15,2) NOT NULL,
  "totalTaxUsd"       DECIMAL(15,2) NOT NULL,
  "refundOrAmtDue"    DECIMAL(15,2) NOT NULL,
  "eroPin"            TEXT,
  "taxpayerPin"       TEXT,
  "spousePin"         TEXT,
  "signatureStatus"   "SignatureStatus" NOT NULL DEFAULT 'NOT_REQUESTED',
  "signatureToken"    TEXT,
  "signedAt"          TIMESTAMP(3),
  "signedPdfPath"     TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Form8879_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Form8879_taxYearId_key" ON "Form8879"("taxYearId");
CREATE UNIQUE INDEX "Form8879_signatureToken_key" ON "Form8879"("signatureToken");

ALTER TABLE "Form8879"
  ADD CONSTRAINT "Form8879_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE;

-- ── FilingMilestone ─────────────────────────────────────────────────────────
CREATE TABLE "FilingMilestone" (
  "id"           TEXT      NOT NULL,
  "taxYearId"    TEXT      NOT NULL,
  "status"       "FilingStatus" NOT NULL,
  "occurredAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "recordedBy"   TEXT      NOT NULL,
  "notes"        TEXT,
  "externalRef"  TEXT,
  CONSTRAINT "FilingMilestone_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FilingMilestone_taxYearId_occurredAt_idx"
  ON "FilingMilestone"("taxYearId", "occurredAt" DESC);

ALTER TABLE "FilingMilestone"
  ADD CONSTRAINT "FilingMilestone_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE;

ALTER TABLE "FilingMilestone"
  ADD CONSTRAINT "FilingMilestone_recordedBy_fkey"
  FOREIGN KEY ("recordedBy") REFERENCES "User"("id");

-- ── W9Submission ────────────────────────────────────────────────────────────
CREATE TABLE "W9Submission" (
  "id"                  TEXT      NOT NULL,
  "taxYearId"           TEXT      NOT NULL,
  "payeeName"           TEXT      NOT NULL,
  "businessName"        TEXT,
  "taxClassification"   TEXT,
  "tin"                 TEXT,
  "isEntityCorporation" BOOLEAN   NOT NULL DEFAULT false,
  "isExempt"            BOOLEAN   NOT NULL DEFAULT false,
  "exemptCode"          TEXT,
  "addressLine1"        TEXT,
  "addressLine2"        TEXT,
  "city"                TEXT,
  "stateRegion"         TEXT,
  "postalCode"          TEXT,
  "status"              "W9Status" NOT NULL DEFAULT 'NOT_REQUESTED',
  "requestedAt"         TIMESTAMP(3),
  "receivedAt"          TIMESTAMP(3),
  "signedW9Path"        TEXT,
  "payeeEmail"          TEXT,
  "notes"               TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,
  CONSTRAINT "W9Submission_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "W9Submission_taxYearId_payeeName_key"
  ON "W9Submission"("taxYearId", "payeeName");
CREATE INDEX "W9Submission_taxYearId_status_idx"
  ON "W9Submission"("taxYearId", "status");

ALTER TABLE "W9Submission"
  ADD CONSTRAINT "W9Submission_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE;

-- ── Form1099Filing ──────────────────────────────────────────────────────────
CREATE TABLE "Form1099Filing" (
  "id"                     TEXT      NOT NULL,
  "taxYearId"              TEXT      NOT NULL,
  "recipientName"          TEXT      NOT NULL,
  "recipientTin"           TEXT,
  "recipientAddress"       JSONB,
  "box1NonemployeeComp"    DECIMAL(15,2),
  "box4FederalTaxWithheld" DECIMAL(15,2),
  "filingPath"             TEXT      NOT NULL DEFAULT 'PAPER',
  "filedAt"                TIMESTAMP(3),
  "externalAck"            TEXT,
  "sourceTransactionIds"   TEXT[],
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Form1099Filing_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Form1099Filing_taxYearId_recipientName_key"
  ON "Form1099Filing"("taxYearId", "recipientName");
CREATE INDEX "Form1099Filing_taxYearId_idx" ON "Form1099Filing"("taxYearId");

ALTER TABLE "Form1099Filing"
  ADD CONSTRAINT "Form1099Filing_taxYearId_fkey"
  FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE;

-- ── ClassificationNote ──────────────────────────────────────────────────────
CREATE TABLE "ClassificationNote" (
  "id"               TEXT      NOT NULL,
  "classificationId" TEXT      NOT NULL,
  "authorUserId"     TEXT      NOT NULL,
  "body"             TEXT      NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ClassificationNote_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ClassificationNote_classificationId_createdAt_idx"
  ON "ClassificationNote"("classificationId", "createdAt" DESC);

ALTER TABLE "ClassificationNote"
  ADD CONSTRAINT "ClassificationNote_classificationId_fkey"
  FOREIGN KEY ("classificationId") REFERENCES "Classification"("id") ON DELETE CASCADE;

ALTER TABLE "ClassificationNote"
  ADD CONSTRAINT "ClassificationNote_authorUserId_fkey"
  FOREIGN KEY ("authorUserId") REFERENCES "User"("id");
