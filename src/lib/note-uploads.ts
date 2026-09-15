import "server-only";

import { prisma } from "@/lib/prisma";
import { blockFiles } from "@/lib/notes";
import { deleteUpload } from "@/lib/uploads";

/**
 * Efface les fichiers qu'une note ne désigne plus.
 *
 * Un document importé et une photo vivent sur le disque ; le bloc n'en garde
 * que le nom. Supprimer une note sans les effacer laissait des fichiers
 * orphelins — invisibles, et jamais repris par personne. Une photothèque de
 * cours en accumule vite plusieurs centaines de mégaoctets.
 *
 * Deux précautions, et la seconde est celle qui compte :
 *
 * - **Toujours après l'écriture en base.** C'est l'état final qui dit si un
 *   fichier est devenu orphelin, jamais l'intention. La même règle que pour les
 *   images de cartes (`deleteUnreferencedUploads`), et pour la même raison : un
 *   bloc dupliqué reprend le **nom de fichier** de l'original, et effacer sur
 *   la seule foi d'une suppression priverait la copie de son image.
 * - **On vérifie qu'aucun autre bloc ne s'en sert.** Dupliquer une page
 *   manuscrite donne deux blocs qui désignent le même PDF ; n'en supprimer
 *   qu'un ne doit rien effacer.
 */
export async function nettoyerFichiers(noms: string[]) {
  const uniques = [...new Set(noms.filter(Boolean))];
  if (uniques.length === 0) return;

  await Promise.all(
    uniques.map(async (nom) => {
      // `contains` sur le contenu : le nom est un UUID suivi d'une extension,
      // il ne peut pas apparaître par hasard dans un texte.
      const encore = await prisma.noteBlock.count({ where: { content: { contains: nom } } });
      if (encore === 0) await deleteUpload(nom);
    }),
  );
}

/** Les fichiers auxquels se réfèrent les blocs d'une note. */
export async function fichiersDeLaNote(noteId: string): Promise<string[]> {
  const blocs = await prisma.noteBlock.findMany({
    where: { noteId, kind: "drawing" },
    select: { kind: true, content: true },
  });
  return blocs.flatMap((b) => blockFiles(b.kind, b.content));
}
