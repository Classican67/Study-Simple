import "server-only";

import { revalidatePath } from "next/cache";

import { toPlainText } from "@/components/rich-text";
import { prisma } from "@/lib/prisma";
import { normalizeForSearch } from "@/lib/search";
import { blockFiles, MAX_BLOCK_BYTES, notePreview, noteSearchText } from "@/lib/notes";

/*
 * Cœur de l'enregistrement d'un bloc.
 *
 * Ce module n'est **pas** un fichier « use server » : il prend un `userId` en
 * paramètre. Exporter une telle fonction depuis un fichier d'actions en ferait
 * un point d'entrée appelable par n'importe quel client, qui choisirait alors
 * le compte au nom duquel écrire. Le cloisonnement se ferait sur une valeur
 * venue du navigateur — exactement ce que `ownsNote` existe pour empêcher.
 *
 * Les deux chemins d'écriture s'appuient dessus :
 *
 * - l'action serveur `updateBlock`, qui authentifie par `requireUser` ;
 * - la route `PUT /api/notes/<note>/blocks/<bloc>`, qui authentifie par
 *   `getApiUser` et rend un **code HTTP**. C'est elle que l'app utilise pour
 *   l'enregistrement automatique : une action serveur rejetée ne dit pas
 *   *pourquoi*, et « hors ligne », « session expirée » et « bloc trop gros »
 *   n'appellent pas du tout la même conduite.
 */

/**
 * Marque la note comme modifiée et reconstruit son texte de recherche.
 *
 * Les blocs de croquis sont volontairement exclus de la relecture : une page
 * dense au stylet pèse des centaines de kilooctets, et la recharger à chaque
 * enregistrement automatique coûterait plus que l'écriture elle-même.
 */
export async function touch(noteId: string) {
  const note = await prisma.note.findUnique({
    where: { id: noteId },
    select: {
      title: true,
      blocks: { where: { kind: { in: ["text", "table"] } }, select: { kind: true, content: true } },
    },
  });
  if (!note) return;

  await prisma.note.update({
    where: { id: noteId },
    data: {
      updatedAt: new Date(),
      searchText: normalizeForSearch(noteSearchText(note.title, note.blocks, toPlainText)),
    },
  });
  revalidatePath("/notes");
}

/**
 * Recalcule l'aperçu d'une note : sa première page manuscrite qui montre
 * quelque chose (cf. `notePreview`).
 *
 * `enMain` est le bloc qu'on vient d'écrire : son contenu n'est pas relu, et si
 * l'aperçu vient d'une page qui le précède, il n'a pas pu changer — rien n'est
 * réécrit. C'est l'économie que faisait l'ancienne règle (« seulement si c'est
 * la première page »), gardée sous la nouvelle : l'aperçu est recalculé à
 * chaque enregistrement, donc chaque seconde pendant qu'on écrit.
 */
export async function recalculerApercu(noteId: string, enMain?: { id: string; content: string }) {
  const pages = await prisma.noteBlock.findMany({
    where: { noteId, kind: "drawing" },
    orderBy: { position: "asc" },
    select: { id: true },
  });
  const ids = pages.map((page) => page.id);
  const { apercu, source } = await notePreview(ids, async (id) =>
    id === enMain?.id
      ? enMain.content
      : ((await prisma.noteBlock.findUnique({ where: { id }, select: { content: true } }))?.content ?? null),
  );
  if (enMain && source !== null && ids.indexOf(source) < ids.indexOf(enMain.id)) return;
  await prisma.note.update({
    where: { id: noteId },
    data: { preview: apercu ? JSON.stringify(apercu) : "" },
  });
}

/**
 * Pourquoi un enregistrement a échoué — et donc s'il faut réessayer.
 *
 * `introuvable` et `trop-gros` sont **définitifs** : réessayer les mille fois
 * ne changera rien, et une file qui s'acharne masque le vrai problème au lieu
 * de le dire. Le brouillon reste sur l'appareil, et l'interface propose de le
 * télécharger.
 */
export type RefusBloc = "introuvable" | "trop-gros";
export type EnregistrementBloc = { ok: true } | { ok: false; code: RefusBloc; error: string };

export const MESSAGES_REFUS: Record<RefusBloc, string> = {
  introuvable: "Ce bloc n'existe plus sur le serveur.",
  "trop-gros": "Ce bloc est trop volumineux pour être enregistré.",
};

/**
 * Écrit le contenu d'un bloc, en vérifiant qu'il appartient bien au compte.
 *
 * `noteId` est facultatif : la route le connaît par son chemin et le fait
 * vérifier, l'action non.
 */
export async function enregistrerBloc(
  userId: string,
  blockId: string,
  content: string,
  noteId?: string,
): Promise<EnregistrementBloc> {
  // Borne avant d'écrire : une page dense au stylet reste loin sous la limite,
  // mais rien n'empêcherait un client fautif d'envoyer dix mégaoctets.
  if (Buffer.byteLength(content, "utf8") > MAX_BLOCK_BYTES) {
    return { ok: false, code: "trop-gros", error: MESSAGES_REFUS["trop-gros"] };
  }

  const block = await prisma.noteBlock.findFirst({
    where: { id: blockId, ...(noteId ? { noteId } : {}), note: { ownerId: userId } },
    select: { noteId: true, kind: true, content: true },
  });
  if (!block) return { ok: false, code: "introuvable", error: MESSAGES_REFUS.introuvable };

  /*
   * Une page retirée de la pile emporte son fichier.
   *
   * On compare les fichiers d'avant à ceux d'après : c'est une comparaison de
   * deux petites listes de noms, faite à chaque enregistrement, et la base
   * n'est interrogée que lorsqu'un nom a **réellement** disparu — ce qui
   * n'arrive qu'au retrait d'une page.
   */
  const avant = blockFiles(block.kind, block.content);
  const apres = new Set(blockFiles(block.kind, content));
  const partis = avant.filter((nom) => !apres.has(nom));

  await prisma.noteBlock.update({ where: { id: blockId }, data: { content } });

  if (partis.length > 0) {
    const { nettoyerFichiers } = await import("@/lib/note-uploads");
    await nettoyerFichiers(partis);
  }

  // L'aperçu de la note : sa première page manuscrite qui montre quelque chose,
  // à partir du contenu déjà en main — jamais en relisant ce bloc.
  if (block.kind === "drawing") await recalculerApercu(block.noteId, { id: blockId, content });

  await touch(block.noteId);
  return { ok: true };
}
