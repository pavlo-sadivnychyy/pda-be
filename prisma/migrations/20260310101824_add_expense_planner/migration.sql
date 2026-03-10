-- CreateEnum
CREATE TYPE "ExpensePlanStatus" AS ENUM ('OPEN', 'CLOSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ExpenseItemType" AS ENUM ('PLANNED', 'ACTUAL');

-- CreateEnum
CREATE TYPE "ExpenseItemStatus" AS ENUM ('ACTIVE', 'DONE', 'SKIPPED');

-- CreateEnum
CREATE TYPE "ExpenseRecurrenceUnit" AS ENUM ('MONTH');

-- CreateTable
CREATE TABLE "ExpenseMonthPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "monthDate" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UAH',
    "status" "ExpensePlanStatus" NOT NULL DEFAULT 'OPEN',
    "incomePlanned" DECIMAL(18,2),
    "incomeActual" DECIMAL(18,2),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseMonthPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseCategory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "color" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseItem" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "vendorName" TEXT,
    "type" "ExpenseItemType" NOT NULL DEFAULT 'PLANNED',
    "status" "ExpenseItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "amountPlanned" DECIMAL(18,2),
    "amountActual" DECIMAL(18,2),
    "currency" TEXT NOT NULL DEFAULT 'UAH',
    "expenseDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "isRecurringGenerated" BOOLEAN NOT NULL DEFAULT false,
    "recurringRuleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExpenseRecurringRule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "categoryId" TEXT,
    "title" TEXT NOT NULL,
    "note" TEXT,
    "vendorName" TEXT,
    "amount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UAH',
    "dayOfMonth" INTEGER NOT NULL,
    "recurrenceUnit" "ExpenseRecurrenceUnit" NOT NULL DEFAULT 'MONTH',
    "startMonthKey" TEXT NOT NULL,
    "endMonthKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastGeneratedMonthKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExpenseRecurringRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExpenseMonthPlan_userId_monthDate_idx" ON "ExpenseMonthPlan"("userId", "monthDate");

-- CreateIndex
CREATE UNIQUE INDEX "ExpenseMonthPlan_userId_monthKey_key" ON "ExpenseMonthPlan"("userId", "monthKey");

-- CreateIndex
CREATE INDEX "ExpenseCategory_userId_isActive_idx" ON "ExpenseCategory"("userId", "isActive");

-- CreateIndex
CREATE INDEX "ExpenseCategory_planId_sortOrder_idx" ON "ExpenseCategory"("planId", "sortOrder");

-- CreateIndex
CREATE INDEX "ExpenseItem_userId_expenseDate_idx" ON "ExpenseItem"("userId", "expenseDate");

-- CreateIndex
CREATE INDEX "ExpenseItem_planId_type_idx" ON "ExpenseItem"("planId", "type");

-- CreateIndex
CREATE INDEX "ExpenseItem_categoryId_expenseDate_idx" ON "ExpenseItem"("categoryId", "expenseDate");

-- CreateIndex
CREATE INDEX "ExpenseItem_recurringRuleId_idx" ON "ExpenseItem"("recurringRuleId");

-- CreateIndex
CREATE INDEX "ExpenseRecurringRule_userId_isActive_idx" ON "ExpenseRecurringRule"("userId", "isActive");

-- CreateIndex
CREATE INDEX "ExpenseRecurringRule_userId_startMonthKey_idx" ON "ExpenseRecurringRule"("userId", "startMonthKey");

-- AddForeignKey
ALTER TABLE "ExpenseMonthPlan" ADD CONSTRAINT "ExpenseMonthPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseCategory" ADD CONSTRAINT "ExpenseCategory_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ExpenseMonthPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItem" ADD CONSTRAINT "ExpenseItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItem" ADD CONSTRAINT "ExpenseItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ExpenseMonthPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItem" ADD CONSTRAINT "ExpenseItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseItem" ADD CONSTRAINT "ExpenseItem_recurringRuleId_fkey" FOREIGN KEY ("recurringRuleId") REFERENCES "ExpenseRecurringRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRecurringRule" ADD CONSTRAINT "ExpenseRecurringRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExpenseRecurringRule" ADD CONSTRAINT "ExpenseRecurringRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ExpenseCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
