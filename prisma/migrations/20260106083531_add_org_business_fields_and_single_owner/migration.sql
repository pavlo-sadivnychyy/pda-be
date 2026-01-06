/*
  Warnings:

  - A unique constraint covering the columns `[ownerId]` on the table `Organization` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "brandStyle" TEXT,
ADD COLUMN     "businessNiche" TEXT,
ADD COLUMN     "servicesDescription" TEXT,
ADD COLUMN     "targetAudience" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Organization_ownerId_key" ON "Organization"("ownerId");
