"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { deleteUnreferencedUploads } from "@/lib/uploads";

/**
 * Actions sur une sélection de paquets ou de notes.
 *
 * Mêmes garde-fous que les actions unitaires — `ownerId` dans chaque `where`,
 * genre du dossier de destination vérifié — mais en une requête : déplacer
 * trente notes ne doit pas coûter trente allers-retours, ni laisser la moitié
 * déplacée si le réseau coupe au milieu.
 */

export type SelectionResult = { ok: boolean; count: number; error?: string };

// Une sélection vient du client : on la borne et on n'en garde que des chaînes.
const MAX_SELECTION = 500;

function nettoyer(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is string => typeof id === "string" && id.length > 0))].slice(
    0,
    MAX_SELECTION,
  );
}

async function dossierValide(userId: string, id: string, kind: "deck" | "note") {
  const dossier = await prisma.folder.findFirst({
    where: { id, ownerId: userId, kind },
    select: { id: true },
  });
  return dossier !== null;
}

export async function moveDecks(ids: string[], destination: string | null): Promise<SelectionResult> {
  const user = await requireUser();
  const decks = nettoyer(ids);
  if (decks.length === 0) return { ok: true, count: 0 };

  // Un dossier de notes n'accueille pas de paquets : ils y deviendraient
  // invisibles.
  if (destination && !(await dossierValide(user.id, destination, "deck"))) {
    return { ok: false, count: 0, error: "Dossier introuvable." };
  }

  const { count } = await prisma.deck.updateMany({
    where: { id: { in: decks }, ownerId: user.id },
    data: { folderId: destination },
  });

  revalidatePath("/", "layout");
  return { ok: true, count };
}

export async function deleteDecks(ids: string[]): Promise<SelectionResult> {
  const user = await requireUser();
  const decks = nettoyer(ids);
  if (decks.length === 0) return { ok: true, count: 0 };

  const cartes = await prisma.card.findMany({
    where: { deck: { id: { in: decks }, ownerId: user.id } },
    select: { imagePath: true },
  });

  const { count } = await prisma.deck.deleteMany({ where: { id: { in: decks }, ownerId: user.id } });
  // Après l'écriture, comme `deleteDeck` : une carte regroupée ailleurs
  // partage le fichier de son originale, et seul l'état final dit s'il est
  // devenu orphelin.
  await deleteUnreferencedUploads(cartes.map((c) => c.imagePath));

  revalidatePath("/", "layout");
  return { ok: true, count };
}

export async function moveNotes(ids: string[], folderId: string | null): Promise<SelectionResult> {
  const user = await requireUser();
  const notes = nettoyer(ids);
  if (notes.length === 0) return { ok: true, count: 0 };

  if (folderId && !(await dossierValide(user.id, folderId, "note"))) {
    return { ok: false, count: 0, error: "Dossier introuvable." };
  }

  const { count } = await prisma.note.updateMany({
    where: { id: { in: notes }, ownerId: user.id },
    data: { folderId },
  });

  revalidatePath("/notes");
  return { ok: true, count };
}

export async function deleteNotes(ids: string[]): Promise<SelectionResult> {
  const user = await requireUser();
  const { fichiersDeLaNote, nettoyerFichiers } = await import("@/lib/note-uploads");
  const demandees = nettoyer(ids);
  if (demandees.length === 0) return { ok: true, count: 0 };

  // Les fichiers se relèvent **avant** : après, plus rien ne dit de quels
  // fichiers les notes se servaient. Et seulement sur les notes du compte.
  const notes = await prisma.note.findMany({
    where: { id: { in: demandees }, ownerId: user.id },
    select: { id: true },
  });
  const fichiers = (await Promise.all(notes.map((n) => fichiersDeLaNote(n.id)))).flat();

  const { count } = await prisma.note.deleteMany({
    where: { id: { in: notes.map((n) => n.id) }, ownerId: user.id },
  });
  await nettoyerFichiers(fichiers);

  revalidatePath("/notes");
  return { ok: true, count };
}

export async function setNotesMastered(ids: string[], mastered: boolean): Promise<SelectionResult> {
  const user = await requireUser();
  const notes = nettoyer(ids);
  if (notes.length === 0) return { ok: true, count: 0 };

  // Une mise à jour par note, qui rend à chacune sa date : `updateMany`
  // réécrirait `updatedAt` partout, et marquer une note ne doit pas changer le
  // tri (cf. `setNoteMastered`).
  const existantes = await prisma.note.findMany({
    where: { id: { in: notes }, ownerId: user.id },
    select: { id: true, updatedAt: true },
  });
  await prisma.$transaction(
    existantes.map((n) =>
      prisma.note.update({
        where: { id: n.id },
        data: { mastered: mastered === true, updatedAt: n.updatedAt },
      }),
    ),
  );

  revalidatePath("/notes");
  return { ok: true, count: existantes.length };
}
