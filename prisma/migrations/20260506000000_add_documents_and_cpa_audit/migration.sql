-- ──────────────────────────────────────────────────────────────────────────
-- Redesign-prep migration. Three concerns bundled:
--   1. Document model + DocumentCategory enum
--   2. AuditEvent.actorCpaUserId (CPA actor when impersonating a client)
--   3. AuditEvent.actorAdminUserId + UserRole.SUPER_ADMIN + User.isActive
--      (platform super-admin tier — see design-brief/redesign-cpa-2026.md)
-- ──────────────────────────────────────────────────────────────────────────

-- AlterEnum: add SUPER_ADMIN to UserRole
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- AlterTable: User.isActive (soft-suspend; existing rows backfilled to TRUE)
ALTER TABLE "User" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- CreateEnum: DocumentCategory
CREATE TYPE "DocumentCategory" AS ENUM ('STATEMENT', 'TAX_FORM_RECEIVED', 'TAX_FORM_ISSUED', 'ENGAGEMENT_LEGAL', 'IRS_CORRESPONDENCE', 'RECEIPT', 'OTHER');

-- AlterTable: AuditEvent gains actor columns
ALTER TABLE "AuditEvent" ADD COLUMN "actorCpaUserId" TEXT;
ALTER TABLE "AuditEvent" ADD COLUMN "actorAdminUserId" TEXT;

-- CreateIndex: query AuditEvent by impersonation actor
CREATE INDEX "AuditEvent_actorCpaUserId_occurredAt_idx" ON "AuditEvent"("actorCpaUserId", "occurredAt" DESC);
CREATE INDEX "AuditEvent_actorAdminUserId_occurredAt_idx" ON "AuditEvent"("actorAdminUserId", "occurredAt" DESC);

-- AddForeignKey: AuditEvent → User for actor columns
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorCpaUserId_fkey"   FOREIGN KEY ("actorCpaUserId")   REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_actorAdminUserId_fkey" FOREIGN KEY ("actorAdminUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable: Document
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

-- CreateIndex: Document
CREATE INDEX "Document_userId_category_idx" ON "Document"("userId", "category");
CREATE INDEX "Document_taxYearId_idx" ON "Document"("taxYearId");
CREATE INDEX "Document_uploadedByUserId_uploadedAt_idx" ON "Document"("uploadedByUserId", "uploadedAt" DESC);

-- AddForeignKey: Document
ALTER TABLE "Document" ADD CONSTRAINT "Document_userId_fkey"           FOREIGN KEY ("userId")           REFERENCES "User"("id")    ON DELETE CASCADE  ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_uploadedByUserId_fkey" FOREIGN KEY ("uploadedByUserId") REFERENCES "User"("id")    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Document" ADD CONSTRAINT "Document_taxYearId_fkey"        FOREIGN KEY ("taxYearId")        REFERENCES "TaxYear"("id") ON DELETE SET NULL ON UPDATE CASCADE;
