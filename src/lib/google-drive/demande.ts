import "server-only";

/**
 * La demande d'autorisation en cours, le temps d'un aller-retour chez Google.
 *
 * Un cookie `httpOnly`, limité aux routes de liaison et à dix minutes : il
 * porte le `state` à comparer au retour, le vérificateur PKCE, l'adresse de
 * retour exacte — Google exige la même à l'échange du code — et le compte qui
 * a lancé la demande. Un retour qui ne correspond pas à tout cela est refusé.
 */
export const COOKIE_DEMANDE = "fiches_google";
export const CHEMIN_DEMANDE = "/api/google-drive";

export type Demande = { state: string; verificateur: string; retour: string; userId: string };

export function cookieSecurise(): boolean {
  // Même règle que le cookie de session (`lib/session.ts`).
  return process.env.COOKIE_SECURE === "false"
    ? false
    : process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production";
}

export function lireDemande(valeur: string | undefined): Demande | null {
  if (!valeur) return null;
  try {
    const d = JSON.parse(Buffer.from(valeur, "base64url").toString("utf8")) as Partial<Demande>;
    if (typeof d.state !== "string" || typeof d.verificateur !== "string") return null;
    if (typeof d.retour !== "string" || typeof d.userId !== "string") return null;
    return d as Demande;
  } catch {
    return null;
  }
}

export function ecrireDemande(d: Demande): string {
  return Buffer.from(JSON.stringify(d), "utf8").toString("base64url");
}
