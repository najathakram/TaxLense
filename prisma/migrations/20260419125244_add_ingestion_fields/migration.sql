/*
  Warnings:

  - Added the required column `originalFilename` to the `StatementImport` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "StatementImport_sourceHash_key";

-- AlterTable
ALTER TABLE "StatementImport" ADD COLUMN     "institution" TEXT,
ADD COLUMN     "originalFilename" TEXT NOT NULL,
ADD COLUMN     "parseError" TEXT,
ADD COLUMN     "reconciliationDelta" DECIMAL(15,2),
ADD COLUMN     "reconciliationOk" BOOLEAN,
ADD COLUMN     "totalInflows" DECIMAL(15,2),
ADD COLUMN     "totalOutflows" DECIMAL(15,2),
ADD COLUMN     "transactionCount" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "periodStart" DROP NOT NULL,
ALTER COLUMN "periodEnd" DROP NOT NULL;
