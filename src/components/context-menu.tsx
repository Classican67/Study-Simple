"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { MoreVertical, type LucideIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Menu contextuel : clic droit à la souris, appui long au doigt ou au stylet.
 *
 * iPadOS ne déclenche pas `contextmenu` sur un appui long — Safari y montre à
 * la place l'aperçu du lien. L'appui long est donc refait sur Pointer Events,
 * et l'aperçu natif neutralisé (`-webkit-touch-callout: none`). Le clic qui
 * suit le lever du doigt est avalé : sans cela, le menu s'ouvrirait et la note
 * avec lui.
 *
 * Un appui long ne se découvre pas, et un clavier n'en fait pas : chaque
 * élément porte aussi un bouton « Plus d'options » (cf. `MoreButton`). La
 * touche Menu et Maj+F10, qui émettent `contextmenu`, ouvrent le même menu.
 */

export type MenuAction = {
  label: string;
  icon: LucideIcon;
  onSelect: () => void;
  /** Suppression : en couleur d'erreur, et séparée du reste. */
  destructive?: boolean;
  disabled?: boolean;
};

/** Durée d'un appui long. Celle d'iPadOS, à peu près. */
const APPUI_LONG_MS = 500;
/** Au-delà, le doigt fait défiler la liste : ce n'est plus un appui. */
const TOLERANCE_PX = 10;

type Ancre = { x: number; y: number; /** Aligner le bord droit du menu sur `x`. */ fin?: boolean };

/** Ce que le bouton « Plus d'options » doit savoir du menu qui l'entoure. */
const Ouverture = React.createContext<{ ouvrir: (depuis: HTMLElement) => void; ouvert: boolean } | null>(
  null,
);

export function ContextMenu({
  label,
  actions,
  trigger,
  children,
}: {
  /** Nom du menu, lu par les lecteurs d'écran : « Options de … ». */
  label: string;
  actions: MenuAction[];
  /** Rendu avant le contenu : il contient typiquement un `MoreButton`. */
  trigger?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [ancre, setAncre] = React.useState<Ancre | null>(null);
  const menuRef = React.useRef<HTMLDivElement>(null);
  const appui = React.useRef<{ id: number; x: number; y: number; minuteur: number } | null>(null);
  const avalerClic = React.useRef(false);
  // Où rendre le focus en refermant : l'élément d'où l'on est parti.
  const retour = React.useRef<HTMLElement | null>(null);

  const annulerAppui = React.useCallback(() => {
    if (appui.current) window.clearTimeout(appui.current.minuteur);
    appui.current = null;
  }, []);
  React.useEffect(() => annulerAppui, [annulerAppui]);

  const fermer = React.useCallback((rendreFocus: boolean) => {
    setAncre(null);
    if (rendreFocus) retour.current?.focus({ preventScroll: true });
  }, []);

  const ouvrirDepuis = React.useCallback((depuis: HTMLElement) => {
    const r = depuis.getBoundingClientRect();
    retour.current = depuis;
    setAncre({ x: r.right, y: r.bottom + 4, fin: true });
  }, []);

  const ouverture = React.useMemo(
    () => ({ ouvrir: ouvrirDepuis, ouvert: ancre !== null }),
    [ouvrirDepuis, ancre],
  );

  /** L'événement vient-il du menu lui-même ? Un portail remonte ses événements React jusqu'ici. */
  const duMenu = (cible: EventTarget) => cible instanceof Node && Boolean(menuRef.current?.contains(cible));

  return (
    <div
      // `contents` : l'enveloppe ne pèse rien dans la mise en page, et le style
      // de la carte reste celui de la liste. Les deux propriétés sont héritées.
      className="contents select-none [-webkit-touch-callout:none]"
      onContextMenu={(event) => {
        if (duMenu(event.target)) {
          event.preventDefault();
          return;
        }
        event.preventDefault();
        annulerAppui();
        const cible = event.target as HTMLElement;
        const element = cible.closest<HTMLElement>("a,button") ?? cible;
        retour.current = element;
        // Clavier (touche Menu, Maj+F10) : pas de coordonnées, on s'ancre à
        // l'élément.
        if (event.clientX === 0 && event.clientY === 0) {
          const r = element.getBoundingClientRect();
          setAncre({ x: r.left + 16, y: r.top + Math.min(r.height, 48) });
        } else {
          setAncre({ x: event.clientX, y: event.clientY });
        }
      }}
      onPointerDown={(event) => {
        if (event.pointerType === "mouse" || duMenu(event.target)) return;
        // Les boutons de la carte ont leur propre geste : la poignée de
        // glissement se maintient, elle aussi.
        if ((event.target as HTMLElement).closest("button")) return;
        annulerAppui();
        const { clientX: x, clientY: y, pointerId: id } = event;
        const depuis = (event.target as HTMLElement).closest<HTMLElement>("a,button");
        const minuteur = window.setTimeout(() => {
          appui.current = null;
          avalerClic.current = true;
          navigator.vibrate?.(10);
          retour.current = depuis;
          // Un peu décalé du doigt, qui cacherait sinon la première ligne.
          setAncre({ x: x + 8, y: y + 8 });
        }, APPUI_LONG_MS);
        appui.current = { id, x, y, minuteur };
      }}
      onPointerMove={(event) => {
        const a = appui.current;
        if (!a || a.id !== event.pointerId) return;
        if (Math.hypot(event.clientX - a.x, event.clientY - a.y) > TOLERANCE_PX) annulerAppui();
      }}
      onPointerUp={() => {
        annulerAppui();
        // iPadOS n'émet pas toujours de clic après un appui long : le drapeau
        // ne doit pas survivre et avaler le premier choix fait dans le menu.
        if (avalerClic.current) window.setTimeout(() => (avalerClic.current = false), 400);
      }}
      // Le navigateur reprend le geste pour faire défiler : ce n'était pas un appui.
      onPointerCancel={annulerAppui}
      onClickCapture={(event) => {
        if (!avalerClic.current || duMenu(event.target)) return;
        avalerClic.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <Ouverture.Provider value={ouverture}>{trigger}</Ouverture.Provider>
      {children}
      {ancre ? (
        <Menu ref={menuRef} label={label} ancre={ancre} actions={actions} onClose={fermer} />
      ) : null}
    </div>
  );
}

function Menu({
  ref,
  label,
  ancre,
  actions,
  onClose,
}: {
  ref: React.RefObject<HTMLDivElement | null>;
  label: string;
  ancre: Ancre;
  actions: MenuAction[];
  onClose: (rendreFocus: boolean) => void;
}) {
  const [place, setPlace] = React.useState<{ left: number; top: number } | null>(null);

  // Placé une fois mesuré : le menu ne doit jamais sortir de l'écran, ni à
  // droite sur un téléphone, ni en bas quand on vise la dernière note.
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const { width, height } = el.getBoundingClientRect();
    const marge = 8;
    const x = ancre.fin ? ancre.x - width : ancre.x;
    const left = Math.max(marge, Math.min(x, window.innerWidth - width - marge));
    const top =
      ancre.y + height + marge > window.innerHeight
        ? Math.max(marge, ancre.y - height - (ancre.fin ? 52 : 0))
        : ancre.y;
    setPlace({ left, top });
  }, [ancre, ref]);

  /*
   * Le focus, une fois le menu placé — pas avant.
   *
   * Tant qu'il n'est pas mesuré, le menu est en `visibility: hidden`, et un
   * élément invisible refuse le focus sans rien dire : le clavier restait sur
   * la carte, et Échap n'atteignait jamais le menu.
   */
  const place_ = place !== null;
  React.useEffect(() => {
    if (!place_) return;
    ref.current?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }, [place_, ref]);

  // Tourner l'écran déplace ce que le menu désignait : il se referme. Échap
  // aussi, où que soit le focus — un clic droit ne le déplace pas toujours.
  React.useEffect(() => {
    const fermer = () => onClose(false);
    const clavier = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose(true);
    };
    window.addEventListener("resize", fermer);
    window.addEventListener("keydown", clavier);
    return () => {
      window.removeEventListener("resize", fermer);
      window.removeEventListener("keydown", clavier);
    };
  }, [onClose]);

  function surClavier(event: React.KeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')];
    const courant = items.indexOf(document.activeElement as HTMLElement);
    const aller = (i: number) => items[(i + items.length) % items.length]?.focus();
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        aller(courant + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        aller(courant - 1);
        break;
      case "Home":
        event.preventDefault();
        aller(0);
        break;
      case "End":
        event.preventDefault();
        aller(items.length - 1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        onClose(true);
        break;
      case "Tab":
        event.preventDefault();
        onClose(true);
        break;
    }
  }

  const ordinaires = actions.filter((a) => !a.destructive);
  const destructives = actions.filter((a) => a.destructive);

  return createPortal(
    <>
      {/* Voile transparent : un toucher à côté referme le menu sans ouvrir ce
          qui se trouve dessous. Le clic plutôt que l'appui, pour que le lever
          du doigt ne tombe pas sur la carte d'en dessous. */}
      <div
        aria-hidden
        className="fixed inset-0 z-50"
        onClick={() => onClose(false)}
        onContextMenu={(event) => {
          event.preventDefault();
          onClose(false);
        }}
      />
      <div
        ref={ref}
        role="menu"
        aria-label={label}
        onKeyDown={surClavier}
        className="fixed z-50 min-w-56 max-w-[calc(100vw-1rem)] animate-fade-in rounded-xl bg-surface-high py-2 elevation-3"
        // Mesuré depuis le coin de l'écran, pas depuis l'ancre : posé contre le
        // bord droit, le menu se rétrécissait à sa largeur minimale, était placé
        // sur cette largeur, puis reprenait la sienne et débordait.
        style={place ?? { left: 0, top: 0, visibility: "hidden" }}
      >
        {ordinaires.map((action) => (
          <Item key={action.label} action={action} onClose={onClose} />
        ))}
        {destructives.length > 0 && ordinaires.length > 0 ? (
          <div role="separator" className="my-2 h-px bg-outline-variant" />
        ) : null}
        {destructives.map((action) => (
          <Item key={action.label} action={action} onClose={onClose} />
        ))}
      </div>
    </>,
    document.body,
  );
}

function Item({ action, onClose }: { action: MenuAction; onClose: (rendreFocus: boolean) => void }) {
  const Icon = action.icon;
  return (
    <button
      type="button"
      role="menuitem"
      disabled={action.disabled}
      onClick={() => {
        // Refermé d'abord : l'action ouvre souvent une boîte de dialogue, qui
        // prend le focus à son tour.
        onClose(false);
        action.onSelect();
      }}
      className={cn(
        "state-layer flex min-h-12 w-full items-center gap-3 px-4 text-left m3-body-large outline-none",
        "focus-visible:bg-surface-highest disabled:pointer-events-none disabled:opacity-38",
        action.destructive ? "text-error" : "text-on-surface",
      )}
    >
      <Icon className={cn("size-5 shrink-0", action.destructive ? "" : "text-on-surface-variant")} />
      {action.label}
    </button>
  );
}

/** Le bouton « Plus d'options » : le chemin visible, et celui du clavier. */
export function MoreButton({ label, className }: { label: string; className?: string }) {
  const menu = React.useContext(Ouverture);
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      aria-expanded={menu?.ouvert ?? false}
      title="Plus d'options"
      onClick={(event) => {
        // La carte est un lien : le bouton ne doit pas l'ouvrir en passant.
        event.preventDefault();
        event.stopPropagation();
        menu?.ouvrir(event.currentTarget);
      }}
      className={cn(
        "state-layer grid size-11 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface",
        className,
      )}
    >
      <MoreVertical className="size-5" />
    </button>
  );
}
