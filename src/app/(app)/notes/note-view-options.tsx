"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { ArrowDownWideNarrow, Grid2x2, Grid3x3, Rows3 } from "lucide-react";

import type { NoteView } from "@/lib/note-views";
import { cn } from "@/lib/utils";

/**
 * Taille des vignettes et ordre d'affichage.
 *
 * Dans l'adresse, comme la recherche : un affichage choisi survit au
 * rechargement et se retrouve dans l'historique, sans qu'on ait à inventer un
 * stockage pour trois préférences.
 */

const VUES: { value: NoteView; label: string; icon: React.ElementType }[] = [
  { value: "list", label: "Liste", icon: Rows3 },
  { value: "small", label: "Petites vignettes", icon: Grid3x3 },
  { value: "large", label: "Grandes vignettes", icon: Grid2x2 },
];

const TRIS = [
  { value: "updated", label: "Modifiées" },
  { value: "created", label: "Créées" },
  { value: "title", label: "Titre" },
];

export function NoteViewOptions({ view, sort }: { view: NoteView; sort: string }) {
  const router = useRouter();
  const params = useSearchParams();

  const aller = (clef: string, valeur: string) => {
    const url = new URLSearchParams(params.toString());
    // La valeur par défaut ne s'écrit pas dans l'adresse : une URL propre se
    // partage mieux.
    if ((clef === "vue" && valeur === "large") || (clef === "tri" && valeur === "updated")) {
      url.delete(clef);
    } else {
      url.set(clef, valeur);
    }
    const qs = url.toString();
    router.replace(qs ? `/notes?${qs}` : "/notes", { scroll: false });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div
        role="group"
        aria-label="Taille d'affichage"
        className="flex rounded-full bg-surface-container p-1"
      >
        {VUES.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => aller("vue", value)}
            aria-pressed={view === value}
            aria-label={label}
            title={label}
            className={cn(
              "grid size-11 place-items-center rounded-full transition-colors",
              view === value
                ? "bg-primary text-on-primary elevation-1"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>

      <label className="flex min-h-11 items-center gap-2 rounded-full bg-surface-container px-3 m3-label-large text-on-surface-variant">
        <ArrowDownWideNarrow className="size-4 shrink-0" />
        <span className="sr-only">Trier par</span>
        <select
          value={sort}
          onChange={(event) => aller("tri", event.target.value)}
          aria-label="Trier les notes"
          className="bg-transparent pr-1 text-on-surface outline-none"
        >
          {TRIS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
