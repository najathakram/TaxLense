-- CreateTable
CREATE TABLE "AccountYearLink" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "taxYearId" TEXT NOT NULL,
    "nickname" TEXT,
    "isClosed" BOOLEAN NOT NULL DEFAULT false,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountYearLink_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccountYearLink_accountId_taxYearId_key" ON "AccountYearLink"("accountId", "taxYearId");

-- AddForeignKey
ALTER TABLE "AccountYearLink" ADD CONSTRAINT "AccountYearLink_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountYearLink" ADD CONSTRAINT "AccountYearLink_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
