-- CreateEnum
CREATE TYPE "EntityType" AS ENUM ('SOLE_PROP', 'LLC_SINGLE');

-- CreateEnum
CREATE TYPE "AccountingMethod" AS ENUM ('CASH', 'ACCRUAL');

-- CreateEnum
CREATE TYPE "TaxYearStatus" AS ENUM ('CREATED', 'INGESTION', 'CLASSIFICATION', 'REVIEW', 'LOCKED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('CHECKING', 'SAVINGS', 'CREDIT_CARD', 'BROKERAGE', 'PAYMENT_PROCESSOR');

-- CreateEnum
CREATE TYPE "ParseStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'PARTIAL');

-- CreateEnum
CREATE TYPE "ReportKind" AS ENUM ('MASTER_LEDGER', 'FINANCIAL_STATEMENTS', 'AUDIT_PACKET');

-- CreateEnum
CREATE TYPE "TransactionCode" AS ENUM ('WRITE_OFF', 'WRITE_OFF_TRAVEL', 'WRITE_OFF_COGS', 'MEALS_50', 'MEALS_100', 'GRAY', 'PERSONAL', 'TRANSFER', 'PAYMENT', 'BIZ_INCOME', 'NEEDS_CONTEXT');

-- CreateEnum
CREATE TYPE "ClassificationSource" AS ENUM ('AI', 'USER', 'AI_USER_CONFIRMED');

-- CreateEnum
CREATE TYPE "StopCategory" AS ENUM ('MERCHANT', 'TRANSFER', 'PERIOD_GAP', 'DEPOSIT', 'SECTION_274D');

-- CreateEnum
CREATE TYPE "StopState" AS ENUM ('PENDING', 'ANSWERED', 'DEFERRED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'AI', 'SYSTEM');

-- CreateEnum
CREATE TYPE "KnownEntityKind" AS ENUM ('PERSON_PERSONAL', 'PERSON_CONTRACTOR', 'PERSON_CLIENT', 'PATTERN_EXCLUDED', 'PATTERN_INCOME');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VerificationToken" (
    "identifier" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL
);

-- CreateTable
CREATE TABLE "RuleVersion" (
    "id" TEXT NOT NULL,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "ruleSet" JSONB NOT NULL,
    "summary" TEXT,
    "supersededById" TEXT,

    CONSTRAINT "RuleVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxYear" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "TaxYearStatus" NOT NULL DEFAULT 'CREATED',
    "ruleVersionId" TEXT,
    "lockedAt" TIMESTAMP(3),
    "lockedSnapshotHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "naicsCode" TEXT NOT NULL,
    "entityType" "EntityType" NOT NULL,
    "primaryState" TEXT NOT NULL,
    "businessDescription" TEXT NOT NULL,
    "grossReceiptsEstimate" DECIMAL(15,2) NOT NULL,
    "accountingMethod" "AccountingMethod" NOT NULL DEFAULT 'CASH',
    "homeOfficeConfig" JSONB NOT NULL,
    "vehicleConfig" JSONB NOT NULL,
    "inventoryConfig" JSONB,
    "revenueStreams" TEXT[],
    "firstYear" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BusinessProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KnownEntity" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "kind" "KnownEntityKind" NOT NULL,
    "displayName" TEXT NOT NULL,
    "matchKeywords" TEXT[],
    "defaultCode" "TransactionCode",
    "notes" TEXT,

    CONSTRAINT "KnownEntity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trip" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "destination" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "purpose" TEXT NOT NULL,
    "deliverableDescription" TEXT,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Trip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "institution" TEXT NOT NULL,
    "mask" TEXT,
    "nickname" TEXT,
    "isPrimaryBusiness" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "FinancialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatementImport" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "parseStatus" "ParseStatus" NOT NULL DEFAULT 'PENDING',
    "parseConfidence" DOUBLE PRECISION,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StatementImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL,
    "statementImportId" TEXT,
    "accountId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "postedDate" TIMESTAMP(3) NOT NULL,
    "transactionDate" TIMESTAMP(3),
    "amountOriginal" DECIMAL(15,2) NOT NULL,
    "amountNormalized" DECIMAL(15,2) NOT NULL,
    "merchantRaw" TEXT NOT NULL,
    "merchantNormalized" TEXT,
    "descriptionRaw" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "isDuplicateOf" TEXT,
    "isTransferPairedWith" TEXT,
    "isPaymentPairedWith" TEXT,
    "isRefundPairedWith" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Classification" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "code" "TransactionCode" NOT NULL,
    "scheduleCLine" TEXT,
    "businessPct" INTEGER NOT NULL,
    "ircCitations" TEXT[],
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidenceTier" INTEGER NOT NULL,
    "source" "ClassificationSource" NOT NULL,
    "reasoning" TEXT,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdByUserId" TEXT,

    CONSTRAINT "Classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantRule" (
    "id" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "code" "TransactionCode" NOT NULL,
    "scheduleCLine" TEXT,
    "businessPctDefault" INTEGER NOT NULL,
    "appliesTripOverride" BOOLEAN NOT NULL DEFAULT false,
    "ircCitations" TEXT[],
    "evidenceTierDefault" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "reasoning" TEXT,
    "requiresHumanInput" BOOLEAN NOT NULL DEFAULT false,
    "humanQuestion" TEXT,
    "isConfirmed" BOOLEAN NOT NULL DEFAULT false,
    "originalSample" TEXT,
    "totalTransactions" INTEGER NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(15,2) NOT NULL DEFAULT 0,

    CONSTRAINT "MerchantRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StopItem" (
    "id" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "merchantRuleId" TEXT,
    "category" "StopCategory" NOT NULL,
    "question" TEXT NOT NULL,
    "context" JSONB NOT NULL,
    "transactionIds" TEXT[],
    "state" "StopState" NOT NULL DEFAULT 'PENDING',
    "userAnswer" JSONB,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "StopItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "actorType" "ActorType" NOT NULL,
    "eventType" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "beforeState" JSONB,
    "afterState" JSONB,
    "rationale" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "kind" "ReportKind" NOT NULL,
    "filePath" TEXT NOT NULL,
    "ruleVersionId" TEXT,
    "transactionSnapshotHash" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_token_key" ON "VerificationToken"("token");

-- CreateIndex
CREATE UNIQUE INDEX "VerificationToken_identifier_token_key" ON "VerificationToken"("identifier", "token");

-- CreateIndex
CREATE UNIQUE INDEX "TaxYear_userId_year_key" ON "TaxYear"("userId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessProfile_taxYearId_key" ON "BusinessProfile"("taxYearId");

-- CreateIndex
CREATE UNIQUE INDEX "StatementImport_sourceHash_key" ON "StatementImport"("sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "StatementImport_accountId_sourceHash_key" ON "StatementImport"("accountId", "sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_idempotencyKey_key" ON "Transaction"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Transaction_taxYearId_postedDate_idx" ON "Transaction"("taxYearId", "postedDate");

-- CreateIndex
CREATE INDEX "Transaction_accountId_postedDate_idx" ON "Transaction"("accountId", "postedDate");

-- CreateIndex
CREATE INDEX "Classification_transactionId_isCurrent_idx" ON "Classification"("transactionId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantRule_taxYearId_merchantKey_key" ON "MerchantRule"("taxYearId", "merchantKey");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_occurredAt_idx" ON "AuditEvent"("userId", "occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleVersion" ADD CONSTRAINT "RuleVersion_supersededById_fkey" FOREIGN KEY ("supersededById") REFERENCES "RuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxYear" ADD CONSTRAINT "TaxYear_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxYear" ADD CONSTRAINT "TaxYear_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "RuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessProfile" ADD CONSTRAINT "BusinessProfile_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KnownEntity" ADD CONSTRAINT "KnownEntity_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trip" ADD CONSTRAINT "Trip_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "BusinessProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_statementImportId_fkey" FOREIGN KEY ("statementImportId") REFERENCES "StatementImport"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_isDuplicateOf_fkey" FOREIGN KEY ("isDuplicateOf") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_isTransferPairedWith_fkey" FOREIGN KEY ("isTransferPairedWith") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_isPaymentPairedWith_fkey" FOREIGN KEY ("isPaymentPairedWith") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_isRefundPairedWith_fkey" FOREIGN KEY ("isRefundPairedWith") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Classification" ADD CONSTRAINT "Classification_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantRule" ADD CONSTRAINT "MerchantRule_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopItem" ADD CONSTRAINT "StopItem_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StopItem" ADD CONSTRAINT "StopItem_merchantRuleId_fkey" FOREIGN KEY ("merchantRuleId") REFERENCES "MerchantRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_ruleVersionId_fkey" FOREIGN KEY ("ruleVersionId") REFERENCES "RuleVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;
