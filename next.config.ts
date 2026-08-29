import type { NextConfig } from "next";

// Le serveur de développement de Next 16 refuse par défaut (403) les requêtes
// vers ses assets et ses points d'entrée internes quand elles viennent d'une
// origine autre que celle de démarrage — `localhost`. Ouvrir le dev depuis
// l'IP du LAN ou via Tailscale déclenche donc des 403 sur /_next/static/... et
// l'échec du WebSocket de rechargement à chaud.
//
// Cette protection ne concerne QUE `next dev` : elle n'a aucun effet en
// production, où c'est le reverse proxy qui décide de ce qui entre.
//
// Les origines supplémentaires se déclarent dans .env (non versionné), pour
// que l'IP privée de la machine ne parte pas dans le dépôt :
//   ALLOWED_DEV_ORIGINS="192.168.50.77,mon-portable.mon-tailnet.ts.net"
const extraDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  allowedDevOrigins: [
    // Noms MagicDNS de Tailscale : tous les tailnets servent sous .ts.net.
    "**.ts.net",
    // Toute machine du réseau local, quelle que soit son adresse en 192.168.x.y
    // (le bail DHCP peut changer d'un redémarrage à l'autre).
    "192.168.*.*",
    ...extraDevOrigins,
  ],

  // `output: "standalone"` allégerait beaucoup l'image Docker, mais le traçage
  // des fichiers rate régulièrement le moteur natif de Prisma, ce qui casse le
  // démarrage d'une manière pénible à diagnostiquer sur un serveur distant.
  // L'image embarque donc node_modules en entier : plus lourde, mais fiable.

  // Le contenu est privé : rien à faire indexer, et aucun besoin de deviner
  // de quel serveur il sort.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          // L'app n'a aucune raison d'être encadrée : coupe le clickjacking.
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          // `camera=(self)` : l'app photographie les fiches depuis l'appareil
          // de l'iPad ou du téléphone. Une valeur vide — `camera=()` —
          // interdirait l'appareil photo à sa propre origine et casserait la
          // fonction. Micro et géolocalisation, eux, ne servent nulle part.
          {
            key: "Permissions-Policy",
            value: "camera=(self), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // Sans ça, un navigateur peut garder des semaines un worker périmé et
        // continuer à servir l'ancienne version de l'app après un déploiement.
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
