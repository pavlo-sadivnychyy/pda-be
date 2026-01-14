/*
  Warnings:

  - A unique constraint covering the columns `[organizationId,number]` on the table `Act` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE INDEX "Act_organizationId_createdAt_idx" ON "Act"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "Act_relatedInvoiceId_idx" ON "Act"("relatedInvoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Act_organizationId_number_key" ON "Act"("organizationId", "number");
