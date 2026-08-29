import "server-only";

import { prisma } from "@/lib/prisma";
import type { DeckSummary } from "@/lib/decks";

export type FolderNode = {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
};

export type FolderSummary = FolderNode & {
  deckCount: number;
  childCount: number;
};

// Au-delà, le fil d'Ariane devient illisible et le déplacement incompréhensible.
// C'est une limite d'interface, pas de schéma.
export const MAX_FOLDER_DEPTH = 5;

// Un utilisateur a quelques dizaines de dossiers au plus : on les charge tous
// d'un coup et on construit l'arbre en mémoire, plutôt que de remonter les
// parents un par un (une requête par niveau) ou d'écrire du SQL récursif.
async function allFolders(userId: string): Promise<FolderNode[]> {
  return prisma.folder.findMany({
    where: { ownerId: userId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, color: true, parentId: true },
  });
}

// Chemin de la racine jusqu'au dossier, inclus.
export function buildBreadcrumb(folders: FolderNode[], folderId: string | null): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderNode[] = [];
  let current = folderId ? byId.get(folderId) : undefined;

  // La borne de profondeur protège aussi d'une boucle qui aurait échappé à la
  // validation : mieux vaut un fil tronqué qu'une page qui ne répond plus.
  while (current && path.length <= MAX_FOLDER_DEPTH + 1) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function depthOf(folders: FolderNode[], folderId: string | null): number {
  return buildBreadcrumb(folders, folderId).length;
}

// Un dossier ne peut pas être déplacé dans lui-même ni dans l'un de ses
// descendants : cela détacherait toute la branche de la racine.
export function isDescendant(
  folders: FolderNode[],
  candidateId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(candidateId);
  let guard = 0;
  while (current && guard++ <= MAX_FOLDER_DEPTH + 2) {
    if (current.id === ancestorId) return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

export type FolderView = {
  current: FolderNode | null;
  breadcrumb: FolderNode[];
  folders: FolderSummary[];
  decks: DeckSummary[];
};

/**
 * Contenu d'un dossier : ses sous-dossiers et ses paquets.
 * `folderId` nul désigne la racine.
 */
export async function getFolderView(userId: string, folderId: string | null): Promise<FolderView | null> {
  const folders = await allFolders(userId);

  // Un dossier inexistant et le dossier d'un autre compte donnent le même
  // résultat : l'appelant répond 404 dans les deux cas.
  const current = folderId ? (folders.find((f) => f.id === folderId) ?? null) : null;
  if (folderId && !current) return null;

  const children = folders.filter((f) => f.parentId === folderId);

  // Un seul groupBy pour tous les compteurs de paquets, plutôt qu'une requête
  // par sous-dossier.
  const deckCounts = await prisma.deck.groupBy({
    by: ["folderId"],
    where: { ownerId: userId, folderId: { in: children.map((c) => c.id) } },
    _count: { _all: true },
  });
  const deckCountMap = new Map(deckCounts.map((row) => [row.folderId, row._count._all]));

  const childCount = new Map<string, number>();
  for (const folder of folders) {
    if (!folder.parentId) continue;
    childCount.set(folder.parentId, (childCount.get(folder.parentId) ?? 0) + 1);
  }

  const decks = await prisma.deck.findMany({
    where: { ownerId: userId, folderId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      description: true,
      color: true,
      updatedAt: true,
      _count: { select: { cards: true } },
    },
  });

  // Cartes acquises par paquet, en une requête (cf. listDecks).
  const knownPerDeck = await prisma.card.groupBy({
    by: ["deckId"],
    where: {
      deck: { ownerId: userId, folderId },
      progress: { some: { userId, status: "known" } },
    },
    _count: { _all: true },
  });
  const knownMap = new Map(knownPerDeck.map((row) => [row.deckId, row._count._all]));

  return {
    current,
    breadcrumb: buildBreadcrumb(folders, folderId),
    folders: children.map((child) => ({
      ...child,
      deckCount: deckCountMap.get(child.id) ?? 0,
      childCount: childCount.get(child.id) ?? 0,
    })),
    decks: decks.map((deck) => ({
      id: deck.id,
      title: deck.title,
      description: deck.description,
      color: deck.color,
      updatedAt: deck.updatedAt,
      cardCount: deck._count.cards,
      knownCount: knownMap.get(deck.id) ?? 0,
    })),
  };
}

export type FolderOption = { id: string; label: string; depth: number; disabled: boolean };

/**
 * Liste plate de tous les dossiers, indentée, pour les menus de déplacement.
 * `excludeSubtreeOf` retire une branche entière : on ne propose pas à un
 * dossier de devenir son propre descendant.
 */
export async function listFolderOptions(
  userId: string,
  excludeSubtreeOf?: string,
): Promise<FolderOption[]> {
  const folders = await allFolders(userId);
  const options: FolderOption[] = [];

  function walk(parentId: string | null, depth: number) {
    for (const folder of folders.filter((f) => f.parentId === parentId)) {
      if (excludeSubtreeOf && folder.id === excludeSubtreeOf) continue;
      options.push({
        id: folder.id,
        label: folder.name,
        depth,
        // Un dossier déjà au niveau maximal ne peut plus en accueillir.
        disabled: depth >= MAX_FOLDER_DEPTH - 1,
      });
      walk(folder.id, depth + 1);
    }
  }
  walk(null, 0);

  return options;
}

export async function getFolderForUser(folderId: string, userId: string) {
  return prisma.folder.findFirst({
    where: { id: folderId, ownerId: userId },
    select: { id: true, name: true, color: true, parentId: true },
  });
}
