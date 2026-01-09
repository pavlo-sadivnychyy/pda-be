/*
  Warnings:

  - You are about to drop the column `organizationId` on the `Subscription` table. All the data in the column will be lost.
  - The `planId` column on the `Subscription` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - You are about to drop the `SubscriptionPlan` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[userId]` on the table `Subscription` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `userId` to the `Subscription` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "PlanId" AS ENUM ('FREE', 'BASIC', 'PRO');

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_organizationId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_planId_fkey";

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "organizationId",
ADD COLUMN     "userId" TEXT NOT NULL,
DROP COLUMN "planId",
ADD COLUMN     "planId" "PlanId" NOT NULL DEFAULT 'FREE',
ALTER COLUMN "status" SET DEFAULT 'active';

-- DropTable
DROP TABLE "SubscriptionPlan";

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_userId_key" ON "Subscription"("userId");

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
