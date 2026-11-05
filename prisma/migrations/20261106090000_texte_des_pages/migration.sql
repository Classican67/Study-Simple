-- Le texte des zones d'une page manuscrite, tenu à part du contenu : la recherche
-- le relit à chaque enregistrement, et une page dense pèse des dizaines de Mo.
ALTER TABLE "NoteBlock" ADD COLUMN "plain" TEXT NOT NULL DEFAULT '';
