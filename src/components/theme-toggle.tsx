"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";

type Theme = "light" | "dark" | "system";

const ORDER: Theme[] = ["system", "light", "dark"];
const LABELS: Record<Theme, string> = {
  system: "Thème : système",
  light: "Thème : clair",
  dark: "Thème : sombre",
};

// Doit rester identique à la clé lue par le script anti-flash du layout racine.
const STORAGE_KEY = "fiches-theme";

function applyTheme(theme: Theme) {
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle(
    "dark",
    theme === "dark" || (theme === "system" && prefersDark),
  );
}

// localStorage est un système extérieur à React : on le lit via
// useSyncExternalStore plutôt qu'en posant un état depuis un effet, ce qui
// évite le rendu en cascade et gère l'hydratation correctement.
const listeners = new Set<() => void>();

const themeStore = {
  subscribe(callback: () => void) {
    listeners.add(callback);
    // `storage` couvre les autres onglets ; `listeners` couvre celui-ci.
    window.addEventListener("storage", callback);
    return () => {
      listeners.delete(callback);
      window.removeEventListener("storage", callback);
    };
  },
  getSnapshot(): Theme {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored === "light" || stored === "dark" || stored === "system" ? stored : "system";
    } catch {
      // Navigation privée ou stockage bloqué : on retombe sur le système.
      return "system";
    }
  },
  // Le serveur ne connaît aucune préférence ; React réconcilie après hydratation.
  getServerSnapshot(): Theme {
    return "system";
  },
  set(theme: Theme) {
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // Le thème s'applique quand même, il ne survivra juste pas au rechargement.
    }
    applyTheme(theme);
    listeners.forEach((listener) => listener());
  },
};

export function ThemeToggle() {
  const theme = React.useSyncExternalStore(
    themeStore.subscribe,
    themeStore.getSnapshot,
    themeStore.getServerSnapshot,
  );

  // En mode « système », suivre l'OS s'il bascule pendant que l'app est ouverte.
  React.useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const Icon = theme === "dark" ? Moon : theme === "light" ? Sun : Monitor;

  return (
    <Button
      variant="toolbar-icon"
      size="icon"
      title={LABELS[theme]}
      aria-label={LABELS[theme]}
      onClick={() => themeStore.set(ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length])}
    >
      <Icon />
    </Button>
  );
}
