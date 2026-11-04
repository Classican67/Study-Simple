import "server-only";

import { createHash } from "node:crypto";

import { revalidatePath } from "next/cache";

import { toPlainText } from "@/components/rich-text";
import { prisma } from "@/lib/prisma";
import { normalizeForSearch } from "@/lib/search";
import { blockFiles, MAX_BLOCK_BYTES, notePreview, noteSearchText } from "@/lib/notes";
import { appliquerDelta, deltaTouche, type Delta } from "@/lib/bloc-delta";

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
 * L'aperçu d'un gros bloc se recalcule au plus toutes les vingt secondes.
 *
 * Il demande d'analyser la page entière ; à chaque seconde d'écriture dans un
 * polycopié de trente mégaoctets, c'était le serveur qui ne suivait plus. La
 * vignette n'a pas besoin d'être juste à la seconde : la dernière demande
 * part quand même, en différé, pour que l'aperçu finisse à jour.
 */
const APERCU_SEUIL = 2_000_000;
const APERCU_INTERVALLE = 20_000;
const apercus = new Map<string, { dernier: number; differe: ReturnType<typeof setTimeout> | null }>();

async function apercuEspace(noteId: string, enMain: { id: string; content: string }) {
  if (enMain.content.length < APERCU_SEUIL) return recalculerApercu(noteId, enMain);
  const etat = apercus.get(noteId) ?? { dernier: 0, differe: null };
  apercus.set(noteId, etat);
  const attente = etat.dernier + APERCU_INTERVALLE - Date.now();
  if (attente <= 0) {
    etat.dernier = Date.now();
    return recalculerApercu(noteId, enMain);
  }
  // Relu en base au moment voulu, pas gardé en mémoire : le contenu en main
  // sera périmé d'ici là, et trente mégaoctets n'ont rien à faire dans une
  // minuterie.
  if (etat.differe === null) {
    etat.differe = setTimeout(() => {
      etat.differe = null;
      etat.dernier = Date.now();
      void recalculerApercu(noteId).catch((error) => console.error("[aperçu]", error));
    }, attente);
  }
}

/**
 * Pourquoi un enregistrement a échoué — et donc s'il faut réessayer.
 *
 * `introuvable` et `trop-gros` sont **définitifs** : réessayer les mille fois
 * ne changera rien, et une file qui s'acharne masque le vrai problème au lieu
 * de le dire. Le brouillon reste sur l'appareil, et l'interface propose de le
 * télécharger.
 */
export type RefusBloc = "introuvable" | "trop-gros" | "base";
export type EnregistrementBloc =
  | { ok: true; empreinte: string }
  | { ok: false; code: RefusBloc; error: string };

/** Empreinte d'un contenu, celle que le client compare avant d'envoyer un morceau. */
export function empreinte(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

export const MESSAGES_REFUS: Record<RefusBloc, string> = {
  introuvable: "Ce bloc n'existe plus sur le serveur.",
  "trop-gros": "Ce bloc est trop volumineux pour être enregistré.",
  // Pas un refus définitif : le client renvoie alors le bloc entier.
  base: "La version de départ ne correspond plus à celle du serveur.",
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
  /** Le contenu entier, ou seulement ce qui a changé depuis une version connue. */
  envoi: string | Delta,
  noteId?: string,
): Promise<EnregistrementBloc> {
  // Un contenu entier se borne avant toute lecture : rien n'empêcherait un
  // client fautif d'envoyer cent mégaoctets.
  if (typeof envoi === "string" && Buffer.byteLength(envoi, "utf8") > MAX_BLOCK_BYTES) {
    return { ok: false, code: "trop-gros", error: MESSAGES_REFUS["trop-gros"] };
  }

  const block = await prisma.noteBlock.findFirst({
    where: { id: blockId, ...(noteId ? { noteId } : {}), note: { ownerId: userId } },
    select: { noteId: true, kind: true, content: true },
  });
  if (!block) return { ok: false, code: "introuvable", error: MESSAGES_REFUS.introuvable };

  /*
   * Un morceau ne s'applique qu'à la version dont il a été tiré.
   *
   * Deux onglets, un brouillon remis après une coupure, une note modifiée
   * depuis un autre appareil : la version du serveur a pu bouger. Appliquer
   * le morceau dessus produirait un JSON recousu au mauvais endroit — un
   * document abîmé, enregistré comme s'il était juste. On refuse, et le
   * client renvoie tout.
   */
  let content: string;
  if (typeof envoi === "string") {
    content = envoi;
  } else {
    const rejoue = empreinte(block.content) === envoi.base ? appliquerDelta(block.content, envoi) : null;
    if (rejoue === null) return { ok: false, code: "base", error: MESSAGES_REFUS.base };
    if (Buffer.byteLength(rejoue, "utf8") > MAX_BLOCK_BYTES) {
      return { ok: false, code: "trop-gros", error: MESSAGES_REFUS["trop-gros"] };
    }
    content = rejoue;
  }

  /*
   * Une page retirée de la pile emporte son fichier.
   *
   * On compare les fichiers d'avant à ceux d'après : c'est une comparaison de
   * deux petites listes de noms, faite à chaque enregistrement, et la base
   * n'est interrogée que lorsqu'un nom a **réellement** disparu — ce qui
   * n'arrive qu'au retrait d'une page.
   */
  // Un morceau qui ne s'approche d'aucun nom de fichier ne peut pas en avoir
  // retiré : on s'épargne alors deux analyses du document entier.
  const fichiersIntacts =
    typeof envoi !== "string" && !deltaTouche(block.content, envoi, ['"file"', '"image"']);
  const avant = fichiersIntacts ? [] : blockFiles(block.kind, block.content);
  const apres = new Set(fichiersIntacts ? [] : blockFiles(block.kind, content));
  const partis = avant.filter((nom) => !apres.has(nom));

  await prisma.noteBlock.update({ where: { id: blockId }, data: { content } });

  if (partis.length > 0) {
    const { nettoyerFichiers } = await import("@/lib/note-uploads");
    await nettoyerFichiers(partis);
  }

  // L'aperçu de la note : sa première page manuscrite qui montre quelque chose,
  // à partir du contenu déjà en main — jamais en relisant ce bloc.
  if (block.kind === "drawing") await apercuEspace(block.noteId, { id: blockId, content });

  await touch(block.noteId);
  return { ok: true, empreinte: empreinte(content) };
}
