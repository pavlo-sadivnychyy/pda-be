-- AlterTable
ALTER TABLE "Quote" ADD COLUMN     "emailMessageId" TEXT,
ADD COLUMN     "lastEmailedTo" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ALTER COLUMN "currency" SET DEFAULT 'USD';
