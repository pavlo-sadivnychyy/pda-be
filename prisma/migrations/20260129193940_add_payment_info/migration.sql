/*
  Warnings:

  - You are about to drop the column `bankAddress` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `bankName` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `beneficiaryName` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `iban` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `legalAddress` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `legalName` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `paymentReferenceHint` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `registrationNumber` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `swiftBic` on the `Organization` table. All the data in the column will be lost.
  - You are about to drop the column `vatId` on the `Organization` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Organization" DROP COLUMN "bankAddress",
DROP COLUMN "bankName",
DROP COLUMN "beneficiaryName",
DROP COLUMN "iban",
DROP COLUMN "legalAddress",
DROP COLUMN "legalName",
DROP COLUMN "paymentReferenceHint",
DROP COLUMN "registrationNumber",
DROP COLUMN "swiftBic",
DROP COLUMN "vatId",
ADD COLUMN     "intlBankAddress" TEXT,
ADD COLUMN     "intlBankName" TEXT,
ADD COLUMN     "intlBeneficiaryName" TEXT,
ADD COLUMN     "intlIban" TEXT,
ADD COLUMN     "intlLegalAddress" TEXT,
ADD COLUMN     "intlLegalName" TEXT,
ADD COLUMN     "intlPaymentReferenceHint" TEXT,
ADD COLUMN     "intlRegistrationNumber" TEXT,
ADD COLUMN     "intlSwiftBic" TEXT,
ADD COLUMN     "intlVatId" TEXT,
ADD COLUMN     "uaAccountNumber" TEXT,
ADD COLUMN     "uaBankName" TEXT,
ADD COLUMN     "uaBeneficiaryName" TEXT,
ADD COLUMN     "uaCompanyAddress" TEXT,
ADD COLUMN     "uaCompanyName" TEXT,
ADD COLUMN     "uaEdrpou" TEXT,
ADD COLUMN     "uaIban" TEXT,
ADD COLUMN     "uaIpn" TEXT,
ADD COLUMN     "uaMfo" TEXT,
ADD COLUMN     "uaPaymentPurposeHint" TEXT;
