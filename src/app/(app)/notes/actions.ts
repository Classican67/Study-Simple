"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { toPlainText } from "@/components/rich-text";
import { normalizeForSearch } from "@/lib/search";
import {
  defaultContent,
  isBlockKind,
  MAX_BLOCK_BYTES,
  MAX_RATIO,
  noteSearchText,
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

/**
 * Marque la note comme modifiée et reconstruit son texte de recherche.
 *
 * Les blocs de croquis sont volontairement exclus de la relecture : une page
 * dense au stylet pèse des centaines de kilooctets, et la recharger à chaque
 * enregistrement automatique coûterait plus que l'écriture elle-même.
 */
async function touch(noteId: string) {
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

export async function createNote(folderId?: string | null): Promise<string | null> {
  const user = await requireUser();

  // Un dossier d'un autre compte ne doit pas pouvoir servir de rangement.
  const dossier = folderId
    ? await prisma.folder.findFirst({ where: { id: folderId, ownerId: user.id }, select: { id: true } })
    : null;

  // Une note neuve n'est pas vide : elle commence par un bloc de texte, prêt à
  // recevoir le curseur. Une page entièrement blanche laisse sans prise.
  const note = await prisma.note.create({
    data: {
      ownerId: user.id,
      folderId: dossier?.id ?? null,
      title: "",
      blocks: { create: [{ kind: "text", position: 0, content: defaultContent("text") }] },
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
  // Les blocs partent avec la note : la cascade est déclarée dans le schéma.
  const { count } = await prisma.note.deleteMany({ where: { id: noteId, ownerId: user.id } });
  if (count !== 1) return { ok: false, error: "Note introuvable." };
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

export async function updateBlock(blockId: string, content: string): Promise<NoteResult> {
  const user = await requireUser();

  // Borne avant d'écrire : une page dense au stylet reste loin sous la limite,
  // mais rien n'empêcherait un client fautif d'envoyer dix mégaoctets.
  if (Buffer.byteLength(content, "utf8") > MAX_BLOCK_BYTES) {
    return { ok: false, error: "Ce bloc est trop volumineux pour être enregistré." };
  }

  const block = await prisma.noteBlock.findFirst({
    where: { id: blockId, note: { ownerId: user.id } },
    select: { noteId: true },
  });
  if (!block) return { ok: false, error: "Bloc introuvable." };

  await prisma.noteBlock.update({ where: { id: blockId }, data: { content } });
  await touch(block.noteId);
  return { ok: true };
}

export async function deleteBlock(blockId: string): Promise<NoteResult> {
  const user = await requireUser();
  const block = await prisma.noteBlock.findFirst({
    where: { id: blockId, note: { ownerId: user.id } },
    select: { noteId: true },
  });
  if (!block) return { ok: false, error: "Bloc introuvable." };

  await prisma.noteBlock.delete({ where: { id: blockId } });
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
  await touch(noteId);
  return { ok: true };
}

/** Range une note dans un dossier, ou la remet à la racine. */
export async function moveNote(noteId: string, folderId: string | null): Promise<NoteResult> {
  const user = await requireUser();

  if (folderId) {
    const dossier = await prisma.folder.findFirst({
      where: { id: folderId, ownerId: user.id },
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

export type ImportResult = { ok: true; file: string } | { ok: false; error: string };

/**
 * Importe un document à annoter et renvoie le PDF stocké.
 *
 * Le comptage des pages est laissé au client : il doit de toute façon charger
 * le PDF pour l'afficher, et le faire aussi ici obligerait à embarquer un
 * moteur PDF côté serveur pour un renseignement qu'on a déjà.
 */
export async function importNoteDocument(formData: FormData): Promise<ImportResult> {
  await requireUser();

  const file = formData.get("document");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Aucun fichier reçu." };
  }

  const { importDocument } = await import("@/lib/documents");
  const result = await importDocument(file);
  if ("error" in result) return { ok: false, error: result.error };
  return { ok: true, file: result.file };
}

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
  if (ratios.length > 200) return { ok: false, error: "Document trop long (200 pages maximum)." };

  const last = await prisma.noteBlock.findFirst({
    where: { noteId },
    orderBy: { position: "desc" },
    select: { position: true },
  });
  let position = (last?.position ?? -1) + 1;

  const premierRang = position;
  await prisma.noteBlock.createMany({
    data: ratios.map((ratio, index) => ({
      noteId,
      kind: "drawing",
      position: position++,
      content: JSON.stringify({
        strokes: [],
        // Le format de la page suit celui du document : annoter une page A4 sur
        // une feuille carrée décalerait tout.
        ratio: Math.min(MAX_RATIO, Math.max(0.2, ratio)),
        paper: "blank",
        backdrop: { file, page: index + 1 },
      }),
    })),
  });

  await touch(noteId);

  // Les blocs créés sont renvoyés pour que l'éditeur les affiche aussitôt.
  // Sans cela rien n'apparaissait, et l'on réimportait le document en croyant
  // que l'import avait échoué.
  const blocks = await prisma.noteBlock.findMany({
    where: { noteId, position: { gte: premierRang } },
    orderBy: { position: "asc" },
    select: { id: true, kind: true, content: true },
  });
  return { ok: true, blocks };
}
