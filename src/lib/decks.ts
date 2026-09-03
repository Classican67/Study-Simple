import "server-only";

import { prisma } from "@/lib/prisma";
import { scoreCard, searchTerms } from "@/lib/search";

// Réexporté : la palette vit désormais dans un module sans `server-only`,
// pour être utilisable aussi côté client (résultats de recherche).
export { DECK_COLORS, deckColor, type DeckColor } from "@/lib/deck-colors";

/**
 * Condition Prisma « cette carte est à réviser » : jamais répondue par cet
 * utilisateur, ou échéance atteinte. Partagée par tous les compteurs pour
 * qu'ils ne puissent pas diverger de la sélection faite en révision.
 */
export function dueCardWhere(userId: string, now: Date = new Date()) {
  return {
    OR: [
      // Jamais répondue par cet utilisateur.
      { progress: { none: { userId } } },
      // Répondue AVANT l'arrivée de la planification : sans ce cas, toute
      // carte déjà marquée « sue » lors de la mise à jour resterait invisible
      // pour toujours, et les compteurs contrediraient la file de révision
      // (isDue() traite déjà une échéance nulle comme « à réviser »).
      { progress: { some: { userId, dueAt: null } } },
      // Échéance atteinte.
      { progress: { some: { userId, dueAt: { lte: now } } } },
    ],
  };
}

export type DeckSummary = {
  id: string;
  title: string;
  description: string;
  color: string;
  updatedAt: Date;
  cardCount: number;
  knownCount: number;
  dueCount: number;
};

// Renvoie null si le paquet n'existe pas OU n'appartient pas à l'utilisateur :
// l'appelant traite les deux cas en 404, ce qui évite de révéler l'existence
// du paquet de quelqu'un d'autre.
export type LastStudied = {
  deckId: string;
  title: string;
  color: string;
  at: Date;
  /** Cartes du paquet arrivées à échéance, pour proposer une reprise utile. */
  due: number;
};

/**
 * Dernier paquet réellement révisé, pour pouvoir y revenir d'un geste.
 *
 * On se fonde sur la dernière carte répondue, et non sur `StudySession` : une
 * session n'est enregistrée qu'une fois la série terminée, alors qu'on quitte
 * souvent en cours de route — et c'est précisément là qu'on veut reprendre.
 */
export async function getLastStudied(userId: string): Promise<LastStudied | null> {
  const last = await prisma.cardProgress.findFirst({
    where: { userId, lastSeenAt: { not: null }, card: { deck: { ownerId: userId } } },
    orderBy: { lastSeenAt: "desc" },
    select: {
      lastSeenAt: true,
      card: { select: { deck: { select: { id: true, title: true, color: true } } } },
    },
  });
  if (!last?.lastSeenAt) return null;

  const deck = last.card.deck;
  const due = await prisma.card.count({
    where: { deckId: deck.id, ...dueCardWhere(userId) },
  });

  return { deckId: deck.id, title: deck.title, color: deck.color, at: last.lastSeenAt, due };
}

export async function getDeckForUser(deckId: string, userId: string) {
  return prisma.deck.findFirst({
    where: { id: deckId, ownerId: userId },
    select: {
      id: true,
      title: true,
      description: true,
      color: true,
      folderId: true,
      // Le nom du dossier, pour que la page puisse proposer d'y remonter
      // plutôt que de renvoyer à la racine.
      folder: { select: { id: true, name: true } },
    },
  });
}

export type StudyCard = {
  id: string;
  term: string;
  definition: string;
  imagePath: string | null;
  status: string;
  /** Nulle = jamais répondue, donc à réviser. */
  dueAt: Date | null;
};

// Toutes les cartes du paquet avec l'état de progression de l'utilisateur.
// La mise en file (mélange, filtrage sur « à revoir ») se fait côté client,
// pour qu'une session entière tienne sans aller-retour serveur.
export async function getDeckCards(deckId: string, userId: string): Promise<StudyCard[]> {
  const cards = await prisma.card.findMany({
    where: { deckId },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
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

/**
 * Toutes les cartes à réviser du compte, tous paquets et dossiers confondus.
 * C'est la file du bouton « À réviser aujourd'hui ».
 */
export async function getDueCards(userId: string): Promise<StudyCard[]> {
  const cards = await prisma.card.findMany({
    where: { deck: { ownerId: userId }, ...dueCardWhere(userId) },
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

export type SearchResult = {
  cardId: string;
  deckId: string;
  deckTitle: string;
  deckColor: string;
  term: string;
  definition: string;
};

// Au-delà, la liste cesse d'être lisible et la requête d'être utile : mieux
// vaut affiner sa recherche que faire défiler cent résultats.
export const MAX_SEARCH_RESULTS = 30;

/**
 * Recherche des cartes par mots, dans un paquet ou dans tout le compte.
 *
 * Le filtrage grossier est fait par la base sur `searchText` (déjà normalisé,
 * donc insensible aux accents et à la casse) ; le classement par pertinence
 * est fait ensuite en mémoire, sur l'ensemble restreint que la base a renvoyé.
 * Un tri par pertinence en SQL demanderait une extension de recherche
 * plein texte, et ne serait plus portable entre SQLite et Postgres.
 */
export async function searchCards(
  userId: string,
  query: string,
  deckId?: string,
): Promise<SearchResult[]> {
  const terms = searchTerms(query);
  if (terms.length === 0) return [];

  const owned = { ownerId: userId, ...(deckId ? { id: deckId } : {}) };
  const select = {
    id: true,
    term: true,
    definition: true,
    deck: { select: { id: true, title: true, color: true } },
  };

  /*
   * Deux populations, réunies.
   *
   * L'index (`searchText`) est rempli à l'écriture de chaque carte, et
   * reconstruit au démarrage du serveur. Mais une carte peut s'y trouver
   * absente : celles créées avant l'arrivée de la colonne, tant que la
   * reconstruction n'a pas fini de les parcourir.
   *
   * La version précédente n'allait chercher ces cartes-là que si l'index
   * n'avait rien donné du tout. C'était faux dès qu'une base mêlait les deux :
   * une carte récente contenant le mot cherché suffisait à masquer toutes les
   * anciennes qui le contenaient aussi. Les deux requêtes sont donc lancées de
   * front — mesurée sur 5 000 cartes déjà indexées, la seconde coûte 0,5 ms et
   * ne ramène rien.
   */
  const [indexed, unindexed] = await Promise.all([
    prisma.card.findMany({
      where: {
        deck: owned,
        // Un « et » : la carte doit contenir tous les mots cherchés.
        AND: terms.map((needle) => ({ searchText: { contains: needle } })),
      },
      select,
      // Garde-fou : sur une requête très large, on borne le travail de tri.
      take: 400,
    }),
    prisma.card.findMany({ where: { deck: owned, searchText: "" }, select, take: 2000 }),
  ]);

  // Une carte peut figurer dans les deux listes si elle vient d'être indexée
  // entre les deux requêtes.
  const cards = [...indexed, ...unindexed.filter((c) => !indexed.some((i) => i.id === c.id))];

  return cards
    .map((card) => ({ card, score: scoreCard(card, terms) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_SEARCH_RESULTS)
    .map(({ card }) => ({
      cardId: card.id,
      deckId: card.deck.id,
      deckTitle: card.deck.title,
      deckColor: card.deck.color,
      term: card.term,
      definition: card.definition,
    }));
}
