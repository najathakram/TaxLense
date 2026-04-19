-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "isSplit" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "splitOfId" TEXT;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_splitOfId_fkey" FOREIGN KEY ("splitOfId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;
