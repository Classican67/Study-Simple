import { randomUUID } from "node:crypto";

import { z } from "zod";

import { prisma } from "@/lib/prisma";
import { appliquerReponse } from "@/lib/revision";
import { apiError, withUser } from "@/lib/api-auth";

const answerSchema = z.object({
  cardId: z.string().min(1),
  knew: z.boolean(),
});

/**
 * Enregistre une réponse et renvoie la nouvelle échéance.
 *
 * Même logique que la révision du web : une réussite allonge la série et
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

  // Le paquet doit appartenir au demandeur : `appliquerReponse` le vérifie,
  // sans quoi un jeton valide permettrait de modifier la progression d'autrui.
  const sort = await appliquerReponse(user.id, {
    id: randomUUID(),
    cardId,
    knew,
    answeredAt: new Date(),
  });
  if (sort === "carte-absente") return apiError("Carte introuvable.", 404);

  const progress = await prisma.cardProgress.findUniqueOrThrow({
    where: { userId_cardId: { userId: user.id, cardId } },
    select: { status: true, streak: true, dueAt: true },
  });
  return Response.json({
    status: progress.status,
    streak: progress.streak,
    dueAt: (progress.dueAt ?? new Date()).toISOString(),
  });
});
