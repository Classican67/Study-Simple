/*
  Warnings:

  - You are about to drop the column `aliasOfId` on the `Card` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Card" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "deckId" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "imagePath" TEXT,
    "searchText" TEXT NOT NULL DEFAULT '',
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "sourceCardId" TEXT,
    CONSTRAINT "Card_sourceCardId_fkey" FOREIGN KEY ("sourceCardId") REFERENCES "Card" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Card_deckId_fkey" FOREIGN KEY ("deckId") REFERENCES "Deck" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_Card" ("createdAt", "deckId", "definition", "id", "imagePath", "position", "searchText", "term", "updatedAt") SELECT "createdAt", "deckId", "definition", "id", "imagePath", "position", "searchText", "term", "updatedAt" FROM "Card";
DROP TABLE "Card";
ALTER TABLE "new_Card" RENAME TO "Card";
CREATE INDEX "Card_deckId_position_idx" ON "Card"("deckId", "position");
CREATE INDEX "Card_sourceCardId_idx" ON "Card"("sourceCardId");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
