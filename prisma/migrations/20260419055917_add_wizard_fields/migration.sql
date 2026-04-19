-- AlterTable
ALTER TABLE "BusinessProfile" ADD COLUMN     "draftStep" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "incomeSources" JSONB,
ALTER COLUMN "naicsCode" DROP NOT NULL,
ALTER COLUMN "entityType" SET DEFAULT 'SOLE_PROP',
ALTER COLUMN "primaryState" SET DEFAULT '',
ALTER COLUMN "businessDescription" DROP NOT NULL,
ALTER COLUMN "grossReceiptsEstimate" DROP NOT NULL,
ALTER COLUMN "homeOfficeConfig" SET DEFAULT '{"has":false}',
ALTER COLUMN "vehicleConfig" SET DEFAULT '{"has":false}';
