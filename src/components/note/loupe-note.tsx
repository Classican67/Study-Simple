"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Loader2, Search, X } from "lucide-react";

import type { DrawingContent } from "@/lib/notes";
import {
  placerOccurrences,
  type OccurrencePlacee,
  type PageTrouvee,
  type Surligne,
} from "@/lib/recherche-document";
import { cn } from "@/lib/utils";

/**
 * La loupe : chercher un mot dans les documents d'une note.
 *
 * Elle surligne chaque occurrence et va de l'une à l'autre. Tout passe par le
 * serveur, qui a lu les documents : un PDF scanné n'a pas de texte dans le
 * navigateur.
 *
 * Elle dit aussi ce qu'elle ne sait pas encore. Un polycopié importé à l'instant
 * n'a pas fini d'être lu : « aucun résultat » serait alors un mensonge, et l'on
 * conclurait à tort que la notion n'y est pas.
 */

export type RechercheInitiale = { texte: string; file: string; page: number };

type Etat = { total: number; lus: number; enCours: boolean; echecs: number };

const DELAI_FRAPPE = 220;
const DELAI_LECTURE = 2500;

export function LoupeNote({
  noteId,
  scrollId,
  content,
  initiale,
  className,
  onSurlignes,
  onFermer,
}: {
  noteId: string;
  scrollId: string;
  content: DrawingContent;
  initiale?: RechercheInitiale;
  className?: string;
  onSurlignes: (surlignes: { tous: Surligne[]; actif: Surligne[] }) => void;
  onFermer: () => void;
}) {
  const [texte, setTexte] = React.useState(initiale?.texte ?? "");
  const [pages, setPages] = React.useState<PageTrouvee[]>([]);
  const [etat, setEtat] = React.useState<Etat | null>(null);
  const [cherche, setCherche] = React.useState(false);
  const [panne, setPanne] = React.useState(false);
  const [rang, setRang] = React.useState(0);
  const champ = React.useRef<HTMLInputElement>(null);
  // Seule la première réponse vise la page d'où l'on vient : ensuite, c'est la main.
  const cibleInitiale = React.useRef(initiale ?? null);

  const occurrences = React.useMemo<OccurrencePlacee[]>(
    () => placerOccurrences(content, pages),
    [content, pages],
  );
  const courant = occurrences.length > 0 ? Math.min(rang, occurrences.length - 1) : 0;

  /** Amène une occurrence au tiers de ce qu'on voit. */
  const montrer = React.useCallback(
    (occurrence: OccurrencePlacee) => {
      const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${scrollId}"]`);
      if (!surface) return;
      const largeur = surface.scrollWidth;
      surface.scrollTop = occurrence.rects[0].y * largeur - surface.clientHeight / 3;
      surface.scrollLeft = occurrence.rects[0].x * largeur - surface.clientWidth / 3;
    },
    [scrollId],
  );

  React.useEffect(() => {
    const tous = occurrences.flatMap((o) => o.rects);
    onSurlignes({ tous, actif: occurrences[courant]?.rects ?? [] });
  }, [occurrences, courant, onSurlignes]);

  React.useEffect(() => {
    const requete = texte.trim();
    let annule = false;
    let relance = 0;

    async function interroger() {
      setCherche(true);
      try {
        const reponse = await fetch(
          `/api/notes/${noteId}/recherche?q=${encodeURIComponent(requete)}`,
          { redirect: "manual" },
        );
        if (!reponse.ok) throw new Error(String(reponse.status));
        const donnees = (await reponse.json()) as { etat: Etat; pages: PageTrouvee[] };
        if (annule) return;
        setPanne(false);
        setEtat(donnees.etat);
        setPages(donnees.pages);
        // Le document se lit encore : on relira, les résultats arriveront seuls.
        if (donnees.etat.enCours) relance = window.setTimeout(interroger, DELAI_LECTURE);
      } catch {
        if (!annule) setPanne(true);
      } finally {
        if (!annule) setCherche(false);
      }
    }

    const minuteur = window.setTimeout(interroger, DELAI_FRAPPE);
    return () => {
      annule = true;
      window.clearTimeout(minuteur);
      window.clearTimeout(relance);
    };
  }, [texte, noteId]);

  /*
   * Une seule fois par recherche, on amène le premier résultat sous les yeux.
   *
   * Sans cela, taper un mot allumait « 1/3 » et rien d'autre : l'occurrence était
   * quelque part plus bas. Une fois seulement : la lecture d'un document relance la
   * requête toutes les deux secondes, et l'écran ne doit pas revenir au premier
   * résultat sous la main de qui parcourt déjà les suivants.
   */
  const montree = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (occurrences.length === 0 || montree.current === texte) return;
    montree.current = texte;
    const cible = cibleInitiale.current;
    cibleInitiale.current = null;
    const index = cible
      ? occurrences.findIndex((o) => o.file === cible.file && o.page === cible.page)
      : 0;
    const depart = Math.max(0, index);
    // La réponse du serveur arrive pendant un rendu : le rang suit au suivant.
    queueMicrotask(() => setRang(depart));
    requestAnimationFrame(() => montrer(occurrences[depart]));
  }, [occurrences, montrer, texte]);

  function aller(pas: number) {
    if (occurrences.length === 0) return;
    const suivant = (courant + pas + occurrences.length) % occurrences.length;
    setRang(suivant);
    montrer(occurrences[suivant]);
  }

  const requeteValide = texte.trim().length >= 2;
  const message = panne
    ? "Recherche indisponible sans le serveur."
    : etat?.enCours
      ? `Lecture du document en cours (${etat.lus}/${etat.total})…`
      : etat && etat.echecs > 0 && occurrences.length === 0 && requeteValide
        ? "Un document n'a pas pu être lu."
        : requeteValide && !cherche && etat && occurrences.length === 0
          ? "Aucun résultat dans cette page."
          : null;

  return (
    <div
      role="search"
      aria-label="Chercher dans le document"
      data-testid="loupe"
      className={cn(
        "fixed right-3 z-[60] w-[min(22rem,calc(100vw-1.5rem))] rounded-2xl bg-surface-high p-1 elevation-3",
        className,
      )}
    >
      <div className="flex items-center gap-0.5">
        <span className="grid size-9 shrink-0 place-items-center text-on-surface-variant">
          {cherche ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
        </span>
        <input
          ref={champ}
          autoFocus
          type="search"
          enterKeyHint="search"
          autoComplete="off"
          value={texte}
          onChange={(event) => {
            setTexte(event.target.value);
            setRang(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              aller(event.shiftKey ? -1 : 1);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              onFermer();
            }
          }}
          placeholder="Chercher dans le document"
          aria-label="Mot à chercher"
          className="h-11 min-w-0 flex-1 bg-transparent m3-body-medium text-on-surface outline-none placeholder:text-on-surface-variant [&::-webkit-search-cancel-button]:appearance-none"
        />
        {occurrences.length > 0 ? (
          <span role="status" className="shrink-0 px-1 tabular-nums m3-label-medium text-on-surface-variant">
            {courant + 1}/{occurrences.length}
          </span>
        ) : null}
        <BoutonLoupe label="Occurrence précédente" icon={ChevronUp} disabled={occurrences.length === 0} onClick={() => aller(-1)} />
        <BoutonLoupe label="Occurrence suivante" icon={ChevronDown} disabled={occurrences.length === 0} onClick={() => aller(1)} />
        <BoutonLoupe label="Fermer la recherche" icon={X} onClick={onFermer} />
      </div>
      {message ? (
        <p role="status" className="px-3 pb-2 m3-body-small text-on-surface-variant">
          {message}
        </p>
      ) : null}
    </div>
  );
}

function BoutonLoupe({
  label,
  icon: Icon,
  disabled,
  onClick,
}: {
  label: string;
  icon: React.ElementType;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="state-layer grid size-11 shrink-0 place-items-center rounded-full text-on-surface-variant disabled:opacity-40"
    >
      <Icon className="size-5" />
    </button>
  );
}
