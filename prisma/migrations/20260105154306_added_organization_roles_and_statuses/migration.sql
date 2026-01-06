/*
  Warnings:

  - The `status` column on the `UserOrganization` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'INACTIVE');

-- AlterTable
ALTER TABLE "UserOrganization" DROP COLUMN "status",
ADD COLUMN     "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'ACTIVE';
