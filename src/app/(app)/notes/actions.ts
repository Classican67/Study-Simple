"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
// Le cœur de l'écriture d'un bloc vit hors de ce fichier : il prend un
// `userId`, et une telle fonction exportée depuis un module « use server »
// serait appelable par le client avec le compte de son choix.
import { enregistrerBloc, recalculerApercu, touch } from "@/lib/note-save";
import {
  defaultContent,
  surfaceRatio,
  isBlockKind,
  MAX_DOCUMENT_PAGES,
  MAX_RATIO,
  type BlockKind,
} from "@/lib/notes";

export type NoteResult = { ok: boolean; error?: string };

// Vérifie que la note appartient bien au compte connecté. Toute écriture passe
// par là : le cloisonnement ne dépend jamais de ce que le client envoie.
async function ownsNote(noteId: string, userId: string): Promise<boolean> {
  const note = await prisma.note.findFirst({
    where: { id: noteId, ownerId: userId },
    select: { id: true },
  });
  return note !== null;
}

export async function createNote(folderId?: string | null): Promise<string | null> {
  const user = await requireUser();

  // Un dossier d'un autre compte ne doit pas pouvoir servir de rangement.
  const dossier = folderId
    ? await prisma.folder.findFirst({
        where: { id: folderId, ownerId: user.id, kind: "note" },
        select: { id: true },
      })
    : null;

  /*
   * Une note neuve s'ouvre sur une page manuscrite vierge.
   *
   * Elle commençait par un bloc de texte, comme un document de traitement de
   * texte : on prend une note pour écrire au stylet, et il fallait d'abord
   * chercher « Croquis » sous un paragraphe vide. Le texte, le tableau, la photo
   * et le document restent à un geste, sous la page.
   */
  const note = await prisma.note.create({
    data: {
      ownerId: user.id,
      folderId: dossier?.id ?? null,
      title: "",
      blocks: { create: [{ kind: "drawing", position: 0, content: defaultContent("drawing") }] },
    },
    select: { id: true },
  });

  revalidatePath("/notes");
  return note.id;
}

export async function renameNote(noteId: string, title: string): Promise<NoteResult> {
  const user = await requireUser();
  const { count } = await prisma.note.updateMany({
    where: { id: noteId, ownerId: user.id },
    data: { title: title.slice(0, 200) },
  });
  if (count !== 1) return { ok: false, error: "Note introuvable." };
  // Le titre compte dans la recherche : `touch` le réindexe.
  await touch(noteId);
  return { ok: true };
}

export async function deleteNote(noteId: string): Promise<NoteResult> {
  const user = await requireUser();
  const { fichiersDeLaNote, nettoyerFichiers } = await import("@/lib/note-uploads");

  // Relevés **avant** la suppression : après, plus rien ne dit de quels
  // fichiers la note se servait.
  const fichiers = await fichiersDeLaNote(noteId);

  // Les blocs partent avec la note : la cascade est déclarée dans le schéma.
  const { count } = await prisma.note.deleteMany({ where: { id: noteId, ownerId: user.id } });
  if (count !== 1) return { ok: false, error: "Note introuvable." };

  // Et **après** l'écriture : c'est l'état final qui dit si un fichier est
  // devenu orphelin. Les documents importés et les photos ne vivent pas dans
  // la note, seulement leur nom.
  await nettoyerFichiers(fichiers);

  revalidatePath("/notes");
  return { ok: true };
}

/**
 * Ajoute un bloc, éventuellement au milieu de la note.
 *
 * `afterBlockId` décale les positions suivantes d'un cran, comme l'insertion
 * de carte : c'est une seule requête, et les positions restent uniques.
 */
export async function addBlock(
  noteId: string,
  kind: BlockKind,
  afterBlockId?: string | null,
) {
  const user = await requireUser();
  if (!isBlockKind(kind)) return null;
  if (!(await ownsNote(noteId, user.id))) return null;

  const block = await prisma.$transaction(async (tx) => {
    let position: number;

    if (afterBlockId) {
      const after = await tx.noteBlock.findFirst({
        where: { id: afterBlockId, noteId },
        select: { position: true },
      });
      if (!after) return null;
      await tx.noteBlock.updateMany({
        where: { noteId, position: { gt: after.position } },
        data: { position: { increment: 1 } },
      });
      position = after.position + 1;
    } else {
      const last = await tx.noteBlock.findFirst({
        where: { noteId },
        orderBy: { position: "desc" },
        select: { position: true },
      });
      position = (last?.position ?? -1) + 1;
    }

    return tx.noteBlock.create({
      data: { noteId, kind, position, content: defaultContent(kind) },
      select: { id: true, kind: true, content: true, position: true },
    });
  });

  if (block) await touch(noteId);
  return block;
}

/**
 * Duplique un bloc, juste après l'original.
 *
 * Le geste des cahiers : refaire un schéma en variante, reprendre une page de
 * polycopié pour l'annoter autrement, sans perdre la première lecture.
 *
 * Le contenu est copié tel quel — pour une page de document, la copie
 * **désigne le même fichier** que l'original. C'est sans danger ici : rien
 * n'efface jamais un document importé, ni la suppression d'un bloc ni celle
 * de la note. Le jour où l'on ramassera ces fichiers, il faudra compter les
 * blocs qui les désignent avant d'en effacer un.
 */
export async function duplicateBlock(blockId: string) {
  const user = await requireUser();
  const source = await prisma.noteBlock.findFirst({
    where: { id: blockId, note: { ownerId: user.id } },
    select: { noteId: true, kind: true, content: true, position: true },
  });
  if (!source) return null;

  const block = await prisma.$transaction(async (tx) => {
    await tx.noteBlock.updateMany({
      where: { noteId: source.noteId, position: { gt: source.position } },
      data: { position: { increment: 1 } },
    });
    return tx.noteBlock.create({
      data: {
        noteId: source.noteId,
        kind: source.kind,
        position: source.position + 1,
        content: source.content,
      },
      select: { id: true, kind: true, content: true, position: true },
    });
  });

  // La copie se glisse *après* l'original : le premier bloc ne change pas,
  // donc l'aperçu de la note non plus.
  await touch(source.noteId);
  return block;
}

/**
 * Enregistrement d'un bloc, par action serveur.
 *
 * L'enregistrement automatique de l'éditeur ne passe **plus** par ici : il
 * emprunte `PUT /api/notes/<note>/blocks/<bloc>`, qui rend un code HTTP et
 * permet de distinguer une coupure réseau d'une session expirée. Cette action
 * reste le chemin simple pour tout ce qui écrit un bloc en une fois, sans file
 * de reprise.
 */
export async function updateBlock(blockId: string, content: string): Promise<NoteResult> {
  const user = await requireUser();
  const resultat = await enregistrerBloc(user.id, blockId, content);
  return resultat.ok ? { ok: true } : { ok: false, error: resultat.error };
}

export async function deleteBlock(blockId: string): Promise<NoteResult> {
  const user = await requireUser();
  const block = await prisma.noteBlock.findFirst({
    where: { id: blockId, note: { ownerId: user.id } },
    select: { noteId: true, kind: true, content: true },
  });
  if (!block) return { ok: false, error: "Bloc introuvable." };

  const { blockFiles } = await import("@/lib/notes");
  const { nettoyerFichiers } = await import("@/lib/note-uploads");
  const fichiers = blockFiles(block.kind, block.content);

  await prisma.noteBlock.delete({ where: { id: blockId } });
  // Supprimer une page manuscrite emporte le document ou la photo qui lui
  // servait de fond — sauf si un autre bloc s'en sert, ce qu'une duplication
  // rend possible.
  await nettoyerFichiers(fichiers);
  // La page retirée donnait peut-être l'aperçu : c'est alors la suivante.
  if (block.kind === "drawing") await recalculerApercu(block.noteId);
  await touch(block.noteId);
  return { ok: true };
}

/** Réordonne les blocs d'une note. L'ordre reçu doit les décrire tous. */
export async function reorderBlocks(noteId: string, orderedIds: string[]): Promise<NoteResult> {
  const user = await requireUser();
  if (!(await ownsNote(noteId, user.id))) return { ok: false, error: "Note introuvable." };

  const existing = await prisma.noteBlock.findMany({ where: { noteId }, select: { id: true } });
  const known = new Set(existing.map((b) => b.id));
  if (orderedIds.length !== existing.length || !orderedIds.every((id) => known.has(id))) {
    return { ok: false, error: "Ordre invalide." };
  }

  // Une transaction : un ordre à moitié écrit vaudrait moins que l'ancien.
  await prisma.$transaction(
    orderedIds.map((id, index) =>
      prisma.noteBlock.update({ where: { id }, data: { position: index } }),
    ),
  );
  // Monter une page au-dessus d'une autre change celle qui donne l'aperçu.
  await recalculerApercu(noteId);
  await touch(noteId);
  return { ok: true };
}

/**
 * Copie une note entière, rangée à côté de l'originale, et rend son id.
 *
 * Les blocs sont recopiés tels quels : une page portant un document ou une
 * photo désigne donc le **même fichier** que l'originale. C'est sans danger —
 * `nettoyerFichiers` compte les blocs qui désignent un fichier avant de
 * l'effacer, et supprimer l'une des deux notes laisse ses fichiers à l'autre.
 *
 * La marque « maîtrisée » ne suit pas : c'est une appréciation portée sur une
 * note, et la copie n'a encore été ni relue ni travaillée.
 */
export async function duplicateNote(noteId: string): Promise<string | null> {
  const user = await requireUser();
  const source = await prisma.note.findFirst({
    where: { id: noteId, ownerId: user.id },
    select: {
      title: true,
      folderId: true,
      preview: true,
      blocks: { orderBy: { position: "asc" }, select: { kind: true, position: true, content: true } },
    },
  });
  if (!source) return null;

  const titre = source.title.trim();
  const note = await prisma.note.create({
    data: {
      ownerId: user.id,
      folderId: source.folderId,
      title: titre ? `${titre} (copie)`.slice(0, 200) : "",
      // L'aperçu est celui des mêmes pages : inutile de le recalculer.
      preview: source.preview,
      blocks: {
        create: source.blocks.map((b) => ({ kind: b.kind, position: b.position, content: b.content })),
      },
    },
    select: { id: true },
  });

  // Le titre a changé : `touch` reconstruit le texte de recherche.
  await touch(note.id);
  return note.id;
}

/**
 * Marque une note comme maîtrisée, ou retire la marque.
 *
 * La date de modification est gardée telle quelle : la liste est triée
 * dessus, et cocher une note ne doit pas la faire remonter en tête comme si
 * l'on venait d'y écrire. Prisma renseigne `@updatedAt` à chaque écriture
 * sauf si on lui donne la valeur — on lui rend donc l'ancienne.
 */
export async function setNoteMastered(noteId: string, mastered: boolean): Promise<NoteResult> {
  const user = await requireUser();
  const note = await prisma.note.findFirst({
    where: { id: noteId, ownerId: user.id },
    select: { updatedAt: true },
  });
  if (!note) return { ok: false, error: "Note introuvable." };

  await prisma.note.update({
    where: { id: noteId },
    data: { mastered: mastered === true, updatedAt: note.updatedAt },
  });

  revalidatePath("/notes");
  return { ok: true };
}

/** Range une note dans un dossier, ou la remet à la racine. */
export async function moveNote(noteId: string, folderId: string | null): Promise<NoteResult> {
  const user = await requireUser();

  if (folderId) {
    // Un dossier de paquets n'accueille pas de notes : les deux classements
    // sont séparés, et une note qui y atterrirait deviendrait invisible.
    const dossier = await prisma.folder.findFirst({
      where: { id: folderId, ownerId: user.id, kind: "note" },
      select: { id: true },
    });
    if (!dossier) return { ok: false, error: "Dossier introuvable." };
  }

  const { count } = await prisma.note.updateMany({
    where: { id: noteId, ownerId: user.id },
    data: { folderId },
  });
  if (count !== 1) return { ok: false, error: "Note introuvable." };

  revalidatePath("/notes");
  return { ok: true };
}

/*
 * L'import d'un document ne passe plus par une action serveur.
 *
 * Le corps d'une action est plafonné à un mégaoctet : un PDF scanné était
 * refusé par Next avant que le code ne soit appelé, et l'interface restait
 * bloquée sur « Conversion… ». Il passe par `POST /api/notes/<id>/document`,
 * qui n'a pas ce plafond et dont l'envoi se mesure en XHR.
 */

/**
 * Ajoute une page manuscrite par page du document, d'un seul coup.
 *
 * En une transaction plutôt qu'un appel par page : un document de quarante
 * pages ferait sinon quarante allers-retours, et une interruption au milieu
 * laisserait la note à moitié constituée.
 */
export type DocumentBlocks =
  | { ok: true; blocks: { id: string; kind: string; content: string }[] }
  | { ok: false; error: string };

export async function addDocumentBlocks(
  noteId: string,
  file: string,
  ratios: number[],
): Promise<DocumentBlocks> {
  const user = await requireUser();
  if (!(await ownsNote(noteId, user.id))) return { ok: false, error: "Note introuvable." };
  if (ratios.length === 0) return { ok: false, error: "Document sans page." };
  if (ratios.length > MAX_DOCUMENT_PAGES) {
    return { ok: false, error: `Document trop long (${MAX_DOCUMENT_PAGES} pages maximum).` };
  }

  /*
   * Le document entier tient dans **un seul** bloc.
   *
   * Une page par bloc donnait une palette, un cadre et un menu par page : on
   * annotait un polycopié de quarante pages dans quarante fenêtres. Ici les
   * pages sont empilées sur la même surface — on fait défiler, on annote à
   * cheval, et la palette ne bouge pas.
   */
  const pages = ratios.map((ratio, index) => ({
    file,
    page: index + 1,
    // Le format de chaque page suit celui du document : annoter une page A4
    // sur une feuille carrée décalerait tout.
    ratio: Math.min(MAX_RATIO, Math.max(0.2, ratio)),
  }));

  const last = await prisma.noteBlock.findFirst({
    where: { noteId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const bloc = await prisma.noteBlock.create({
    data: {
      noteId,
      kind: "drawing",
      position: (last?.position ?? -1) + 1,
      content: JSON.stringify({
        strokes: [],
        ratio: surfaceRatio(pages),
        paper: "blank",
        pages,
      }),
    },
    select: { id: true, kind: true, content: true },
  });

  // La première page importée sert d'aperçu, s'il n'y en avait pas déjà une —
  // la page vierge d'une note neuve ne compte pas.
  await recalculerApercu(noteId);

  await touch(noteId);

  // Le bloc créé est renvoyé pour que l'éditeur l'affiche aussitôt. Sans cela
  // rien n'apparaissait, et l'on réimportait le document en croyant que
  // l'import avait échoué.
  return { ok: true, blocks: [bloc] };
}

export type PhotoResult =
  | { ok: true; block: { id: string; kind: string; content: string } }
  | { ok: false; error: string };

/**
 * Fait d'une photo une page manuscrite, prête à être annotée.
 *
 * Le tableau du cours, la page d'un camarade, un schéma d'un livre : on les
 * photographie pour écrire dessus. La photo devient donc une **page** de la
 * surface, comme une page de document importé — elle hérite ainsi de
 * l'écriture, du zoom, du volet des pages et de l'export, sans rien
 * réinventer.
 *
 * Le format vient du navigateur, qui a la photo en main : le serveur ne sait
 * pas lire les dimensions d'une image sans embarquer un décodeur. Il le borne,
 * ce qui suffit — une valeur fausse ne déforme que la page de celui qui l'a
 * envoyée.
 */
/**
 * Enregistre une image qui deviendra une page d'une page manuscrite **existante**.
 *
 * Le bloc n'est pas touché ici : c'est le client qui insère la page, puis
 * l'enregistre par le chemin ordinaire. L'insérer au serveur ferait courir deux
 * versions du bloc — l'enregistrement différé du client, parti d'avant la
 * photo, écraserait la page, et `updateBlock` supprimerait alors le fichier en
 * le croyant retiré. Passer par le client fait aussi entrer l'insertion dans
 * l'historique : Annuler la retire, et l'enregistrement suivant nettoie le
 * fichier.
 */
export async function uploadPageImage(
  blockId: string,
  formData: FormData,
): Promise<{ ok: true; image: string } | { ok: false; error: string }> {
  const user = await requireUser();
  const bloc = await prisma.noteBlock.findFirst({
    where: { id: blockId, kind: "drawing", note: { ownerId: user.id } },
    select: { id: true },
  });
  if (!bloc) return { ok: false, error: "Page introuvable." };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Aucune image reçue." };

  const { saveUpload, UploadError } = await import("@/lib/uploads");
  try {
    return { ok: true, image: await saveUpload(file) };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof UploadError ? error.message : "Cette image n'a pas pu être enregistrée.",
    };
  }
}

export async function addPhotoBlock(noteId: string, formData: FormData): Promise<PhotoResult> {
  const user = await requireUser();
  if (!(await ownsNote(noteId, user.id))) return { ok: false, error: "Note introuvable." };

  const file = formData.get("photo");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Aucune photo reçue." };

  const brut = Number(formData.get("ratio"));
  const ratio = Number.isFinite(brut) && brut > 0.1 && brut <= MAX_RATIO ? brut : 1;

  const { saveUpload, UploadError } = await import("@/lib/uploads");
  let image: string;
  try {
    image = await saveUpload(file);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof UploadError ? error.message : "Cette photo n'a pas pu être enregistrée.",
    };
  }

  const last = await prisma.noteBlock.findFirst({
    where: { noteId },
    orderBy: { position: "desc" },
    select: { position: true },
  });

  const bloc = await prisma.noteBlock.create({
    data: {
      noteId,
      kind: "drawing",
      position: (last?.position ?? -1) + 1,
      content: JSON.stringify({
        strokes: [],
        ratio: Number(ratio.toFixed(4)),
        paper: "blank",
        pages: [{ image, ratio: Number(ratio.toFixed(4)) }],
      }),
    },
    select: { id: true, kind: true, content: true },
  });

  // La photo sert d'aperçu si aucune page avant elle ne montre quelque chose —
  // la page vierge d'une note neuve ne compte pas.
  await recalculerApercu(noteId);

  await touch(noteId);
  return { ok: true, block: bloc };
}
