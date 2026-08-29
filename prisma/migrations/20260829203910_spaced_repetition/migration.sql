-- AlterTable
ALTER TABLE "CardProgress" ADD COLUMN "dueAt" DATETIME;

-- CreateIndex
CREATE INDEX "CardProgress_userId_dueAt_idx" ON "CardProgress"("userId", "dueAt");
