/*
 * Un faux Google, juste assez vrai pour éprouver la sauvegarde Drive sans
 * compte réel : OAuth (autorisation, échange de code, rafraîchissement,
 * révocation) et le sous-ensemble de l'API Drive v3 dont l'app se sert.
 *
 * Il est **strict là où Google l'est**, parce que c'est là que se cachent les
 * défauts qu'aucun essai ne verrait autrement :
 *
 * - l'adresse de retour doit être identique à l'échange et à l'autorisation ;
 * - le vérificateur PKCE doit redonner le défi (S256) ;
 * - un code ne sert qu'une fois ;
 * - un jeton révoqué rend `invalid_grant`, et un jeton d'accès qui en dépend
 *   rend 401 ;
 * - un fichier dans un dossier mis à la corbeille est lui-même à la corbeille.
 *
 * Il sait aussi tomber en panne sur commande (`panne`), pour éprouver la
 * reprise exponentielle.
 */
import http from "node:http";
import { createHash, randomUUID } from "node:crypto";

export function demarrerFauxGoogle(port, { clientId, clientSecret, courriel }) {
  const codes = new Map(); // code → { defi, retour, utilise }
  const rafraichissements = new Set(); // valides
  const acces = new Map(); // jeton d'accès → jeton de rafraîchissement
  const fichiers = new Map(); // id → fichier
  const sessions = new Map(); // id de session → { id?, meta }
  const journal = { autorisations: [], echanges: [], revocations: [], envois: 0, appels: 0 };
  let pannes = { reste: 0, statut: 503 };

  const lire = (req) =>
    new Promise((ok) => {
      const morceaux = [];
      req.on("data", (m) => morceaux.push(m));
      req.on("end", () => ok(Buffer.concat(morceaux)));
    });
  const json = (res, statut, corps, entetes = {}) => {
    res.writeHead(statut, { "Content-Type": "application/json", ...entetes });
    res.end(JSON.stringify(corps));
  };
  const erreurApi = (res, statut, raison, message) =>
    json(res, statut, { error: { code: statut, message, errors: [{ reason: raison, message }] } });

  const aLaCorbeille = (f) => {
    for (let cur = f, d = 0; cur && d < 64; d++) {
      if (cur.trashed) return true;
      cur = cur.parents[0] ? fichiers.get(cur.parents[0]) : null;
    }
    return false;
  };

  const serveur = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://localhost:${port}`);
    const corps = await lire(req);

    // --- OAuth -------------------------------------------------------------
    if (url.pathname === "/o/oauth2/v2/auth") {
      const p = Object.fromEntries(url.searchParams);
      journal.autorisations.push(p);
      const retour = new URL(p.redirect_uri);
      if (p.client_id !== clientId || p.code_challenge_method !== "S256" || !p.code_challenge) {
        retour.searchParams.set("error", "invalid_request");
      } else {
        const code = randomUUID();
        codes.set(code, { defi: p.code_challenge, retour: p.redirect_uri, utilise: false });
        retour.searchParams.set("code", code);
      }
      retour.searchParams.set("state", p.state ?? "");
      res.writeHead(302, { Location: retour.toString() });
      return res.end();
    }
    if (url.pathname === "/token" && req.method === "POST") {
      const p = Object.fromEntries(new URLSearchParams(corps.toString()));
      if (p.client_id !== clientId || p.client_secret !== clientSecret) {
        return json(res, 401, { error: "invalid_client" });
      }
      if (p.grant_type === "authorization_code") {
        const c = codes.get(p.code);
        const defi = createHash("sha256").update(p.code_verifier ?? "").digest("base64url");
        journal.echanges.push({ retourIdentique: c?.retour === p.redirect_uri, pkce: c?.defi === defi });
        if (!c || c.utilise || c.retour !== p.redirect_uri || c.defi !== defi) {
          return json(res, 400, { error: "invalid_grant", error_description: "Bad Request" });
        }
        c.utilise = true;
        const refresh = `1//${randomUUID()}`;
        const jeton = `ya29.${randomUUID()}`;
        rafraichissements.add(refresh);
        acces.set(jeton, refresh);
        return json(res, 200, { access_token: jeton, expires_in: 3599, refresh_token: refresh, scope: "drive.file" });
      }
      if (p.grant_type === "refresh_token") {
        if (!rafraichissements.has(p.refresh_token)) {
          return json(res, 400, { error: "invalid_grant", error_description: "Token has been expired or revoked." });
        }
        const jeton = `ya29.${randomUUID()}`;
        acces.set(jeton, p.refresh_token);
        return json(res, 200, { access_token: jeton, expires_in: 3599 });
      }
      return json(res, 400, { error: "unsupported_grant_type" });
    }
    if (url.pathname === "/revoke" && req.method === "POST") {
      const jeton = new URLSearchParams(corps.toString()).get("token");
      journal.revocations.push(jeton);
      rafraichissements.delete(jeton);
      return json(res, 200, {});
    }

    // --- Drive -------------------------------------------------------------
    const drive = url.pathname.startsWith("/drive/v3") || url.pathname.startsWith("/upload/");
    if (!drive) return json(res, 404, { error: "introuvable" });
    journal.appels++;
    if (pannes.reste > 0) {
      pannes.reste--;
      return erreurApi(res, pannes.statut, "backendError", "Backend Error");
    }
    // Les sessions d'envoi portent leur propre droit, comme chez Google.
    if (!url.pathname.startsWith("/upload/session/")) {
      const jeton = (req.headers.authorization ?? "").replace(/^Bearer /, "");
      const refresh = acces.get(jeton);
      if (!refresh || !rafraichissements.has(refresh)) {
        return erreurApi(res, 401, "authError", "Invalid Credentials");
      }
    }

    const sortie = (f) => ({ id: f.id, name: f.name, parents: f.parents, appProperties: f.appProperties, trashed: aLaCorbeille(f) });
    const appliquerParents = (f) => {
      const ajout = url.searchParams.get("addParents");
      const retrait = url.searchParams.get("removeParents");
      if (retrait) f.parents = f.parents.filter((p) => p !== retrait);
      if (ajout && !f.parents.includes(ajout)) f.parents = [ajout];
    };
    const meta = corps.length > 0 && (req.headers["content-type"] ?? "").includes("json") ? JSON.parse(corps.toString()) : {};

    if (url.pathname === "/drive/v3/about") return json(res, 200, { user: { emailAddress: courriel } });

    if (url.pathname === "/drive/v3/files" && req.method === "GET") {
      const compte = /value='([^']+)'/.exec(url.searchParams.get("q") ?? "")?.[1];
      const trouves = [...fichiers.values()].filter(
        (f) => f.appProperties?.fichesCompte === compte && !aLaCorbeille(f),
      );
      return json(res, 200, { files: trouves.map(sortie) });
    }
    if (url.pathname === "/drive/v3/files" && req.method === "POST") {
      for (const p of meta.parents ?? []) if (!fichiers.has(p)) return erreurApi(res, 404, "notFound", `File not found: ${p}.`);
      const f = {
        id: randomUUID(),
        name: meta.name,
        mimeType: meta.mimeType,
        parents: meta.parents ?? [],
        appProperties: meta.appProperties ?? {},
        trashed: false,
        contenu: null,
        versions: 0,
      };
      fichiers.set(f.id, f);
      return json(res, 200, { id: f.id });
    }
    const unFichier = /^\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (unFichier) {
      const f = fichiers.get(decodeURIComponent(unFichier[1]));
      if (!f) return erreurApi(res, 404, "notFound", "File not found.");
      if (req.method === "GET") return json(res, 200, sortie(f));
      if (req.method === "PATCH") {
        if (typeof meta.name === "string") f.name = meta.name;
        if (meta.appProperties) f.appProperties = { ...f.appProperties, ...meta.appProperties };
        if (meta.trashed === true) f.trashed = true;
        appliquerParents(f);
        return json(res, 200, { id: f.id });
      }
    }

    // Téléversement « resumable » : ouverture de session, puis PUT des octets.
    if (url.pathname === "/upload/drive/v3/files" && req.method === "POST" && url.searchParams.get("uploadType") === "resumable") {
      for (const p of meta.parents ?? []) if (!fichiers.has(p)) return erreurApi(res, 404, "notFound", `File not found: ${p}.`);
      const sid = randomUUID();
      sessions.set(sid, { meta, type: req.headers["x-upload-content-type"] });
      res.writeHead(200, { Location: `http://localhost:${port}/upload/session/${sid}` });
      return res.end();
    }
    const majContenu = /^\/upload\/drive\/v3\/files\/([^/]+)$/.exec(url.pathname);
    if (majContenu && req.method === "PATCH") {
      const f = fichiers.get(decodeURIComponent(majContenu[1]));
      if (!f) return erreurApi(res, 404, "notFound", "File not found.");
      const sid = randomUUID();
      sessions.set(sid, { id: f.id, meta, ajout: url.searchParams.get("addParents"), retrait: url.searchParams.get("removeParents") });
      res.writeHead(200, { Location: `http://localhost:${port}/upload/session/${sid}` });
      return res.end();
    }
    const session = /^\/upload\/session\/([^/]+)$/.exec(url.pathname);
    if (session && req.method === "PUT") {
      const s = sessions.get(session[1]);
      if (!s) return erreurApi(res, 404, "notFound", "Upload session expired.");
      sessions.delete(session[1]);
      journal.envois++;
      let f;
      if (s.id) {
        f = fichiers.get(s.id);
        if (typeof s.meta.name === "string") f.name = s.meta.name;
        if (s.meta.appProperties) f.appProperties = { ...f.appProperties, ...s.meta.appProperties };
        if (s.retrait) f.parents = f.parents.filter((p) => p !== s.retrait);
        if (s.ajout && !f.parents.includes(s.ajout)) f.parents = [s.ajout];
      } else {
        f = {
          id: randomUUID(),
          name: s.meta.name,
          mimeType: s.meta.mimeType ?? s.type,
          parents: s.meta.parents ?? [],
          appProperties: s.meta.appProperties ?? {},
          trashed: false,
          contenu: null,
          versions: 0,
        };
        fichiers.set(f.id, f);
      }
      f.contenu = corps;
      f.versions++;
      return json(res, 200, { id: f.id });
    }
    return erreurApi(res, 400, "badRequest", `${req.method} ${url.pathname} non pris en charge`);
  });

  return new Promise((ok) =>
    serveur.listen(port, () =>
      ok({
        journal,
        fichiers,
        aLaCorbeille,
        /** Les `n` prochains appels Drive échouent avec `statut`. */
        panne(n, statut = 503) {
          pannes = { reste: n, statut };
        },
        /** La personne retire l'accès depuis son compte Google. */
        revoquerTout() {
          rafraichissements.clear();
        },
        /** Le chemin d'un fichier, depuis la racine du Drive. */
        chemin(f) {
          const parts = [];
          for (let cur = f, d = 0; cur && d < 64; d++) {
            parts.unshift(cur.name);
            cur = cur.parents[0] ? fichiers.get(cur.parents[0]) : null;
          }
          return parts.join("/");
        },
        fermer: () => new Promise((fin) => serveur.close(fin)),
      }),
    ),
  );
}
