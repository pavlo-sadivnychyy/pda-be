/*
  Warnings:

  - A unique constraint covering the columns `[pdfDocumentId]` on the table `Quote` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "pdfDocumentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Quote_pdfDocumentId_key" ON "Quote"("pdfDocumentId");

-- AddForeignKey
ALTER TABLE "Quote" ADD CONSTRAINT "Quote_pdfDocumentId_fkey" FOREIGN KEY ("pdfDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
