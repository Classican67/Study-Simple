import type { Metadata } from "next";
import { WifiOff } from "lucide-react";

export const metadata: Metadata = { title: "Hors ligne" };

// Servie par le service worker quand une navigation échoue faute de réseau.
// Elle doit rester autonome : aucun appel base, aucune donnée de session.
export default function OfflinePage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 text-center">
      <div>
        <div className="mx-auto mb-5 grid size-14 place-items-center rounded-2xl bg-surface-raised text-fg-muted">
          <WifiOff className="size-6" />
        </div>
        <h1 className="text-xl font-semibold">Pas de connexion</h1>
        <p className="mt-2 max-w-xs text-sm text-fg-muted">
          Fiches a besoin du serveur pour charger tes paquets. Réessaie dès que le réseau revient.
        </p>
      </div>
    </main>
  );
}
