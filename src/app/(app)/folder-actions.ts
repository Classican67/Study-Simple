"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { folderSchema } from "@/lib/validation";
import { MAX_FOLDER_DEPTH, depthOf, isDescendant } from "@/lib/folders";

export type FolderState = { error?: string };

// Charge l'arborescence du compte, nécessaire aux contrôles de profondeur et
// de cycle. Une seule requête, l'arbre restant petit.
async function treeOf(userId: string) {
  return prisma.folder.findMany({
    where: { ownerId: userId },
    select: { id: true, name: true, color: true, parentId: true },
  });
}

export async function createFolder(
  parentId: string | null,
  _prev: FolderState,
  formData: FormData,
): Promise<FolderState> {
  const user = await requireUser();

  const parsed = folderSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") ?? "slate",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  if (parentId) {
    const tree = await treeOf(user.id);
    if (!tree.some((f) => f.id === parentId)) return { error: "Dossier parent introuvable." };
    if (depthOf(tree, parentId) >= MAX_FOLDER_DEPTH) {
      return { error: `Profondeur maximale atteinte (${MAX_FOLDER_DEPTH} niveaux).` };
    }
  }

  await prisma.folder.create({ data: { ...parsed.data, parentId, ownerId: user.id } });

  revalidatePath(parentId ? `/folders/${parentId}` : "/");
  return {};
}

export async function updateFolder(
  folderId: string,
  _prev: FolderState,
  formData: FormData,
): Promise<FolderState> {
  const user = await requireUser();

  const parsed = folderSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") ?? "slate",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  const { count } = await prisma.folder.updateMany({
    where: { id: folderId, ownerId: user.id },
    data: parsed.data,
  });
  if (count === 0) return { error: "Dossier introuvable." };

  revalidatePath(`/folders/${folderId}`);
  revalidatePath("/");
  return {};
}

// `destination` vide = remonter à la racine.
export async function moveFolder(folderId: string, destination: string | null) {
  const user = await requireUser();
  const tree = await treeOf(user.id);

  const folder = tree.find((f) => f.id === folderId);
  if (!folder) return;

  if (destination) {
    if (!tree.some((f) => f.id === destination)) return;
    // Déplacer un dossier dans son propre sous-arbre détacherait la branche
    // entière de la racine : elle deviendrait inaccessible.
    if (isDescendant(tree, destination, folderId)) return;
    if (depthOf(tree, destination) >= MAX_FOLDER_DEPTH) return;
  }

  await prisma.folder.update({ where: { id: folderId }, data: { parentId: destination } });

  revalidatePath("/");
  revalidatePath(`/folders/${folderId}`);
  if (folder.parentId) revalidatePath(`/folders/${folder.parentId}`);
  if (destination) revalidatePath(`/folders/${destination}`);
}

export async function deleteFolder(folderId: string) {
  const user = await requireUser();

  const folder = await prisma.folder.findFirst({
    where: { id: folderId, ownerId: user.id },
    select: { id: true, parentId: true },
  });
  if (!folder) redirect("/");

  // La cascade emporte les sous-dossiers ; les paquets, eux, sont détachés
  // (Deck.folder est en SetNull) et remontent donc à la racine.
  await prisma.folder.delete({ where: { id: folderId } });

  revalidatePath("/");
  redirect(folder.parentId ? `/folders/${folder.parentId}` : "/");
}

export async function moveDeck(deckId: string, destination: string | null) {
  const user = await requireUser();

  if (destination) {
    const target = await prisma.folder.findFirst({
      where: { id: destination, ownerId: user.id },
      select: { id: true },
    });
    if (!target) return;
  }

  // ownerId dans le where : déplacer le paquet d'autrui ne touche aucune ligne.
  await prisma.deck.updateMany({
    where: { id: deckId, ownerId: user.id },
    data: { folderId: destination },
  });

  revalidatePath("/");
  revalidatePath(`/decks/${deckId}`);
  if (destination) revalidatePath(`/folders/${destination}`);
}
