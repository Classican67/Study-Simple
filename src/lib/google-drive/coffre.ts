import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

/**
 * Le jeton de rafraîchissement Google, chiffré avant d'aller en base.
 *
 * Ce jeton ouvre le Drive de la personne aussi longtemps qu'elle ne l'a pas
 * révoqué. Une sauvegarde de la base — et il y en a une par nuit sur le NAS —
 * ne doit pas l'emporter en clair.
 *
 * AES-256-GCM, avec une clé **dérivée** de SESSION_SECRET (HKDF) plutôt que le
 * secret lui-même : une clé par usage, et une variable de moins à configurer.
 * Changer SESSION_SECRET rend donc le jeton illisible ; c'est voulu, cela
 * revient à demander de relier le Drive à nouveau, et `ouvrir` le dit.
 */

const VERSION = "v1";

function cle(secret: string): Buffer {
  return Buffer.from(hkdfSync("sha256", secret, "fiches", "google-drive-refresh-token", 32));
}

export function sceller(texte: string, secret: string): string {
  const iv = randomBytes(12);
  const chiffre = createCipheriv("aes-256-gcm", cle(secret), iv);
  const corps = Buffer.concat([chiffre.update(texte, "utf8"), chiffre.final()]);
  const etiquette = chiffre.getAuthTag();
  return `${VERSION}:${Buffer.concat([iv, etiquette, corps]).toString("base64")}`;
}

/** Le jeton en clair, ou `null` si le secret a changé ou si le contenu a été altéré. */
export function ouvrir(scelle: string, secret: string): string | null {
  const [version, charge] = scelle.split(":", 2);
  if (version !== VERSION || !charge) return null;
  try {
    const brut = Buffer.from(charge, "base64");
    const dechiffre = createDecipheriv("aes-256-gcm", cle(secret), brut.subarray(0, 12));
    dechiffre.setAuthTag(brut.subarray(12, 28));
    return Buffer.concat([dechiffre.update(brut.subarray(28)), dechiffre.final()]).toString("utf8");
  } catch {
    return null;
  }
}
