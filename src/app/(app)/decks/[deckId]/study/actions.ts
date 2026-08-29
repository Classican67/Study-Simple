"use server";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/auth";
import { nextDueAt } from "@/lib/scheduling";

// Enregistré carte par carte plutôt qu'en bloc à la fin : fermer l'onglet au
// milieu d'une session ne fait alors perdre aucune réponse déjà donnée.
export async function recordAnswer(cardId: string, knew: boolean) {
  const user = await requireUser();

  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { ownerId: user.id } },
    select: { id: true },
  });
  if (!card) return;

  const existing = await prisma.cardProgress.findUnique({
    where: { userId_cardId: { userId: user.id, cardId } },
    select: { streak: true },
  });

  // Une bonne réponse fait passer « su » ; une mauvaise remet la carte en
  // apprentissage et casse la série, quelle que soit la progression acquise.
  const streak = knew ? (existing?.streak ?? 0) + 1 : 0;
  const status = knew ? "known" : "learning";
  // Plus la série est longue, plus la carte revient tard. Une carte ratée
  // repart à zéro et redevient due immédiatement.
  const now = new Date();
  const dueAt = nextDueAt(streak, now);

  await prisma.cardProgress.upsert({
    where: { userId_cardId: { userId: user.id, cardId } },
    create: {
      userId: user.id,
      cardId,
      status,
      streak,
      correctCount: knew ? 1 : 0,
      missCount: knew ? 0 : 1,
      lastSeenAt: now,
      dueAt,
    },
    update: {
      status,
      streak,
      correctCount: { increment: knew ? 1 : 0 },
      missCount: { increment: knew ? 0 : 1 },
      lastSeenAt: now,
      dueAt,
    },
  });
}

export async function finishSession(
  deckId: string,
  correctCount: number,
  missCount: number,
) {
  const user = await requireUser();
  if (!(await prisma.deck.findFirst({ where: { id: deckId, ownerId: user.id }, select: { id: true } }))) {
    return;
  }

  await prisma.studySession.create({
    data: { userId: user.id, deckId, finishedAt: new Date(), correctCount, missCount },
  });

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/");
}

// Remet tout le paquet à zéro pour cet utilisateur seulement : les autres
// comptes gardent leur progression sur les mêmes cartes.
export async function resetDeckProgress(deckId: string) {
  const user = await requireUser();

  await prisma.cardProgress.deleteMany({
    where: { userId: user.id, card: { deckId, deck: { ownerId: user.id } } },
  });

  revalidatePath(`/decks/${deckId}`);
  revalidatePath("/");
}
