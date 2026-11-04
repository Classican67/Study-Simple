import { timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { sceller, ouvrir } from "@/lib/google-drive/coffre";
import {
  adresseDuCompte,
  configuration,
  echangerCode,
  ErreurGoogle,
  oublierJeton,
  retenirJeton,
  revoquer,
} from "@/lib/google-drive/google";
import { CHEMIN_DEMANDE, COOKIE_DEMANDE, cookieSecurise, lireDemande } from "@/lib/google-drive/demande";
import { synchroniser } from "@/lib/google-drive/sync";

/**
 * Retour de Google : on échange le code contre les jetons, **ici**, puis on
 * renvoie la personne vers une adresse qui ne porte plus le code — Google le
 * recommande, pour qu'il ne traîne ni dans l'historique ni dans un en-tête
 * `Referer`.
 *
 *   GET /api/google-drive/retour?code=…&state=…
 */
export async function GET(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const vers = (etat: string) => {
    const reponse = NextResponse.redirect(new URL(`/sauvegarde?drive=${etat}`, request.url), 303);
    reponse.cookies.set(COOKIE_DEMANDE, "", {
      httpOnly: true,
      secure: cookieSecurise(),
      sameSite: "lax",
      path: CHEMIN_DEMANDE,
      maxAge: 0,
    });
    reponse.headers.set("Cache-Control", "no-store");
    return reponse;
  };

  const config = configuration();
  if (!config) return vers("config");

  // La personne a refusé chez Google : rien n'a été accordé, rien à garder.
  if (url.searchParams.get("error")) return vers("refuse");

  const demande = lireDemande((await cookies()).get(COOKIE_DEMANDE)?.value);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (
    !demande ||
    !code ||
    demande.userId !== user.id ||
    state.length !== demande.state.length ||
    !timingSafeEqual(Buffer.from(state), Buffer.from(demande.state))
  ) {
    return vers("expire");
  }

  try {
    const jetons = await echangerCode(config, code, demande.retour, demande.verificateur);
    const courriel = await adresseDuCompte(jetons.acces).catch(() => "");
    const secret = process.env.SESSION_SECRET ?? "";

    // Un lien précédent : son jeton est révoqué. Google limite le nombre de
    // jetons par compte, et les plus anciens cessent de fonctionner sans
    // prévenir quand on dépasse.
    const ancien = await prisma.driveLink.findUnique({ where: { userId: user.id } });
    const ancienJeton = ancien ? ouvrir(ancien.refreshToken, secret) : null;
    if (ancienJeton) await revoquer(ancienJeton);

    oublierJeton(user.id);
    retenirJeton(user.id, jetons.acces, jetons.expire);
    const donnees = {
      refreshToken: sceller(jetons.refresh, secret),
      email: courriel,
      lastStatus: "",
      lastError: "",
      signature: "",
    };
    await prisma.driveLink.upsert({
      where: { userId: user.id },
      create: { userId: user.id, ...donnees },
      update: donnees,
    });
    // Un autre compte Google que la fois précédente : ce qu'on croyait déposé
    // est dans l'autre Drive. On repart de rien — les étiquettes des fichiers
    // retrouveront une sauvegarde existante dans celui-ci.
    if (ancien && ancien.email !== courriel) await prisma.driveItem.deleteMany({ where: { userId: user.id } });

    // La première passe part tout de suite, sans faire attendre la page.
    void synchroniser(user.id, { force: true }).catch((error) => console.error("[google-drive]", error));
    return vers("relie");
  } catch (error) {
    console.error("[google-drive] liaison :", error);
    return vers(error instanceof ErreurGoogle && error.nature === "acces" ? "refuse" : "erreur");
  }
}
