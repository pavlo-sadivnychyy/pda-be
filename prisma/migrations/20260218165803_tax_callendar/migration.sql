-- CreateEnum
CREATE TYPE "TaxJurisdiction" AS ENUM ('UA');

-- CreateEnum
CREATE TYPE "TaxEntityType" AS ENUM ('FOP', 'LLC', 'OTHER');

-- CreateEnum
CREATE TYPE "TaxEventKind" AS ENUM ('REPORT', 'PAYMENT', 'TASK');

-- CreateEnum
CREATE TYPE "TaxEventStatus" AS ENUM ('UPCOMING', 'IN_PROGRESS', 'DONE', 'SKIPPED', 'OVERDUE');

-- CreateTable
CREATE TABLE "TaxProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "jurisdiction" "TaxJurisdiction" NOT NULL DEFAULT 'UA',
    "entityType" "TaxEntityType" NOT NULL,
    "settings" JSONB NOT NULL,
    "timezone" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxEventTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "kind" "TaxEventKind" NOT NULL,
    "rrule" TEXT NOT NULL,
    "dueOffsetDays" INTEGER NOT NULL DEFAULT 0,
    "dueTimeLocal" TEXT DEFAULT '18:00',
    "rule" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxEventTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxEventInstance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "status" "TaxEventStatus" NOT NULL DEFAULT 'UPCOMING',
    "doneAt" TIMESTAMP(3),
    "doneById" TEXT,
    "note" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TaxEventInstance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxEventAttachment" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxEventAttachment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TaxProfile_organizationId_key" ON "TaxProfile"("organizationId");

-- CreateIndex
CREATE INDEX "TaxProfile_organizationId_idx" ON "TaxProfile"("organizationId");

-- CreateIndex
CREATE INDEX "TaxEventTemplate_organizationId_isActive_idx" ON "TaxEventTemplate"("organizationId", "isActive");

-- CreateIndex
CREATE INDEX "TaxEventTemplate_profileId_isActive_idx" ON "TaxEventTemplate"("profileId", "isActive");

-- CreateIndex
CREATE INDEX "TaxEventInstance_organizationId_dueAt_idx" ON "TaxEventInstance"("organizationId", "dueAt");

-- CreateIndex
CREATE INDEX "TaxEventInstance_templateId_dueAt_idx" ON "TaxEventInstance"("templateId", "dueAt");

-- CreateIndex
CREATE INDEX "TaxEventInstance_organizationId_status_dueAt_idx" ON "TaxEventInstance"("organizationId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "TaxEventAttachment_eventId_idx" ON "TaxEventAttachment"("eventId");

-- CreateIndex
CREATE INDEX "TaxEventAttachment_documentId_idx" ON "TaxEventAttachment"("documentId");

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxProfile" ADD CONSTRAINT "TaxProfile_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEventTemplate" ADD CONSTRAINT "TaxEventTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEventTemplate" ADD CONSTRAINT "TaxEventTemplate_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "TaxProfile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEventTemplate" ADD CONSTRAINT "TaxEventTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEventInstance" ADD CONSTRAINT "TaxEventInstance_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEventInstance" ADD CONSTRAINT "TaxEventInstance_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "TaxEventTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEventInstance" ADD CONSTRAINT "TaxEventInstance_doneById_fkey" FOREIGN KEY ("doneById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEventAttachment" ADD CONSTRAINT "TaxEventAttachment_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "TaxEventInstance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxEventAttachment" ADD CONSTRAINT "TaxEventAttachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
