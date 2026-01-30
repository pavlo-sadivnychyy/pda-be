/*
  Warnings:

  - You are about to drop the column `monoStatus` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `monoSubscriptionId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `planIdPending` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `stripeCustomerId` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `stripeSubscriptionId` on the `Subscription` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[paddleTransactionId]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[paddleSubscriptionId]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Subscription_monoSubscriptionId_key";

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "monoStatus",
DROP COLUMN "monoSubscriptionId",
DROP COLUMN "planIdPending",
DROP COLUMN "stripeCustomerId",
DROP COLUMN "stripeSubscriptionId",
ADD COLUMN     "paddleCustomerId" TEXT,
ADD COLUMN     "paddlePriceId" TEXT,
ADD COLUMN     "paddleStatus" TEXT,
ADD COLUMN     "paddleSubscriptionId" TEXT,
ADD COLUMN     "paddleTransactionId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_paddleTransactionId_key" ON "Subscription"("paddleTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_paddleSubscriptionId_key" ON "Subscription"("paddleSubscriptionId");
