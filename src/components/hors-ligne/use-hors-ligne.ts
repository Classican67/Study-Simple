"use client";

import { useSyncExternalStore } from "react";

import { instantane, instantaneServeur, sAbonner, type EtatHorsLigne } from "@/lib/hors-ligne/client";

/** L'état hors ligne de l'appareil, partagé par tous les composants et onglets. */
export function useHorsLigne(): EtatHorsLigne {
  return useSyncExternalStore(sAbonner, instantane, instantaneServeur);
}

/**
 * La fonction n'a de sens qu'avec un service worker : sans lui, rien ne sert
 * la page hors ligne. C'est le cas en http:// sur le réseau local, où
 * proposer « Garder hors ligne » serait une promesse creuse.
 */
export function useHorsLignePossible(): boolean {
  return useSyncExternalStore(
    rienAObserver,
    () => "serviceWorker" in navigator && "caches" in window,
    () => false,
  );
}

const rienAObserver = () => () => {};
