-- CreateTable
CREATE TABLE "DriveLink" (
    "userId" TEXT NOT NULL PRIMARY KEY,
    "refreshToken" TEXT NOT NULL,
    "email" TEXT NOT NULL DEFAULT '',
    "lastSyncAt" DATETIME,
    "lastStatus" TEXT NOT NULL DEFAULT '',
    "lastError" TEXT NOT NULL DEFAULT '',
    "lastSent" INTEGER NOT NULL DEFAULT 0,
    "signature" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DriveLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DriveItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "driveId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "parent" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "DriveItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "DriveItem_userId_key_key" ON "DriveItem"("userId", "key");
