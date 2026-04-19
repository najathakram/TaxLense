-- AddForeignKey
ALTER TABLE "ImportSession" ADD CONSTRAINT "ImportSession_taxYearId_fkey" FOREIGN KEY ("taxYearId") REFERENCES "TaxYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;
