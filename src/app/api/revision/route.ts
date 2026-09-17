import { z } from "zod";

import { apiError, withUser } from "@/lib/api-auth";
import { appliquerReponse, enregistrerSession } from "@/lib/revision";
import { TAILLE_LOT } from "@/lib/hors-ligne/modele";

const identifiant = z.string().min(8).max(64);
const instant = z.number().int().positive();

const lotSchema = z.object({
  reponses: z
    .array(z.object({ id: identifiant, cardId: z.string().min(1), knew: z.boolean(), answeredAt: instant }))
    .max(TAILLE_LOT),
  sessions: z
    .array(
      z.object({
        id: identifiant,
        deckId: z.string().min(1),
        correctCount: z.number().int().min(0),
        missCount: z.number().int().min(0),
        finishedAt: instant,
      }),
    )
    .max(TAILLE_LOT),
});

/**
 * Reçoit les réponses de révision posées sur l'appareil — en ligne comme hors
 * ligne, c'est le même chemin.
 *
 * Rend la liste de ce qui est **réglé** : appliqué, déjà reçu, ou devenu sans
 * objet (carte supprimée entre-temps). L'appareil efface ces envois-là et
 * garde les autres. Rejouer un lot entier est sans danger : l'identifiant de
 * chaque réponse empêche de la compter deux fois.
 */
export const POST = withUser(async (user, request) => {
  let corps: unknown;
  try {
    corps = await request.json();
  } catch {
    return apiError("Corps de requête illisible.", 400);
  }
  const lot = lotSchema.safeParse(corps);
  if (!lot.success) return apiError("Requête invalide.", 400);

  const regles: string[] = [];
  const now = new Date();

  // Dans l'ordre où les réponses ont été données : c'est la dernière qui
  // décide de la date de retour d'une carte.
  const reponses = [...lot.data.reponses].sort((a, b) => a.answeredAt - b.answeredAt);
  for (const r of reponses) {
    await appliquerReponse(user.id, { ...r, answeredAt: new Date(r.answeredAt) }, now);
    regles.push(r.id);
  }
  for (const s of lot.data.sessions) {
    await enregistrerSession(user.id, { ...s, finishedAt: new Date(s.finishedAt) }, now);
    regles.push(s.id);
  }

  return Response.json({ regles }, { headers: { "Cache-Control": "no-store" } });
});
