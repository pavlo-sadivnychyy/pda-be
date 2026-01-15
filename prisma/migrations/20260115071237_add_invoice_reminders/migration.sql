-- CreateEnum
CREATE TYPE "InvoiceReminderKind" AS ENUM ('DEADLINE');

-- CreateTable
CREATE TABLE "InvoiceReminderLog" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sentById" TEXT NOT NULL,
    "kind" "InvoiceReminderKind" NOT NULL DEFAULT 'DEADLINE',
    "toEmail" TEXT NOT NULL,
    "subject" TEXT,
    "message" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceReminderLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InvoiceReminderLog_organizationId_sentAt_idx" ON "InvoiceReminderLog"("organizationId", "sentAt");

-- CreateIndex
CREATE INDEX "InvoiceReminderLog_invoiceId_sentAt_idx" ON "InvoiceReminderLog"("invoiceId", "sentAt");

-- CreateIndex
CREATE INDEX "InvoiceReminderLog_invoiceId_kind_sentAt_idx" ON "InvoiceReminderLog"("invoiceId", "kind", "sentAt");

-- AddForeignKey
ALTER TABLE "InvoiceReminderLog" ADD CONSTRAINT "InvoiceReminderLog_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceReminderLog" ADD CONSTRAINT "InvoiceReminderLog_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceReminderLog" ADD CONSTRAINT "InvoiceReminderLog_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
