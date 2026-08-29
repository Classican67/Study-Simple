/* Service worker de l'app Fiches.
 *
 * Volontairement minimal et prudent : l'app est multi-comptes, donc on ne met
 * JAMAIS en cache une page HTML ou une réponse d'API — un cache partagé par
 * navigateur pourrait resservir le contenu d'un compte à un autre. Seuls les
 * fichiers immuables et publics sont cachés.
 */

const VERSION = "fiches-v1";
const PRECACHE = [
  "/offline",
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
      .then((keys) => Promise.all(keys.filter((key) => key !== VERSION).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

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

  // Navigation : toujours le réseau d'abord. Hors ligne, on affiche la page
  // dédiée plutôt que l'erreur du navigateur.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() => caches.match("/offline").then((r) => r ?? Response.error())),
    );
  }
});
