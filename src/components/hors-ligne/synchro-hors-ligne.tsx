"use client";

import { useEffect } from "react";

import { synchroniser, synchroniserSiUtile } from "@/lib/hors-ligne/client";
import { lienADetourner } from "@/lib/hors-ligne/destination";

/**
 * Tient l'appareil à jour pendant que l'app est ouverte.
 *
 * Safari n'offre aucune synchronisation en arrière-plan : c'est donc au
 * chargement, au retour du réseau et au retour au premier plan que les
 * réponses partent et que les paquets épinglés se mettent à jour.
 */
export function SynchroHorsLigne() {
  useEffect(() => {
    synchroniserSiUtile();

    const enLigne = () => void synchroniser();
    const visible = () => {
      if (document.visibilityState === "visible") synchroniserSiUtile();
    };
    // Hors ligne franc, un lien interne passe en navigation complète : le
    // service worker la reçoit et sert la page hors ligne, là où la navigation
    // de Next resterait suspendue à un serveur qu'elle ne joindra pas.
    const clic = (evenement: MouseEvent) => {
      if (navigator.onLine) return;
      const lien = (evenement.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      const cible = lienADetourner(evenement, lien, location.origin);
      if (!cible) return;
      evenement.preventDefault();
      location.assign(cible);
    };

    window.addEventListener("online", enLigne);
    document.addEventListener("visibilitychange", visible);
    document.addEventListener("click", clic, true);
    return () => {
      window.removeEventListener("online", enLigne);
      document.removeEventListener("visibilitychange", visible);
      document.removeEventListener("click", clic, true);
    };
  }, []);

  return null;
}
