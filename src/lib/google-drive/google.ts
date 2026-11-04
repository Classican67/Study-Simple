import "server-only";

import { createHash, randomBytes } from "node:crypto";

/**
 * Google, vu du serveur : OAuth et l'API Drive, en `fetch` et rien d'autre.
 *
 * Pas de `googleapis` : la bibliothèque pèse des dizaines de mégaoctets pour
 * six appels, et chaque dépendance de plus est une occasion de plus de casser
 * le verrou npm — le déploiement a échoué deux fois là-dessus.
 *
 * Les pratiques suivies sont celles de la documentation de Google :
 *
 * - **flux serveur** (« web server application ») : le code d'autorisation est
 *   échangé ici, jamais dans le navigateur, puis la personne est renvoyée vers
 *   une adresse qui ne le porte plus ;
 * - **`state`** contre la falsification de requête, et **PKCE** (S256) en
 *   plus du secret client : un code intercepté ne vaut rien sans le
 *   vérificateur, qui ne quitte pas le serveur et le cookie ;
 * - **`access_type=offline`** pour obtenir un jeton de rafraîchissement, et
 *   **`prompt=consent`** pour l'obtenir à chaque liaison — Google ne le rend
 *   sinon qu'à la toute première ;
 * - **la portée `drive.file`**, la plus étroite : l'app ne voit que les
 *   fichiers qu'elle a créés. Elle est classée non sensible, ce qui épargne
 *   l'audit de sécurité qu'exigent `drive` et `drive.readonly` ;
 * - **reprise exponentielle tronquée** sur 403 de quota, 429 et 5xx :
 *   2ⁿ secondes plus jusqu'à une seconde de hasard, plafonnée à trente-deux ;
 * - **téléversement « resumable »** pour tout fichier : il vaut pour les
 *   petits comme pour les polycopiés de quarante mégaoctets, au prix d'une
 *   requête de plus.
 */

export const PORTEE = "https://www.googleapis.com/auth/drive.file";

type Points = { auth: string; token: string; revoke: string; api: string; upload: string };

/**
 * Les adresses de Google.
 *
 * `GOOGLE_ENDPOINT_BASE` ne sert **qu'aux essais** : il les remplace toutes par
 * un faux Google local (`verify/faux-google.mjs`), ce qui permet d'éprouver la
 * liaison et la synchronisation de bout en bout sans compte réel. En
 * production, il ne doit pas être défini.
 */
function points(): Points {
  const base = process.env.GOOGLE_ENDPOINT_BASE?.replace(/\/+$/, "");
  if (base) {
    return {
      auth: `${base}/o/oauth2/v2/auth`,
      token: `${base}/token`,
      revoke: `${base}/revoke`,
      api: `${base}/drive/v3`,
      upload: `${base}/upload/drive/v3`,
    };
  }
  return {
    auth: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
    revoke: "https://oauth2.googleapis.com/revoke",
    api: "https://www.googleapis.com/drive/v3",
    upload: "https://www.googleapis.com/upload/drive/v3",
  };
}

export type Configuration = { clientId: string; clientSecret: string; redirectUri: string | null };

/** La configuration OAuth, ou `null` si l'administrateur ne l'a pas posée. */
export function configuration(): Configuration | null {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return null;
  return { clientId, clientSecret, redirectUri: process.env.GOOGLE_REDIRECT_URI?.trim() || null };
}

/**
 * L'adresse de retour, **identique** à celle déclarée chez Google.
 *
 * Google la compare au caractère près — schéma, casse, barre finale. Mieux
 * vaut la poser (`GOOGLE_REDIRECT_URI`) ; à défaut, on la reconstruit depuis
 * les en-têtes du proxy (Caddy transmet l'hôte et `X-Forwarded-Proto`), parce
 * que Next, derrière lui, se croit en http.
 */
export function adresseDeRetour(config: Configuration, request: Request): string {
  if (config.redirectUri) return config.redirectUri;
  const url = new URL(request.url);
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || url.protocol.replace(":", "");
  const hote = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() || request.headers.get("host") || url.host;
  return `${proto}://${hote}/api/google-drive/retour`;
}

const base64url = (octets: Buffer) => octets.toString("base64url");

/** Un `state` et un vérificateur PKCE neufs, et le défi qui en découle. */
export function nouvelleDemande(): { state: string; verificateur: string; defi: string } {
  const verificateur = base64url(randomBytes(48));
  return {
    state: base64url(randomBytes(24)),
    verificateur,
    defi: base64url(createHash("sha256").update(verificateur).digest()),
  };
}

export function adresseAutorisation(
  config: Configuration,
  retour: string,
  demande: { state: string; defi: string },
  courriel?: string,
): string {
  const url = new URL(points().auth);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: retour,
    response_type: "code",
    scope: PORTEE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: demande.state,
    code_challenge: demande.defi,
    code_challenge_method: "S256",
    ...(courriel ? { login_hint: courriel } : {}),
  }).toString();
  return url.toString();
}

/* -------------------------------------------------------------------------- *
 * Erreurs
 * -------------------------------------------------------------------------- */

/**
 * Ce qu'une erreur de Google appelle comme conduite.
 *
 * - `acces` : le jeton ne vaut plus (révoqué, expiré, secret changé). Rien ne
 *   sert de réessayer ; il faut relier le Drive.
 * - `introuvable` : le fichier visé n'existe plus — on l'a supprimé à la main
 *   dans Drive. On le recrée.
 * - `passager` : quota, surcharge, réseau. On a déjà réessayé ; on réessaiera à
 *   la prochaine passe.
 * - `autre` : une requête refusée pour de bon.
 */
export type NatureErreur = "acces" | "introuvable" | "passager" | "autre";

export class ErreurGoogle extends Error {
  constructor(
    message: string,
    readonly statut: number,
    readonly nature: NatureErreur,
  ) {
    super(message);
  }
}

/** Raisons d'un 403 qui ne sont qu'un quota : on attend, on réessaie. */
const RAISONS_QUOTA = new Set(["rateLimitExceeded", "userRateLimitExceeded", "sharingRateLimitExceeded"]);

async function lireErreur(reponse: Response): Promise<{ message: string; raison: string }> {
  const corps = (await reponse.json().catch(() => null)) as
    | { error?: string | { message?: string; errors?: { reason?: string }[] }; error_description?: string }
    | null;
  if (typeof corps?.error === "string") {
    return { message: corps.error_description ?? corps.error, raison: corps.error };
  }
  return {
    message: corps?.error?.message ?? `HTTP ${reponse.status}`,
    raison: corps?.error?.errors?.[0]?.reason ?? "",
  };
}

const ESSAIS = 5;
const ATTENTE_MAX = 32_000;
/** Base de l'attente, raccourcissable pour les essais (`GOOGLE_BACKOFF_MS`). */
const ATTENTE_BASE = Number(process.env.GOOGLE_BACKOFF_MS ?? 1000);

const dormir = (ms: number) => new Promise((ok) => setTimeout(ok, ms));

/**
 * Un appel, avec la reprise que Google demande.
 *
 * `min(2ⁿ s + hasard ≤ 1 s, 32 s)`, cinq essais. Au-delà, l'erreur remonte et
 * la passe suivante reprendra : réessayer sans fin bloquerait la file des
 * autres comptes.
 */
async function appel(url: string, init: RequestInit): Promise<Response> {
  for (let essai = 0; ; essai++) {
    let reponse: Response | null = null;
    try {
      reponse = await fetch(url, { ...init, cache: "no-store", redirect: "manual" });
    } catch (error) {
      if (essai + 1 >= ESSAIS) {
        throw new ErreurGoogle(`Google injoignable : ${(error as Error).message}`, 0, "passager");
      }
    }
    if (reponse) {
      if (reponse.ok || (reponse.status >= 300 && reponse.status < 400)) return reponse;
      const { message, raison } = await lireErreur(reponse.clone());
      const passager =
        reponse.status === 429 ||
        reponse.status >= 500 ||
        (reponse.status === 403 && RAISONS_QUOTA.has(raison));
      if (!passager || essai + 1 >= ESSAIS) {
        const nature: NatureErreur =
          reponse.status === 401 || raison === "invalid_grant" || raison === "unauthorized_client"
            ? "acces"
            : reponse.status === 404
              ? "introuvable"
              : passager
                ? "passager"
                : "autre";
        throw new ErreurGoogle(message, reponse.status, nature);
      }
    }
    const attente = Math.min(ATTENTE_BASE * 2 ** essai + Math.random() * ATTENTE_BASE, ATTENTE_MAX);
    await dormir(attente);
  }
}

/* -------------------------------------------------------------------------- *
 * Jetons
 * -------------------------------------------------------------------------- */

type ReponseJeton = { access_token: string; expires_in: number; refresh_token?: string };

async function demanderJeton(corps: Record<string, string>): Promise<ReponseJeton> {
  const reponse = await appel(points().token, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(corps).toString(),
  });
  return (await reponse.json()) as ReponseJeton;
}

export async function echangerCode(
  config: Configuration,
  code: string,
  retour: string,
  verificateur: string,
): Promise<{ refresh: string; acces: string; expire: number }> {
  const jeton = await demanderJeton({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: retour,
    grant_type: "authorization_code",
    code_verifier: verificateur,
  });
  if (!jeton.refresh_token) {
    // `prompt=consent` le garantit d'ordinaire ; sans lui, aucune passe de nuit
    // ne serait possible, et il vaut mieux le dire tout de suite.
    throw new ErreurGoogle("Google n'a pas rendu de jeton de rafraîchissement.", 400, "autre");
  }
  return { refresh: jeton.refresh_token, acces: jeton.access_token, expire: Date.now() + jeton.expires_in * 1000 };
}

/**
 * Le jeton d'accès d'un compte, en mémoire seulement.
 *
 * Il dure une heure ; on le renouvelle une minute avant, pour qu'aucun envoi
 * ne parte avec un jeton qui expire en route.
 */
const jetons = new Map<string, { acces: string; expire: number }>();

export function retenirJeton(userId: string, acces: string, expire: number) {
  jetons.set(userId, { acces, expire });
}

export function oublierJeton(userId: string) {
  jetons.delete(userId);
}

export async function jetonAcces(config: Configuration, userId: string, refresh: string): Promise<string> {
  const connu = jetons.get(userId);
  if (connu && connu.expire - 60_000 > Date.now()) return connu.acces;
  const jeton = await demanderJeton({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: refresh,
    grant_type: "refresh_token",
  });
  retenirJeton(userId, jeton.access_token, Date.now() + jeton.expires_in * 1000);
  return jeton.access_token;
}

/** Révoque le jeton chez Google. Au mieux : délier ne doit pas échouer pour cela. */
export async function revoquer(refresh: string): Promise<void> {
  await appel(points().revoke, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: refresh }).toString(),
  }).catch(() => undefined);
}

/* -------------------------------------------------------------------------- *
 * Drive
 * -------------------------------------------------------------------------- */

const DOSSIER = "application/vnd.google-apps.folder";

/**
 * Les étiquettes posées sur chaque fichier déposé (`appProperties`).
 *
 * Invisibles dans Drive, lisibles par l'app seule. Elles permettent de
 * **retrouver** la sauvegarde si la table de correspondance est perdue — base
 * restaurée depuis le NAS, Drive délié puis relié — au lieu de tout recréer
 * en double à côté.
 */
export type Etiquettes = { fichesCompte: string; fichesCle: string; fichesVersion: string };

export type Depot = {
  name: string;
  parentId: string | null;
  etiquettes: Etiquettes;
};

const entete = (jeton: string, extra: Record<string, string> = {}) => ({
  Authorization: `Bearer ${jeton}`,
  ...extra,
});

export async function adresseDuCompte(jeton: string): Promise<string> {
  const reponse = await appel(`${points().api}/about?fields=user(emailAddress)`, { headers: entete(jeton) });
  const corps = (await reponse.json()) as { user?: { emailAddress?: string } };
  return corps.user?.emailAddress ?? "";
}

export async function creerDossier(jeton: string, depot: Depot): Promise<string> {
  const reponse = await appel(`${points().api}/files?fields=id`, {
    method: "POST",
    headers: entete(jeton, { "Content-Type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({
      name: depot.name,
      mimeType: DOSSIER,
      ...(depot.parentId ? { parents: [depot.parentId] } : {}),
      appProperties: depot.etiquettes,
    }),
  });
  return ((await reponse.json()) as { id: string }).id;
}

/**
 * Crée ou remplace un fichier, en téléversement « resumable ».
 *
 * Deux temps : on ouvre une session (métadonnées), Google rend son adresse
 * dans `Location`, on y envoie les octets. Une session expirée (404 au second
 * temps) se recommence depuis le début — une fois.
 */
export async function envoyerFichier(
  jeton: string,
  depot: Depot & { mime: string; octets: Uint8Array },
  existant?: { driveId: string; ancienParentId: string | null },
): Promise<string> {
  for (let tentative = 0; ; tentative++) {
    const params = new URLSearchParams({ uploadType: "resumable", fields: "id" });
    let url: string;
    let methode: string;
    let metadonnees: Record<string, unknown>;
    if (existant) {
      url = `${points().upload}/files/${encodeURIComponent(existant.driveId)}`;
      methode = "PATCH";
      if (depot.parentId && depot.parentId !== existant.ancienParentId) {
        params.set("addParents", depot.parentId);
        if (existant.ancienParentId) params.set("removeParents", existant.ancienParentId);
      }
      metadonnees = { name: depot.name, appProperties: depot.etiquettes };
    } else {
      url = `${points().upload}/files`;
      methode = "POST";
      metadonnees = {
        name: depot.name,
        mimeType: depot.mime,
        ...(depot.parentId ? { parents: [depot.parentId] } : {}),
        appProperties: depot.etiquettes,
      };
    }
    const session = await appel(`${url}?${params}`, {
      method: methode,
      headers: entete(jeton, {
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": depot.mime,
        "X-Upload-Content-Length": String(depot.octets.byteLength),
      }),
      body: JSON.stringify(metadonnees),
    });
    const adresse = session.headers.get("location");
    if (!adresse) throw new ErreurGoogle("Google n'a pas ouvert de session d'envoi.", session.status, "passager");

    try {
      const envoi = await appel(adresse, {
        method: "PUT",
        headers: { "Content-Type": depot.mime },
        body: Buffer.from(depot.octets),
      });
      return ((await envoi.json()) as { id: string }).id;
    } catch (error) {
      if (error instanceof ErreurGoogle && error.statut === 404 && tentative === 0) continue;
      throw error;
    }
  }
}

/** Renomme ou déplace, sans toucher au contenu. */
export async function modifier(
  jeton: string,
  driveId: string,
  depot: Depot,
  ancienParentId: string | null,
): Promise<void> {
  const params = new URLSearchParams({ fields: "id" });
  if (depot.parentId && depot.parentId !== ancienParentId) {
    params.set("addParents", depot.parentId);
    if (ancienParentId) params.set("removeParents", ancienParentId);
  }
  await appel(`${points().api}/files/${encodeURIComponent(driveId)}?${params}`, {
    method: "PATCH",
    headers: entete(jeton, { "Content-Type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({ name: depot.name, appProperties: depot.etiquettes }),
  });
}

/** À la corbeille, d'où la personne peut encore le reprendre pendant trente jours. */
export async function jeter(jeton: string, driveId: string): Promise<void> {
  await appel(`${points().api}/files/${encodeURIComponent(driveId)}?fields=id`, {
    method: "PATCH",
    headers: entete(jeton, { "Content-Type": "application/json; charset=UTF-8" }),
    body: JSON.stringify({ trashed: true }),
  });
}

/** Le fichier existe-t-il encore, hors de la corbeille ? */
export async function existe(jeton: string, driveId: string): Promise<boolean> {
  try {
    const reponse = await appel(`${points().api}/files/${encodeURIComponent(driveId)}?fields=id,trashed`, {
      headers: entete(jeton),
    });
    return !((await reponse.json()) as { trashed?: boolean }).trashed;
  } catch (error) {
    if (error instanceof ErreurGoogle && error.nature === "introuvable") return false;
    throw error;
  }
}

export type Retrouve = { driveId: string; name: string; parentId: string | null; etiquettes: Partial<Etiquettes> };

/** Tout ce que l'app a déposé pour ce compte, hors corbeille. */
export async function retrouver(jeton: string, userId: string): Promise<Retrouve[]> {
  const trouves: Retrouve[] = [];
  let page: string | undefined;
  const q = `appProperties has { key='fichesCompte' and value='${userId.replace(/'/g, "")}' } and trashed = false`;
  do {
    const params = new URLSearchParams({
      q,
      pageSize: "1000",
      fields: "nextPageToken,files(id,name,parents,appProperties)",
      spaces: "drive",
      ...(page ? { pageToken: page } : {}),
    });
    const reponse = await appel(`${points().api}/files?${params}`, { headers: entete(jeton) });
    const corps = (await reponse.json()) as {
      nextPageToken?: string;
      files?: { id: string; name: string; parents?: string[]; appProperties?: Partial<Etiquettes> }[];
    };
    for (const f of corps.files ?? []) {
      trouves.push({ driveId: f.id, name: f.name, parentId: f.parents?.[0] ?? null, etiquettes: f.appProperties ?? {} });
    }
    page = corps.nextPageToken;
  } while (page);
  return trouves;
}
