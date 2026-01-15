-- CreateEnum
CREATE TYPE "ClientCrmStatus" AS ENUM ('LEAD', 'IN_PROGRESS', 'ACTIVE', 'INACTIVE');

-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "crmStatus" "ClientCrmStatus" NOT NULL DEFAULT 'LEAD',
ADD COLUMN     "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
