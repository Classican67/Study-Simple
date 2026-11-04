import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { adresseAutorisation, adresseDeRetour, configuration, nouvelleDemande } from "@/lib/google-drive/google";
import { CHEMIN_DEMANDE, COOKIE_DEMANDE, cookieSecurise, ecrireDemande } from "@/lib/google-drive/demande";

/**
 * Départ de la liaison : la personne est envoyée chez Google, qui lui demande
 * d'autoriser l'app à déposer sa sauvegarde dans son Drive.
 *
 *   GET /api/google-drive/connexion
 *
 * Une navigation, pas un appel : c'est un lien de la page « Sauvegarde ».
 */
export async function GET(request: Request) {
  const user = await requireUser();
  const config = configuration();
  if (!config) return NextResponse.redirect(new URL("/sauvegarde?drive=config", request.url), 303);

  const retour = adresseDeRetour(config, request);
  const demande = nouvelleDemande();
  const reponse = NextResponse.redirect(adresseAutorisation(config, retour, demande, user.email), 303);
  reponse.cookies.set(
    COOKIE_DEMANDE,
    ecrireDemande({ state: demande.state, verificateur: demande.verificateur, retour, userId: user.id }),
    { httpOnly: true, secure: cookieSecurise(), sameSite: "lax", path: CHEMIN_DEMANDE, maxAge: 600 },
  );
  reponse.headers.set("Cache-Control", "no-store");
  return reponse;
}
