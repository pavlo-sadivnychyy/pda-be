/*
  Warnings:

  - You are about to drop the column `trialEnd` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `trialStart` on the `Subscription` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[monoSubscriptionId]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "trialEnd",
DROP COLUMN "trialStart",
ADD COLUMN     "monoStatus" TEXT,
ADD COLUMN     "monoSubscriptionId" TEXT,
ADD COLUMN     "planIdPending" "PlanId";

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_monoSubscriptionId_key" ON "Subscription"("monoSubscriptionId");
