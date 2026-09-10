"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  defaultContent,
  isBlockKind,
  MAX_BLOCK_BYTES,
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

/** Marque la note comme modifiée : c'est ce qui la fait remonter dans la liste. */
async function touch(noteId: string) {
  await prisma.note.update({ where: { id: noteId }, data: { updatedAt: new Date() } });
}

export async function createNote(): Promise<string | null> {
  const user = await requireUser();

  // Une note neuve n'est pas vide : elle commence par un bloc de texte, prêt à
  // recevoir le curseur. Une page entièrement blanche laisse sans prise.
  const note = await prisma.note.create({
    data: {
      ownerId: user.id,
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
    data: { title: title.slice(0, 200), updatedAt: new Date() },
  });
  if (count !== 1) return { ok: false, error: "Note introuvable." };
  revalidatePath("/notes");
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
