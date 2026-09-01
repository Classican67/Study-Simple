import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { nextDueAt } from "@/lib/scheduling";
import { apiError, withUser } from "@/lib/api-auth";

const answerSchema = z.object({
  cardId: z.string().min(1),
  knew: z.boolean(),
});

/**
 * Enregistre une réponse et renvoie la nouvelle échéance.
 *
 * Même logique que l'action serveur du web : une réussite allonge la série et
 * repousse la carte, un échec repart à zéro et la ramène tout de suite. La
 * planification est calculée par le même module, pour que le web et le mobile
 * ne puissent pas diverger.
 */
export const POST = withUser(async (user, request) => {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return apiError("Corps de requête illisible.", 400);
  }

  const parsed = answerSchema.safeParse(body);
  if (!parsed.success) return apiError("Requête invalide.", 400);
  const { cardId, knew } = parsed.data;

  // Le paquet doit appartenir au demandeur : sans ce contrôle, un jeton valide
  // permettrait de modifier la progression sur les cartes d'autrui.
  const card = await prisma.card.findFirst({
    where: { id: cardId, deck: { ownerId: user.id } },
    select: { id: true },
  });
  if (!card) return apiError("Carte introuvable.", 404);

  const existing = await prisma.cardProgress.findUnique({
    where: { userId_cardId: { userId: user.id, cardId } },
    select: { streak: true },
  });

  const streak = knew ? (existing?.streak ?? 0) + 1 : 0;
  const status = knew ? "known" : "learning";
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

  return Response.json({ status, streak, dueAt: dueAt.toISOString() });
});
