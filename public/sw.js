/* Service worker de l'app Fiches.
 *
 * Prudent par principe : on ne met JAMAIS en cache une page HTML ou une réponse
 * d'API qui porte des données du compte. Les cartes gardées hors ligne vivent
 * dans IndexedDB, écrites par l'app elle-même (`lib/hors-ligne/`), et c'est la
 * page hors ligne — une page sans aucune donnée — qui les lit.
 *
 * Trois caches :
 *
 * - `fiches-v1`        — fichiers immuables des builds (`/_next/static/`) ;
 * - `fiches-coquille`  — la page hors ligne et tout ce qu'elle charge, tenue à
 *                        jour par l'app, qui seule connaît les noms des scripts
 *                        du build courant ;
 * - `fiches-fichiers`  — les images, photos et documents des paquets et des
 *                        notes gardés hors ligne.
 *
 * Les deux derniers noms sont aussi déclarés dans `lib/hors-ligne/modele.ts` ;
 * `tests/hors-ligne.test.ts` vérifie qu'ils ne se séparent pas.
 */

const VERSION = "fiches-v1";
const CACHE_COQUILLE = "fiches-coquille";
const CACHE_FICHIERS = "fiches-fichiers";
const ADRESSE_COQUILLE = "/offline";

/**
 * Au-delà, une navigation « en ligne » qui ne répond pas est traitée comme une
 * panne. Un Wi-Fi de train annonce une connexion et n'achemine rien : sans
 * délai, on attendrait la page indéfiniment devant un écran blanc.
 */
const DELAI_NAVIGATION = 12000;

const PRECACHE = [
  ADRESSE_COQUILLE,
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(VERSION)
      // `addAll` échoue en bloc si une seule URL manque : on tolère les absences
      // pour ne pas laisser un worker coincé à l'installation.
      .then((cache) => Promise.allSettled(PRECACHE.map((url) => cache.add(url))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            // Seules les anciennes versions du cache des builds partent. Les
            // images gardées hors ligne et la coquille survivent à une mise à
            // jour du worker : les effacer ici viderait l'iPad à chaque
            // déploiement, sans que personne n'ait rien demandé.
            .filter((key) => key.startsWith("fiches-v") && key !== VERSION)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function avecDelai(promesse, ms) {
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new Error("délai dépassé")), ms);
    promesse.then(
      (valeur) => {
        clearTimeout(minuteur);
        resolve(valeur);
      },
      (erreur) => {
        clearTimeout(minuteur);
        reject(erreur);
      },
    );
  });
}

/**
 * Répond à une requête par plage depuis un fichier entier en cache.
 *
 * pdf.js ne lit pas un document d'un bloc : il demande la table des objets,
 * puis les octets des pages qu'il affiche (`Range: bytes=…`), et attend un
 * 206. Lui rendre le fichier entier en 200 l'oblige à tout relire — et
 * certaines versions refusent purement la réponse. Le serveur fait déjà ce
 * travail (`/api/uploads/[file]`) ; hors ligne, c'est au worker de le refaire.
 */
async function servirPlage(request, cached) {
  const plage = request.headers.get("range");
  if (!plage) return cached;
  const m = /^bytes=(\d*)-(\d*)$/.exec(plage.trim());
  const corps = await cached.blob();
  const taille = corps.size;
  let debut = m && m[1] !== "" ? Number(m[1]) : NaN;
  let fin = m && m[2] !== "" ? Number(m[2]) : taille - 1;
  // `bytes=-500` : les 500 derniers octets.
  if (m && m[1] === "" && m[2] !== "") {
    debut = Math.max(0, taille - Number(m[2]));
    fin = taille - 1;
  }
  if (!m || Number.isNaN(debut) || debut >= taille || debut > fin) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${taille}` } });
  }
  fin = Math.min(fin, taille - 1);
  return new Response(corps.slice(debut, fin + 1), {
    status: 206,
    headers: {
      "Content-Type": cached.headers.get("Content-Type") || "application/octet-stream",
      "Content-Length": String(fin - debut + 1),
      "Content-Range": `bytes ${debut}-${fin}/${taille}`,
      "Accept-Ranges": "bytes",
    },
  });
}

async function coquilleEnCache() {
  const coquille = await caches.open(CACHE_COQUILLE);
  return (
    (await coquille.match(ADRESSE_COQUILLE, { ignoreSearch: true })) ??
    (await caches.match(ADRESSE_COQUILLE, { ignoreSearch: true }))
  );
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // Les assets buildés portent un hachage dans leur nom : leur contenu ne
  // change jamais, on peut donc les servir depuis le cache sans revalider.
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icons/")) {
    event.respondWith(
      caches.match(request).then(
        (cached) =>
          cached ??
          fetch(request).then((response) => {
            if (response.ok) {
              const copy = response.clone();
              caches.open(VERSION).then((cache) => cache.put(request, copy));
            }
            return response;
          }),
      ),
    );
    return;
  }

  // Fichiers des paquets et des notes gardés : images, photos, polycopiés.
  // Leur nom est un UUID fixé à l'envoi — le contenu d'un nom ne change
  // jamais, le cache peut donc répondre même en ligne.
  if (url.pathname.startsWith("/api/uploads/")) {
    event.respondWith(
      caches
        .open(CACHE_FICHIERS)
        .then((cache) => cache.match(url.pathname))
        .then((cached) => (cached ? servirPlage(request, cached) : fetch(request))),
    );
    return;
  }

  // Le worker de pdf.js : son nom ne change pas d'une version à l'autre, il ne
  // peut donc pas être servi du cache en priorité. Le réseau d'abord, le cache
  // de la coquille quand le serveur ne répond pas.
  if (url.pathname === "/pdf.worker.min.mjs") {
    event.respondWith(
      fetch(request).catch(async () => (await caches.match(url.pathname)) ?? Response.error()),
    );
    return;
  }

  // Navigation : toujours le réseau d'abord. S'il ne répond pas, la page
  // hors ligne prend le relais, en gardant l'adresse demandée pour montrer
  // ce qui, de cette page, est gardé sur l'appareil.
  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          if (self.navigator && self.navigator.onLine === false) throw new Error("hors ligne");
          return await avecDelai(fetch(request), DELAI_NAVIGATION);
        } catch {
          const coquille = await coquilleEnCache();
          if (!coquille) return Response.error();
          if (url.pathname === ADRESSE_COQUILLE) return coquille;
          const de = encodeURIComponent(url.pathname + url.search);
          return Response.redirect(`${ADRESSE_COQUILLE}?de=${de}`, 302);
        }
      })(),
    );
  }
});
