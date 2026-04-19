-- CreateEnum
CREATE TYPE "ExtractionPath" AS ENUM ('CSV', 'OFX', 'PDF_PARSE', 'HAIKU_CLEANUP', 'VISION_DOC');

-- CreateEnum
CREATE TYPE "ImportSessionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETE', 'ABORTED');

-- AlterEnum
ALTER TYPE "ReportKind" ADD VALUE 'TAX_PACKAGE';

-- AlterTable
ALTER TABLE "StatementImport" ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "aiTokensIn" INTEGER,
ADD COLUMN     "aiTokensOut" INTEGER,
ADD COLUMN     "extractionConfidence" DOUBLE PRECISION,
ADD COLUMN     "extractionPath" "ExtractionPath",
ADD COLUMN     "sessionId" TEXT,
ADD COLUMN     "userNotes" JSONB;

-- CreateTable
CREATE TABLE "ImportSession" (
    "id" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "cpaUserId" TEXT,
    "status" "ImportSessionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "totalApiCalls" INTEGER NOT NULL DEFAULT 0,
    "apiCallLimit" INTEGER NOT NULL DEFAULT 50,
    "notes" TEXT,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),

    CONSTRAINT "ImportSession_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "StatementImport" ADD CONSTRAINT "StatementImport_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ImportSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
