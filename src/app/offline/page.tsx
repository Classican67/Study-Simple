import type { Metadata } from "next";
import { Suspense } from "react";
import { WifiOff } from "lucide-react";

import { Coquille } from "./coquille";

export const metadata: Metadata = { title: "Hors ligne" };

/**
 * La page hors ligne — « la coquille ».
 *
 * Le service worker la sert à la place de toute navigation qui ne trouve pas
 * le serveur, avec l'adresse demandée en paramètre. Elle ne contient **aucune
 * donnée** : c'est une page statique, identique pour tout le monde, qui lit
 * ensuite ce que l'appareil garde dans IndexedDB. C'est ce qui permet au worker
 * de la mettre en cache sans risquer de servir le contenu d'un compte.
 *
 * Tant que ses scripts ne sont pas chargés, elle montre le repli ci-dessous —
 * et s'ils manquent pour de bon (page jamais préparée avec le réseau), le repli
 * finit par le dire, sans JavaScript.
 */
export default function OfflinePage() {
  return (
    <Suspense fallback={<Repli />}>
      <Coquille />
    </Suspense>
  );
}

function Repli() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-surface-container-high text-on-surface-variant">
          <WifiOff className="size-6" />
        </div>
        <h1 className="m3-title-large">Pas de connexion</h1>
        {/* Visible après deux secondes seulement, par CSS : si les scripts de la
            page arrivent, elle aura été remplacée bien avant. */}
        <p className="coquille-repli mt-2 max-w-xs m3-body-medium text-on-surface-variant">
          Fiches a besoin du serveur pour charger cette page. Réessaie dès que le réseau revient.
        </p>
      </div>
    </main>
  );
}
