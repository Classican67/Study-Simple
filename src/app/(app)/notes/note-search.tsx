"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { PenLine, Search, Table2, Type, X } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Recherche dans les notes.
 *
 * Les critères vivent dans l'adresse : une recherche se partage, se met en
 * favori et survit à un rechargement. La frappe est reportée avant d'être
 * poussée dans l'URL, sinon chaque lettre provoquerait une navigation.
 *
 * Chercher porte sur **toute** l'arborescence, pas sur le dossier ouvert : ne
 * pas trouver un mot parce qu'il est rangé un dossier plus bas serait la pire
 * des réponses.
 */
const DEBOUNCE_MS = 250;

const TYPES = [
  { value: "text", label: "Texte", icon: Type },
  { value: "table", label: "Tableau", icon: Table2 },
  { value: "drawing", label: "Manuscrit", icon: PenLine },
] as const;

export function NoteSearch({
  query,
  has,
  folderId,
}: {
  query: string;
  has: string | null;
  folderId: string | null;
}) {
  const router = useRouter();
  const [text, setText] = React.useState(query);

  const push = React.useCallback(
    (q: string, type: string | null) => {
      const url = new URLSearchParams();
      // Le dossier n'est conservé que hors recherche : une recherche porte sur
      // tout, et garder le dossier dans l'adresse laisserait croire l'inverse.
      if (folderId && !q.trim() && !type) url.set("folder", folderId);
      if (q.trim()) url.set("q", q.trim());
      if (type) url.set("has", type);
      const qs = url.toString();
      router.replace(qs ? `/notes?${qs}` : "/notes", { scroll: false });
    },
    [folderId, router],
  );

  // La valeur tapée est poussée dans l'adresse après un silence.
  React.useEffect(() => {
    if (text === query) return;
    const timer = window.setTimeout(() => push(text, has), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [text, query, has, push]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-on-surface-variant" />
        <input
          value={text}
          onChange={(event) => setText(event.target.value)}
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          aria-label="Rechercher dans les notes"
          placeholder="Titre, paragraphe, cellule de tableau…"
          className="h-14 w-full rounded-full bg-surface-container pl-12 pr-12 m3-body-large text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {text ? (
          <button
            type="button"
            onClick={() => {
              setText("");
              push("", has);
            }}
            aria-label="Effacer la recherche"
            className="state-layer absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-on-surface-variant"
          >
            <X className="size-5" />
          </button>
        ) : null}
      </div>

      <div role="group" aria-label="Filtrer par contenu" className="flex flex-wrap items-center gap-2">
        {TYPES.map(({ value, label, icon: Icon }) => {
          const active = has === value;
          return (
            <button
              key={value}
              type="button"
              aria-pressed={active}
              onClick={() => push(text, active ? null : value)}
              className={cn(
                "state-layer flex min-h-11 items-center gap-2 rounded-full border px-4 m3-label-large transition-colors",
                active
                  ? "border-primary bg-primary-container text-on-primary-container"
                  : "border-outline-variant text-on-surface-variant hover:text-on-surface",
              )}
            >
              <Icon className="size-4" />
              {label}
            </button>
          );
        })}
        {has || query ? (
          <button
            type="button"
            onClick={() => {
              setText("");
              push("", null);
            }}
            className="min-h-11 rounded-full px-3 m3-label-large text-primary"
          >
            Tout afficher
          </button>
        ) : null}
      </div>
    </div>
  );
}
