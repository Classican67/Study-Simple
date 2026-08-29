import "server-only";

import { prisma } from "@/lib/prisma";

export const DECK_COLORS = {
  violet: "oklch(54% 0.21 292)",
  blue: "oklch(56% 0.17 250)",
  emerald: "oklch(58% 0.14 160)",
  amber: "oklch(70% 0.16 70)",
  rose: "oklch(60% 0.19 15)",
  slate: "oklch(55% 0.02 285)",
} as const;

export type DeckColor = keyof typeof DECK_COLORS;

export function deckColor(name: string): string {
  return DECK_COLORS[name as DeckColor] ?? DECK_COLORS.violet;
}

export type DeckSummary = {
  id: string;
  title: string;
  description: string;
  color: string;
  updatedAt: Date;
  cardCount: number;
  knownCount: number;
};

export async function listDecks(userId: string): Promise<DeckSummary[]> {
  const decks = await prisma.deck.findMany({
    where: { ownerId: userId },
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

  // Un groupBy plutôt qu'un `_count` filtré dans le select : Prisma ne sait pas
  // compter une relation sous condition, et une requête par paquet ferait N+1.
  const knownPerDeck = await prisma.card.groupBy({
    by: ["deckId"],
    where: {
      deck: { ownerId: userId },
      progress: { some: { userId, status: "known" } },
    },
    _count: { _all: true },
  });
  const knownMap = new Map(knownPerDeck.map((row) => [row.deckId, row._count._all]));

  return decks.map((deck) => ({
    id: deck.id,
    title: deck.title,
    description: deck.description,
    color: deck.color,
    updatedAt: deck.updatedAt,
    cardCount: deck._count.cards,
    knownCount: knownMap.get(deck.id) ?? 0,
  }));
}

// Renvoie null si le paquet n'existe pas OU n'appartient pas à l'utilisateur :
// l'appelant traite les deux cas en 404, ce qui évite de révéler l'existence
// du paquet de quelqu'un d'autre.
export async function getDeckForUser(deckId: string, userId: string) {
  return prisma.deck.findFirst({
    where: { id: deckId, ownerId: userId },
    select: { id: true, title: true, description: true, color: true, folderId: true },
  });
}

export type StudyCard = {
  id: string;
  term: string;
  definition: string;
  imagePath: string | null;
  status: string;
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
      progress: { where: { userId }, select: { status: true } },
    },
  });

  return cards.map((card) => ({
    id: card.id,
    term: card.term,
    definition: card.definition,
    imagePath: card.imagePath,
    status: card.progress[0]?.status ?? "new",
  }));
}
