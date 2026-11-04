"use client";

import * as React from "react";

/**
 * Le verrou du stylet : le doigt n'écrit pas, il fait défiler.
 *
 * Il est **posé d'office**. On écrit au stylet, et la main se pose sur l'écran
 * avant que la pointe ne le touche : tant que le verrou attendait qu'on pense
 * à le poser — ou qu'un premier trait au stylet le devine —, cette main-là
 * marquait la page. Une souris écrit toujours : le verrou ne regarde que le
 * doigt. Et qui écrit au doigt le lève d'un toucher, l'appareil s'en souvient.
 *
 * Même mécanique que la place de la barre (`usePositionBarre`) : une
 * commodité de l'appareil, gardée hors de React, partagée par toutes les pages
 * manuscrites, et absente du rendu serveur.
 */
export const STYLET_CLE = "fiches:stylet-seul";

function lire(): boolean {
  try {
    return window.localStorage.getItem(STYLET_CLE) !== "non";
  } catch {
    return true;
  }
}

const abonnes = new Set<() => void>();
let cache: boolean | null = null;

function sAbonner(prevenir: () => void) {
  abonnes.add(prevenir);
  return () => {
    abonnes.delete(prevenir);
  };
}

function instantane(): boolean {
  cache ??= lire();
  return cache;
}

function instantaneServeur(): boolean {
  return true;
}

export function useStyletSeul(): [boolean, (next: boolean) => void] {
  const actif = React.useSyncExternalStore(sAbonner, instantane, instantaneServeur);
  const poser = React.useCallback((next: boolean) => {
    cache = next;
    try {
      window.localStorage.setItem(STYLET_CLE, next ? "oui" : "non");
    } catch {
      // Stockage refusé : le verrou obéit quand même, il ne s'en souvient pas.
    }
    for (const prevenir of [...abonnes]) prevenir();
  }, []);
  return [actif, poser];
}
