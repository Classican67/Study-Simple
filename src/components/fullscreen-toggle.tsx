"use client";

import * as React from "react";
import { Maximize, Minimize } from "lucide-react";

import { Button } from "@/components/ui/button";

/**
 * Bascule plein écran.
 *
 * L'API plein écran exige un **geste de l'utilisateur** : aucun navigateur ne
 * laisse une page s'y mettre toute seule à l'arrivée sur un écran. D'où un
 * bouton, plutôt qu'un déclenchement automatique qui serait silencieusement
 * refusé. La mise en page, elle, est déjà immersive sans lui : barres masquées,
 * carte au maximum.
 *
 * Le bouton disparaît là où l'API n'existe pas — notamment sur iOS, où Safari
 * ne l'expose pas — plutôt que de proposer une commande sans effet.
 */
// L'état plein écran appartient au document, pas à React : on le lit comme un
// système extérieur plutôt que de le recopier dans un état depuis un effet.
function subscribeFullscreen(callback: () => void) {
  document.addEventListener("fullscreenchange", callback);
  return () => document.removeEventListener("fullscreenchange", callback);
}

export function FullscreenToggle() {
  const active = React.useSyncExternalStore(
    subscribeFullscreen,
    () => document.fullscreenElement !== null,
    () => false,
  );

  const supported = React.useSyncExternalStore(
    // Ne change jamais pendant la vie de la page.
    () => () => {},
    () =>
      document.fullscreenEnabled === true &&
      // En PWA installée, la page occupe déjà tout l'écran : le bouton
      // n'aurait rien à faire.
      !window.matchMedia("(display-mode: standalone)").matches,
    () => false,
  );

  if (!supported) return null;

  async function toggle() {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      // Refus de l'utilisateur ou politique du navigateur : l'écran reste
      // parfaitement utilisable tel quel.
    }
  }

  return (
    <Button
      variant="toolbar-icon"
      size="icon"
      onClick={toggle}
      title={active ? "Quitter le plein écran" : "Plein écran"}
      aria-label={active ? "Quitter le plein écran" : "Plein écran"}
      aria-pressed={active}
    >
      {active ? <Minimize /> : <Maximize />}
    </Button>
  );
}
