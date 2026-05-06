-- CreateEnum
CREATE TYPE "DocumentCategory" AS ENUM ('STATEMENT', 'TAX_FORM_RECEIVED', 'TAX_FORM_ISSUED', 'ENGAGEMENT_LEGAL', 'IRS_CORRESPONDENCE', 'RECEIPT', 'OTHER');

-- AlterTable
ALTER TABLE "AuditEvent" ADD COLUMN "actorCpaUserId" TEXT;

-- CreateIndex
CREATE INDEX "AuditEvent_actorCpaUserId_occurredAt_idx" ON "AuditEvent"("actorCpaUserId", "occurredAt" DESC);

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorCpaUserId_fkey" FOREIGN KEY ("actorCpaUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "taxYearId" TEXT,
    "category" "DocumentCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "filePath" TEXT NOT NULL,
    "originalFilename" TEXT NOT NULL,
    "mimeType" TEXT,
    "sizeBytes" INTEGER,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "uploadedByUserId" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "linkedTransactionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Document_userId_category_idx" ON "Document"("userId", "category");

-- CreateIndex
CREATE INDEX "Document_taxYearId_idx" ON "Document"("taxYearId");

-- CreateIndex
CREATE INDEX "Document_uploadedByUserId_uploadedAt_idx" ON "Document"("uploadedByUserId", "uploadedAt" DESC);

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;
