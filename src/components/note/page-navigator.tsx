"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Layers } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Navigation entre les pages manuscrites d'une note.
 *
 * Un polycopié de quarante pages devient quarante blocs empilés : sans ce
 * repère, retrouver la page 27 demande de faire défiler à l'aveugle. On affiche
 * donc où l'on est, et l'on saute d'une page à l'autre.
 *
 * Les pages sont repérées par l'ancre que porte déjà chaque bloc ; naviguer
 * n'est qu'un défilement vers elle, sans rien changer au document.
 */
export function PageNavigator({
  pages,
  className,
}: {
  /** Identifiants des blocs manuscrits, dans l'ordre. */
  pages: string[];
  className?: string;
}) {
  const [active, setActive] = React.useState(0);
  const [open, setOpen] = React.useState(false);

  /*
   * La page courante est celle qui occupe le milieu de l'écran.
   *
   * On l'observe plutôt que de la calculer au défilement : un `IntersectionObserver`
   * ne coûte rien, là où un gestionnaire de défilement mesure à chaque image.
   */
  React.useEffect(() => {
    if (pages.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (!visible) return;
        const index = pages.indexOf(visible.target.id.replace("bloc-", ""));
        if (index >= 0) setActive(index);
      },
      { rootMargin: "-45% 0px -45% 0px", threshold: 0 },
    );
    for (const id of pages) {
      const el = document.getElementById(`bloc-${id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [pages]);

  if (pages.length < 2) return null;

  const aller = (index: number) => {
    const cible = Math.max(0, Math.min(pages.length - 1, index));
    document.getElementById(`bloc-${pages[cible]}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
    setActive(cible);
    setOpen(false);
  };

  return (
    <div className={cn("relative flex items-center gap-0.5", className)}>
      <button
        type="button"
        onClick={() => aller(active - 1)}
        disabled={active === 0}
        aria-label="Page manuscrite précédente"
        className="grid size-11 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
      >
        <ChevronLeft className="size-5" />
      </button>

      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`Page ${active + 1} sur ${pages.length}. Choisir une page`}
        className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface-container px-3 m3-label-medium tabular-nums text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <Layers className="size-4" />
        {active + 1} / {pages.length}
      </button>

      <button
        type="button"
        onClick={() => aller(active + 1)}
        disabled={active === pages.length - 1}
        aria-label="Page manuscrite suivante"
        className="grid size-11 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
      >
        <ChevronRight className="size-5" />
      </button>

      {open ? (
        <>
          {/* Un voile invisible ferme la liste au premier clic à côté : sans
              lui, elle resterait ouverte derrière le doigt. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <ul
            aria-label="Pages manuscrites"
            className="scroll-slim absolute bottom-full right-0 z-50 mb-2 grid max-h-72 w-56 grid-cols-4 gap-1 overflow-y-auto rounded-2xl border border-outline-variant bg-surface-container p-2 elevation-3"
          >
            {pages.map((id, index) => (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => aller(index)}
                  aria-current={index === active ? "true" : undefined}
                  className={cn(
                    "grid h-11 w-full place-items-center rounded-xl tabular-nums m3-label-medium transition-colors",
                    index === active
                      ? "bg-primary text-on-primary"
                      : "bg-surface-lowest text-on-surface-variant hover:text-on-surface",
                  )}
                >
                  {index + 1}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
