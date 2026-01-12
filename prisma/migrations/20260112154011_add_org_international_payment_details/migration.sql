-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "bankAddress" TEXT,
ADD COLUMN     "bankName" TEXT,
ADD COLUMN     "beneficiaryName" TEXT,
ADD COLUMN     "iban" TEXT,
ADD COLUMN     "legalAddress" TEXT,
ADD COLUMN     "legalName" TEXT,
ADD COLUMN     "paymentReferenceHint" TEXT,
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "swiftBic" TEXT,
ADD COLUMN     "vatId" TEXT;
