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
