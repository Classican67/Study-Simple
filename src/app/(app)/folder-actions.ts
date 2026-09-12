"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { folderSchema } from "@/lib/validation";
import { MAX_FOLDER_DEPTH, depthOf, isDescendant } from "@/lib/folders";
import { isFolderKind, type FolderKind } from "@/lib/folder-tree";

export type FolderState = { error?: string };

// Charge l'arborescence du compte, nécessaire aux contrôles de profondeur et
// de cycle. Une seule requête, l'arbre restant petit.
async function treeOf(userId: string, kind: FolderKind) {
  return prisma.folder.findMany({
    where: { ownerId: userId, kind },
    select: { id: true, name: true, color: true, parentId: true },
  });
}

/** Le genre d'un dossier existant, ou « deck » s'il est introuvable. */
async function kindOf(folderId: string, userId: string): Promise<FolderKind> {
  const folder = await prisma.folder.findFirst({
    where: { id: folderId, ownerId: userId },
    select: { kind: true },
  });
  return isFolderKind(folder?.kind) ? folder.kind : "deck";
}

export async function createFolder(
  parentId: string | null,
  kind: FolderKind,
  _prev: FolderState,
  formData: FormData,
): Promise<FolderState> {
  const user = await requireUser();
  if (!isFolderKind(kind)) return { error: "Section inconnue." };

  const parsed = folderSchema.safeParse({
    name: formData.get("name"),
    color: formData.get("color") ?? "slate",
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Formulaire invalide." };

  if (parentId) {
    const tree = await treeOf(user.id, kind);
    if (!tree.some((f) => f.id === parentId)) return { error: "Dossier parent introuvable." };
    if (depthOf(tree, parentId) >= MAX_FOLDER_DEPTH) {
      return { error: `Profondeur maximale atteinte (${MAX_FOLDER_DEPTH} niveaux).` };
    }
  }

  await prisma.folder.create({ data: { ...parsed.data, parentId, kind, ownerId: user.id } });

  // Chaque section n'a à rafraîchir que la sienne : c'est tout l'objet du
  // genre. Un dossier de notes n'apparaît plus dans les paquets.
  // Les notes désignent leur dossier par l'adresse `/notes?folder=…`.
  if (kind === "note") revalidatePath("/notes");
  else revalidatePath(parentId ? `/folders/${parentId}` : "/");
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

  if ((await kindOf(folderId, user.id)) === "note") {
    revalidatePath("/notes");
    return {};
  }
  revalidatePath(`/folders/${folderId}`);
  revalidatePath("/");
  return {};
}

// `destination` vide = remonter à la racine.
export async function moveFolder(folderId: string, destination: string | null) {
  const user = await requireUser();
  // Un dossier ne change pas de section en se déplaçant : l'arbre consulté est
  // le sien, une destination de l'autre section n'y figure donc pas.
  const kind = await kindOf(folderId, user.id);
  const tree = await treeOf(user.id, kind);

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

  if (kind === "note") {
    revalidatePath("/notes");
    return;
  }
  revalidatePath("/");
  revalidatePath(`/folders/${folderId}`);
  if (folder.parentId) revalidatePath(`/folders/${folder.parentId}`);
  if (destination) revalidatePath(`/folders/${destination}`);
}

export async function deleteFolder(folderId: string) {
  const user = await requireUser();

  const folder = await prisma.folder.findFirst({
    where: { id: folderId, ownerId: user.id },
    select: { id: true, parentId: true, kind: true },
  });
  if (!folder) redirect("/");

  // La cascade emporte les sous-dossiers ; les paquets et les notes, eux, sont
  // détachés (relation en SetNull) et remontent donc à la racine.
  await prisma.folder.delete({ where: { id: folderId } });

  // On revient là d'où l'on venait : la section du dossier supprimé.
  if (folder.kind === "note") {
    revalidatePath("/notes");
    redirect(folder.parentId ? `/notes?folder=${folder.parentId}` : "/notes");
  }
  revalidatePath("/");
  redirect(folder.parentId ? `/folders/${folder.parentId}` : "/");
}

export async function moveDeck(deckId: string, destination: string | null) {
  const user = await requireUser();

  if (destination) {
    // Un dossier de notes n'accueille pas de paquets : les deux classements
    // sont séparés, et un paquet qui y atterrirait deviendrait invisible.
    const target = await prisma.folder.findFirst({
      where: { id: destination, ownerId: user.id, kind: "deck" },
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
