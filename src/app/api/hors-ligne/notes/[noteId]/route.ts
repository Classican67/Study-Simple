import { apiError, withUser } from "@/lib/api-auth";
import { noteHorsLigne } from "@/lib/hors-ligne/serveur";

/**
 * Une note entière, pour la garder sur l'appareil.
 *
 * Séparée de la synchronisation : une page manuscrite dense pèse plusieurs
 * mégaoctets, et les renvoyer toutes d'un bloc ferait tenir la synchronisation
 * entière dans la mémoire du navigateur — et tout recommencer si la connexion
 * coupe à la dernière.
 */
export async function GET(request: Request, context: RouteContext<"/api/hors-ligne/notes/[noteId]">) {
  const { noteId } = await context.params;
  return withUser(async (user) => {
    const note = await noteHorsLigne(user.id, noteId);
    if (!note) return apiError("Note introuvable.", 404);
    return Response.json(note, { headers: { "Cache-Control": "no-store" } });
  })(request);
}
