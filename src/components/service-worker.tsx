"use client";

import { useEffect } from "react";

// Enregistré depuis le layout de l'app, donc uniquement pour un utilisateur
// connecté. Le worker ne cache que des fichiers publics et immuables.
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    // En dev, un worker actif sert du code périmé et masque les modifications.
    if (process.env.NODE_ENV !== "production") return;

    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Sans HTTPS (ou sur localhost), l'enregistrement échoue : l'app reste
      // parfaitement utilisable en ligne, elle n'est simplement pas installable.
    });
  }, []);

  return null;
}
