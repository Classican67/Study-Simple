-- Les notes existantes gardent leurs blocs : seules les nouvelles sont des feuilles.
ALTER TABLE "Note" ADD COLUMN "format" TEXT NOT NULL DEFAULT 'blocs';

CREATE TABLE "DocumentIndex" (
    "file" TEXT NOT NULL PRIMARY KEY,
    "statut" TEXT NOT NULL DEFAULT 'attente',
    "pages" INTEGER NOT NULL DEFAULT 0,
    "lues" INTEGER NOT NULL DEFAULT 0,
    "erreur" TEXT NOT NULL DEFAULT '',
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

CREATE TABLE "DocumentPage" (
    "file" TEXT NOT NULL,
    "page" INTEGER NOT NULL,
    "texte" TEXT NOT NULL DEFAULT '',
    "searchText" TEXT NOT NULL DEFAULT '',
    "mots" TEXT NOT NULL DEFAULT '[]',
    "ocr" BOOLEAN NOT NULL DEFAULT false,

    PRIMARY KEY ("file", "page"),
    CONSTRAINT "DocumentPage_file_fkey" FOREIGN KEY ("file") REFERENCES "DocumentIndex" ("file") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "NoteDocument" (
    "noteId" TEXT NOT NULL,
    "file" TEXT NOT NULL,

    PRIMARY KEY ("noteId", "file"),
    CONSTRAINT "NoteDocument_noteId_fkey" FOREIGN KEY ("noteId") REFERENCES "Note" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "NoteDocument_file_fkey" FOREIGN KEY ("file") REFERENCES "DocumentIndex" ("file") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "DocumentIndex_statut_idx" ON "DocumentIndex"("statut");
CREATE INDEX "NoteDocument_file_idx" ON "NoteDocument"("file");
