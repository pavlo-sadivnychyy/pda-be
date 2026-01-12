/*
  Warnings:

  - You are about to drop the column `internationalPdfDocumentId` on the `Invoice` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[pdfInternationalDocumentId]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.

*/
-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_internationalPdfDocumentId_fkey";

-- DropIndex
DROP INDEX "Invoice_internationalPdfDocumentId_key";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "internationalPdfDocumentId",
ADD COLUMN     "pdfInternationalDocumentId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_pdfInternationalDocumentId_key" ON "Invoice"("pdfInternationalDocumentId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_pdfInternationalDocumentId_fkey" FOREIGN KEY ("pdfInternationalDocumentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;
