/*
  Warnings:

  - Made the column `dueTimeLocal` on table `TaxEventTemplate` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "TaxEventTemplate" ALTER COLUMN "dueTimeLocal" SET NOT NULL;
