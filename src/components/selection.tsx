"use client";

import * as React from "react";
import { Check, CheckCheck, ListChecks, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Sélection de plusieurs paquets ou notes, pour les ranger ou les supprimer
 * d'un geste.
 *
 * Un mode, comme dans Fichiers ou Photos : tant qu'il est actif, toucher une
 * carte la coche au lieu de l'ouvrir. Un mode plutôt que des cases toujours
 * visibles, parce qu'au doigt une case de 44 px sur chaque vignette mangerait
 * la vignette, et qu'une case plus petite se rate.
 *
 * On y entre par le bouton « Sélectionner », par le menu d'un élément, ou à la
 * souris par Ctrl/⌘-clic ; Maj-clic coche toute une plage. On en sort par la
 * croix de la barre, par Échap, ou une fois l'action faite.
 *
 * Le clic est intercepté **en phase de capture** sur la carte : le lien
 * qu'elle contient ne le reçoit jamais, et rien n'a à savoir dans les cartes
 * elles-mêmes qu'une sélection existe.
 */

type Selection = {
  active: boolean;
  /** Les éléments cochés, dans l'ordre de la liste. */
  selected: string[];
  /** Nombre d'éléments affichés. */
  total: number;
  has: (id: string) => boolean;
  toggle: (id: string, range?: boolean) => void;
  start: (id?: string) => void;
  selectAll: () => void;
  exit: () => void;
};

const Contexte = React.createContext<Selection | null>(null);

/** `null` hors d'une liste sélectionnable : la poignée de glisser s'en sert. */
export function useSelection(): Selection | null {
  return React.useContext(Contexte);
}

export function SelectionProvider({
  ids,
  children,
}: {
  /** Tous les éléments affichés, dans l'ordre : pour « Tout » et les plages. */
  ids: string[];
  children: React.ReactNode;
}) {
  const [active, setActive] = React.useState(false);
  const [coches, setCoches] = React.useState<Set<string>>(() => new Set());
  const ancre = React.useRef<string | null>(null);

  // Seuls les éléments encore affichés comptent : après une suppression ou un
  // rafraîchissement, un identifiant disparu ne doit rien emporter avec lui.
  const selected = React.useMemo(() => ids.filter((id) => coches.has(id)), [ids, coches]);

  const exit = React.useCallback(() => {
    setActive(false);
    setCoches(new Set());
    ancre.current = null;
  }, []);

  const value = React.useMemo<Selection>(
    () => ({
      active,
      selected,
      total: ids.length,
      has: (id) => coches.has(id),
      toggle: (id, range) => {
        // Lue ici, pas dans la mise à jour : React l'exécute plus tard, quand
        // l'ancre désigne déjà l'élément qu'on vient de toucher.
        const depuis = range ? ancre.current : null;
        setCoches((avant) => {
          const apres = new Set(avant);
          const debut = depuis ? ids.indexOf(depuis) : -1;
          const fin = ids.indexOf(id);
          if (debut >= 0 && fin >= 0) {
            const [a, b] = debut < fin ? [debut, fin] : [fin, debut];
            for (const i of ids.slice(a, b + 1)) apres.add(i);
          } else if (apres.has(id)) apres.delete(id);
          else apres.add(id);
          return apres;
        });
        ancre.current = id;
      },
      start: (id) => {
        setActive(true);
        if (id) {
          setCoches(new Set([id]));
          ancre.current = id;
        }
      },
      selectAll: () =>
        setCoches((avant) => (ids.every((id) => avant.has(id)) ? new Set() : new Set(ids))),
      exit,
    }),
    [active, selected, coches, ids, exit],
  );

  React.useEffect(() => {
    if (!active) return;
    const echap = (event: KeyboardEvent) => {
      // Une boîte de dialogue ouverte par la barre se ferme d'abord.
      if (event.key === "Escape" && !document.querySelector("[role=dialog]")) exit();
    };
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [active, exit]);

  return (
    <Contexte.Provider value={value}>
      {children}
      {/* La barre flotte au-dessus de la fin de la liste : sans cette marge,
          les dernières cartes resteraient dessous, impossibles à cocher. */}
      {active ? <div aria-hidden className="h-24" /> : null}
    </Contexte.Provider>
  );
}

/** Enveloppe d'une carte : coche au toucher quand la sélection est active. */
export function Selectable({
  id,
  label,
  children,
  className,
}: {
  id: string;
  /** Nom de l'élément, pour la case lue par les lecteurs d'écran. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  const selection = useSelection();
  if (!selection) return <>{children}</>;
  const { active, has, toggle, start } = selection;
  const coche = has(id);

  return (
    <div
      data-selected={active && coche ? "true" : undefined}
      className={cn(
        "relative h-full rounded-xl transition-shadow",
        "data-[selected=true]:ring-2 data-[selected=true]:ring-primary data-[selected=true]:ring-offset-2 data-[selected=true]:ring-offset-surface",
        className,
      )}
      onClickCapture={(event) => {
        const cible = event.target as HTMLElement;
        if (!active) {
          // Ctrl/⌘-clic : le geste de sélection de tous les gestionnaires de
          // fichiers. Sans lui, le lien s'ouvrirait dans un nouvel onglet.
          if (event.metaKey || event.ctrlKey) {
            event.preventDefault();
            event.stopPropagation();
            start(id);
          }
          return;
        }
        // Les boutons de la carte (menu ⋮, poignée) gardent leur rôle ; seule
        // la case, et le reste de la carte, cochent.
        const bouton = cible.closest("button");
        if (bouton && !bouton.hasAttribute("data-selection-case")) return;
        event.preventDefault();
        event.stopPropagation();
        toggle(id, event.shiftKey);
      }}
    >
      {children}
      {active ? (
        <button
          type="button"
          role="checkbox"
          aria-checked={coche}
          aria-label={`Sélectionner « ${label} »`}
          data-selection-case
          className="absolute left-1 top-1 z-20 grid size-11 place-items-center rounded-full"
        >
          <span
            className={cn(
              "grid size-6 place-items-center rounded-full border-2 transition-colors elevation-1",
              coche
                ? "border-primary bg-primary text-on-primary"
                : "border-outline bg-surface-container/90 text-transparent backdrop-blur-sm",
            )}
          >
            <Check className="size-4" strokeWidth={3} />
          </span>
        </button>
      ) : null}
    </div>
  );
}

/** Le bouton d'en-tête qui ouvre le mode sélection. */
export function SelectionButton({
  className,
  size,
}: {
  className?: string;
  size?: "md" | "lg";
}) {
  const selection = useSelection();
  // Rien à cocher : le bouton ne ferait qu'ouvrir une barre vide.
  if (!selection || selection.active || selection.total === 0) return null;
  return (
    <Button variant="outlined" size={size} onClick={() => selection.start()} className={className}>
      <ListChecks />
      Sélectionner
    </Button>
  );
}

/**
 * Barre d'actions de la sélection, flottante en bas de l'écran : c'est là
 * que se trouve le pouce sur un téléphone, et la main sur un iPad.
 */
export function SelectionBar({
  noun,
  children,
  error,
}: {
  /** Singulier et pluriel : « paquet », « paquets ». */
  noun: [string, string];
  /** Les boutons d'action ; ils lisent la sélection par `useSelection`. */
  children: React.ReactNode;
  /** Un échec reste affiché dans la barre, là où l'on regarde. */
  error?: string | null;
}) {
  const selection = useSelection();
  if (!selection?.active) return null;
  const n = selection.selected.length;
  const tout = n > 0 && n === selection.total;

  return (
    <div
      role="toolbar"
      aria-label="Sélection"
      className={cn(
        // Au-dessus de la barre de navigation du téléphone (z-40), encoche
        // comprise ; en bas de l'écran sur tablette et ordinateur.
        "fixed inset-x-3 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-50 mx-auto max-w-2xl md:bottom-6",
        "rounded-3xl bg-surface-highest p-1.5 text-on-surface elevation-3",
      )}
    >
      <div className="flex items-center gap-1">
        <Button variant="toolbar-icon" size="icon" aria-label="Quitter la sélection" onClick={selection.exit}>
          <X />
        </Button>
        <p aria-live="polite" className="min-w-0 flex-1 truncate m3-title-small tabular-nums">
          {n === 0 ? "Aucun" : n} {n > 1 ? noun[1] : noun[0]}
        </p>
        <Button
          variant="toolbar-icon"
          size="icon"
          aria-label={tout ? "Tout désélectionner" : "Tout sélectionner"}
          title={tout ? "Tout désélectionner" : "Tout sélectionner"}
          aria-pressed={tout}
          onClick={selection.selectAll}
        >
          <CheckCheck />
        </Button>
        {children}
      </div>
      {error ? (
        <p role="alert" className="px-3 pb-1.5 m3-body-small text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Bouton d'action de la barre : icône seule sur téléphone, libellé au-delà. */
export function SelectionAction({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  const selection = useSelection();
  const vide = !selection || selection.selected.length === 0;
  return (
    <Button
      variant="text"
      onClick={onClick}
      disabled={vide}
      aria-label={label}
      title={label}
      // Icône seule sur téléphone : `min-w-12` garde la cible tactile de 48 px
      // que le seul rembourrage n'atteignait pas (42 px mesurés).
      className={cn("min-w-12 px-3 sm:px-4", destructive ? "text-error" : "text-primary")}
    >
      <Icon />
      <span className="hidden sm:inline">{label}</span>
    </Button>
  );
}
