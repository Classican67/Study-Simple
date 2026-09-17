import { z } from "zod";

import { apiError, withUser } from "@/lib/api-auth";
import { synchroniser } from "@/lib/hors-ligne/serveur";

const identifiants = z.array(z.string().min(1).max(64)).max(500);

const demandeSchema = z.object({
  paquets: identifiants,
  dossiers: identifiants,
  // Absent chez un appareil resté sur la version précédente de l'app.
  notes: identifiants.default([]),
  versions: z.record(z.string().max(64), z.string().max(64)),
});

/**
 * Synchronisation du contenu gardé hors ligne.
 *
 * Une route et non une action serveur : l'appareil doit savoir **pourquoi**
 * elle échoue — pas de réseau, session expirée — et une action rejetée ne le
 * dit pas. Réponse jamais mise en cache : elle porte les cartes du compte.
 */
export const POST = withUser(async (user, request) => {
  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return apiError("Corps de requête illisible.", 400);
  }
  const demande = demandeSchema.safeParse(corps);
  if (!demande.success) return apiError("Requête invalide.", 400);

  return Response.json(await synchroniser(user.id, demande.data), {
    headers: { "Cache-Control": "no-store" },
  });
});
