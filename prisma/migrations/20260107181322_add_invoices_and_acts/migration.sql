/*
  Warnings:

  - You are about to drop the column `createdById` on the `Client` table. All the data in the column will be lost.
  - You are about to drop the column `paidAt` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `sentAt` on the `Invoice` table. All the data in the column will be lost.
  - You are about to alter the column `quantity` on the `InvoiceItem` table. The data in that column could be lost. The data in that column will be cast from `Decimal(10,2)` to `Integer`.
  - A unique constraint covering the columns `[number]` on the table `Invoice` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `createdById` to the `Act` table without a default value. This is not possible if the table is not empty.
  - Made the column `clientId` on table `Invoice` required. This step will fail if there are existing NULL values in that column.

*/
-- DropForeignKey
ALTER TABLE "Client" DROP CONSTRAINT "Client_createdById_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_clientId_fkey";

-- DropIndex
DROP INDEX "Client_createdById_idx";

-- DropIndex
DROP INDEX "Client_organizationId_idx";

-- DropIndex
DROP INDEX "Invoice_clientId_idx";

-- DropIndex
DROP INDEX "Invoice_createdById_idx";

-- DropIndex
DROP INDEX "Invoice_organizationId_idx";

-- DropIndex
DROP INDEX "Invoice_organizationId_number_key";

-- DropIndex
DROP INDEX "Invoice_status_idx";

-- AlterTable
ALTER TABLE "Act" ADD COLUMN     "createdById" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Client" DROP COLUMN "createdById";

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "paidAt",
DROP COLUMN "sentAt",
ALTER COLUMN "clientId" SET NOT NULL,
ALTER COLUMN "currency" SET DEFAULT 'UAH',
ALTER COLUMN "subtotal" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "taxAmount" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "total" SET DATA TYPE DECIMAL(18,2);

-- AlterTable
ALTER TABLE "InvoiceItem" ALTER COLUMN "quantity" SET DATA TYPE INTEGER,
ALTER COLUMN "unitPrice" SET DATA TYPE DECIMAL(18,2),
ALTER COLUMN "lineTotal" SET DATA TYPE DECIMAL(18,2);

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Act" ADD CONSTRAINT "Act_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
