import "server-only";

import { prisma } from "@/lib/prisma";
import { dueCardWhere, type DeckSummary } from "@/lib/decks";
import {
  MAX_FOLDER_DEPTH,
  buildBreadcrumb,
  depthOf,
  descendantIds,
  isDescendant,
  type FolderNode,
} from "@/lib/folder-tree";

// Réexportés pour que les appelants n'aient qu'un module à connaître.
export { MAX_FOLDER_DEPTH, buildBreadcrumb, depthOf, descendantIds, isDescendant };
export type { FolderNode };

export type FolderSummary = FolderNode & {
  deckCount: number;
  childCount: number;
  /** Cartes à réviser dans tout le sous-arbre du dossier. */
  dueCount: number;
};

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

export type FolderView = {
  current: FolderNode | null;
  breadcrumb: FolderNode[];
  folders: FolderSummary[];
  decks: DeckSummary[];
  /** Cartes contenues dans tout le sous-arbre, pour la révision du dossier. */
  subtreeCards: number;
  /** Cartes à réviser ici et maintenant, dans tout le sous-arbre. */
  dueHere: number;
  /** Cartes à réviser sur l'ensemble du compte, tous dossiers confondus. */
  dueTotal: number;
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

  // Cartes acquises par paquet, en une requête plutôt qu'une par paquet.
  const knownPerDeck = await prisma.card.groupBy({
    by: ["deckId"],
    where: {
      deck: { ownerId: userId, folderId },
      progress: { some: { userId, status: "known" } },
    },
    _count: { _all: true },
  });
  const knownMap = new Map(knownPerDeck.map((row) => [row.deckId, row._count._all]));

  // Échéances de tout le compte, en une requête, puis remontée dans l'arbre en
  // mémoire. L'alternative — une requête par dossier — coûterait autant de
  // requêtes que de dossiers, à chaque affichage de l'accueil.
  const dueByDeck = await prisma.card.groupBy({
    by: ["deckId"],
    where: { deck: { ownerId: userId }, ...dueCardWhere(userId) },
    _count: { _all: true },
  });
  const dueMap = new Map(dueByDeck.map((row) => [row.deckId, row._count._all]));

  const allDecks = await prisma.deck.findMany({
    where: { ownerId: userId },
    select: { id: true, folderId: true },
  });

  const dueTotal = allDecks.reduce((sum, deck) => sum + (dueMap.get(deck.id) ?? 0), 0);

  // Échéances directement posées dans chaque dossier…
  const dueDirect = new Map<string, number>();
  for (const deck of allDecks) {
    if (!deck.folderId) continue;
    dueDirect.set(deck.folderId, (dueDirect.get(deck.folderId) ?? 0) + (dueMap.get(deck.id) ?? 0));
  }
  // …puis cumulées sur tout le sous-arbre de chacun.
  const dueSubtree = new Map<string, number>();
  for (const folder of folders) {
    dueSubtree.set(
      folder.id,
      descendantIds(folders, folder.id).reduce((sum, id) => sum + (dueDirect.get(id) ?? 0), 0),
    );
  }

  // Nombre de cartes de tout le sous-arbre : conditionne l'offre de réviser
  // le dossier entier. Une seule requête, quelle que soit la profondeur.
  const subtreeIds = folderId ? descendantIds(folders, folderId) : null;
  const subtreeCards = subtreeIds
    ? await prisma.card.count({
        where: { deck: { ownerId: userId, folderId: { in: subtreeIds } } },
      })
    : 0;

  return {
    current,
    breadcrumb: buildBreadcrumb(folders, folderId),
    subtreeCards,
    dueHere: folderId ? (dueSubtree.get(folderId) ?? 0) : dueTotal,
    dueTotal,
    folders: children.map((child) => ({
      ...child,
      deckCount: deckCountMap.get(child.id) ?? 0,
      childCount: childCount.get(child.id) ?? 0,
      dueCount: dueSubtree.get(child.id) ?? 0,
    })),
    decks: decks.map((deck) => ({
      id: deck.id,
      title: deck.title,
      description: deck.description,
      color: deck.color,
      updatedAt: deck.updatedAt,
      cardCount: deck._count.cards,
      knownCount: knownMap.get(deck.id) ?? 0,
      dueCount: dueMap.get(deck.id) ?? 0,
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

/**
 * Toutes les cartes contenues dans un dossier, sous-dossiers compris.
 * Sert à la révision d'un dossier entier.
 */
export async function getFolderCards(userId: string, folderId: string) {
  const folders = await allFolders(userId);
  const ids = descendantIds(folders, folderId);

  const cards = await prisma.card.findMany({
    where: { deck: { ownerId: userId, folderId: { in: ids } } },
    orderBy: [{ deckId: "asc" }, { position: "asc" }],
    select: {
      id: true,
      term: true,
      definition: true,
      imagePath: true,
      progress: { where: { userId }, select: { status: true, dueAt: true } },
    },
  });

  return cards.map((card) => ({
    id: card.id,
    term: card.term,
    definition: card.definition,
    imagePath: card.imagePath,
    status: card.progress[0]?.status ?? "new",
    dueAt: card.progress[0]?.dueAt ?? null,
  }));
}
