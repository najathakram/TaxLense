-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('CPA', 'CLIENT');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "role" "UserRole" NOT NULL DEFAULT 'CLIENT';

-- CreateTable
CREATE TABLE "CpaClient" (
    "id" TEXT NOT NULL,
    "cpaUserId" TEXT NOT NULL,
    "clientUserId" TEXT NOT NULL,
    "displayName" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CpaClient_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CpaClient_cpaUserId_clientUserId_key" ON "CpaClient"("cpaUserId", "clientUserId");

-- AddForeignKey
ALTER TABLE "CpaClient" ADD CONSTRAINT "CpaClient_cpaUserId_fkey" FOREIGN KEY ("cpaUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CpaClient" ADD CONSTRAINT "CpaClient_clientUserId_fkey" FOREIGN KEY ("clientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
