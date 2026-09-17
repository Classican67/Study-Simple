-- CreateTable
CREATE TABLE "ReviewAnswer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "cardId" TEXT NOT NULL,
    "knew" BOOLEAN NOT NULL,
    "answeredAt" DATETIME NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ReviewAnswer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ReviewAnswer_cardId_fkey" FOREIGN KEY ("cardId") REFERENCES "Card" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "ReviewAnswer_userId_answeredAt_idx" ON "ReviewAnswer"("userId", "answeredAt");

-- CreateIndex
CREATE INDEX "ReviewAnswer_cardId_idx" ON "ReviewAnswer"("cardId");

