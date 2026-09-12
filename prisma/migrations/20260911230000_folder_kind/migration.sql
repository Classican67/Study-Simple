-- Les dossiers appartiennent à une section : les paquets, ou les notes.
--
-- Jusqu'ici les deux s'en partageaient un seul arbre, et créer un dossier dans
-- les notes en faisait apparaître un dans les paquets.
ALTER TABLE "Folder" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'deck';

-- Un dossier qui ne contient que des notes est un dossier de notes.
UPDATE "Folder" SET "kind" = 'note'
WHERE "id" IN (SELECT DISTINCT "folderId" FROM "Note" WHERE "folderId" IS NOT NULL)
  AND "id" NOT IN (SELECT DISTINCT "folderId" FROM "Deck" WHERE "folderId" IS NOT NULL);

-- Le genre se propage depuis la racine : un arbre ne mélange pas les deux.
WITH RECURSIVE herite(id, kind) AS (
  SELECT "id", "kind" FROM "Folder" WHERE "parentId" IS NULL
  UNION ALL
  SELECT f."id", h."kind" FROM "Folder" f JOIN herite h ON f."parentId" = h."id"
)
UPDATE "Folder"
SET "kind" = (SELECT "kind" FROM herite WHERE herite."id" = "Folder"."id")
WHERE "id" IN (SELECT "id" FROM herite);

-- Ce qui se retrouve du mauvais côté remonte à la racine de sa section : rien
-- n'est effacé, tout reste visible.
UPDATE "Note" SET "folderId" = NULL
WHERE "folderId" IN (SELECT "id" FROM "Folder" WHERE "kind" = 'deck');

UPDATE "Deck" SET "folderId" = NULL
WHERE "folderId" IN (SELECT "id" FROM "Folder" WHERE "kind" = 'note');

DROP INDEX IF EXISTS "Folder_ownerId_parentId_idx";
CREATE INDEX "Folder_ownerId_kind_parentId_idx" ON "Folder"("ownerId", "kind", "parentId");
