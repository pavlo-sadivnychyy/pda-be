-- CreateEnum
CREATE TYPE "RecurringProfileStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecurringIntervalUnit" AS ENUM ('DAY', 'WEEK', 'MONTH', 'YEAR');

-- CreateEnum
CREATE TYPE "RecurringRunStatus" AS ENUM ('SUCCESS', 'FAILED', 'SKIPPED');

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "recurringProfileId" TEXT;

-- CreateTable
CREATE TABLE "RecurringInvoiceProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "clientId" TEXT,
    "createdById" TEXT NOT NULL,
    "templateInvoiceId" TEXT NOT NULL,
    "intervalUnit" "RecurringIntervalUnit" NOT NULL,
    "intervalCount" INTEGER NOT NULL DEFAULT 1,
    "startAt" TIMESTAMP(3) NOT NULL,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "dueDays" INTEGER NOT NULL DEFAULT 7,
    "autoSendEmail" BOOLEAN NOT NULL DEFAULT false,
    "variant" TEXT NOT NULL DEFAULT 'ua',
    "status" "RecurringProfileStatus" NOT NULL DEFAULT 'ACTIVE',
    "lastRunAt" TIMESTAMP(3),
    "lastInvoiceId" TEXT,
    "lastError" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringInvoiceProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringInvoiceRun" (
    "id" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL,
    "status" "RecurringRunStatus" NOT NULL,
    "invoiceId" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringInvoiceRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RecurringInvoiceProfile_organizationId_status_nextRunAt_idx" ON "RecurringInvoiceProfile"("organizationId", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringInvoiceProfile_templateInvoiceId_idx" ON "RecurringInvoiceProfile"("templateInvoiceId");

-- CreateIndex
CREATE INDEX "RecurringInvoiceProfile_clientId_idx" ON "RecurringInvoiceProfile"("clientId");

-- CreateIndex
CREATE INDEX "RecurringInvoiceRun_profileId_runAt_idx" ON "RecurringInvoiceRun"("profileId", "runAt");

-- CreateIndex
CREATE INDEX "RecurringInvoiceRun_invoiceId_idx" ON "RecurringInvoiceRun"("invoiceId");

-- CreateIndex
CREATE INDEX "Invoice_recurringProfileId_idx" ON "Invoice"("recurringProfileId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_recurringProfileId_fkey" FOREIGN KEY ("recurringProfileId") REFERENCES "RecurringInvoiceProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceProfile" ADD CONSTRAINT "RecurringInvoiceProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceProfile" ADD CONSTRAINT "RecurringInvoiceProfile_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceProfile" ADD CONSTRAINT "RecurringInvoiceProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceProfile" ADD CONSTRAINT "RecurringInvoiceProfile_templateInvoiceId_fkey" FOREIGN KEY ("templateInvoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "RecurringInvoiceProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringInvoiceRun" ADD CONSTRAINT "RecurringInvoiceRun_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
