/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,number]` on the table `Quote` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Quote_number_key";

-- CreateIndex
CREATE INDEX "Quote_organizationId_createdAt_idx" ON "Quote"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Quote_organizationId_number_key" ON "Quote"("organizationId", "number");
