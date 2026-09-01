import "server-only";

import { prisma } from "@/lib/prisma";
import { readSession, verifySessionToken } from "@/lib/session";
import type { CurrentUser } from "@/lib/auth";

/**
 * Authentification des routes d'API.
 *
 * Le web s'authentifie par un cookie httpOnly ; une application mobile ne peut
 * pas s'en servir — elle n'a pas de gestionnaire de cookies partagé et doit
 * ranger son jeton dans le stockage sécurisé du système. Ces routes acceptent
 * donc les deux : `Authorization: Bearer <jeton>` d'abord, cookie ensuite.
 *
 * Le jeton est exactement celui du cookie : même signature, même charge utile.
 * Un seul mécanisme à raisonner, un seul secret à protéger.
 */
export async function getApiUser(request: Request): Promise<CurrentUser | null> {
  const header = request.headers.get("authorization");
  const bearer = header?.startsWith("Bearer ") ? header.slice(7).trim() : null;

  const payload = bearer ? await verifySessionToken(bearer) : await readSession();
  if (!payload) return null;

  // On relit l'utilisateur en base : un compte supprimé perd l'accès
  // immédiatement, sans attendre l'expiration du jeton.
  return prisma.user.findUnique({
    where: { id: payload.userId },
    select: { id: true, email: true, name: true, role: true },
  });
}

/** Réponse JSON d'erreur, au format uniforme des routes d'API. */
export function apiError(message: string, status: number): Response {
  return Response.json({ error: message }, { status });
}

/**
 * Enveloppe une route qui exige un compte. Renvoie 401 en JSON plutôt qu'une
 * redirection vers /login : un client mobile ne sait rien faire d'une page.
 */
export function withUser(
  handler: (user: CurrentUser, request: Request) => Promise<Response>,
) {
  return async (request: Request): Promise<Response> => {
    const user = await getApiUser(request);
    if (!user) return apiError("Authentification requise.", 401);
    return handler(user, request);
  };
}
