"use client";

import * as React from "react";
import { ChevronDown, GripVertical } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Le support de la barre d'outils : on la déplace, on la replie.
 *
 * Une barre d'outils d'écriture n'a pas de bonne place. Elle est sous la main
 * droite pour un droitier et sur la page pour un gaucher ; en bas elle
 * recouvre la dernière ligne qu'on vient d'écrire ; et sur un iPhone en
 * paysage elle prend le tiers de la hauteur. La réponse d'Apple, dans Freeform
 * comme dans Markup, est de ne pas trancher : **la barre se déplace**, elle se
 * colle au bord qu'on veut, et elle se replie en une bulle qui ne montre plus
 * que l'instrument en cours.
 *
 * Trois choix expliquent ce fichier :
 *
 * 1. **Le glisser passe par Pointer Events.** Le glisser-déposer natif du
 *    navigateur ne fonctionne pas au toucher — c'est une limite de l'API, pas
 *    un oubli, et c'est déjà pour cela que le rangement des notes dans les
 *    dossiers est écrit ainsi.
 * 2. **La position est gardée par bord et par proportion**, jamais en pixels.
 *    Un iPad qu'on tourne change de largeur : une barre posée à 900 px du bord
 *    gauche sortirait de l'écran en portrait. Un bord et une fraction se
 *    retrouvent dans les deux orientations.
 * 3. **Sur un bord vertical, la barre devient une colonne** de deux boutons de
 *    large. Rien n'a été réécrit pour cela : les groupes sont déjà en
 *    `flex-wrap`, et il suffit de les serrer dans une largeur fixe.
 */

export type BordBarre = "bottom" | "top" | "left" | "right";
export type PositionBarre = { bord: BordBarre; offset: number; reduit: boolean };

export const BARRE_CLE = "fiches:barre-outils";
export const BARRE_DEFAUT: PositionBarre = { bord: "bottom", offset: 0.5, reduit: false };

/** Les bords, dans l'ordre où le menu les propose. */
export const BORDS: { bord: BordBarre; label: string }[] = [
  { bord: "bottom", label: "En bas" },
  { bord: "top", label: "En haut" },
  { bord: "left", label: "À gauche" },
  { bord: "right", label: "À droite" },
];

export function estVertical(bord: BordBarre): boolean {
  return bord === "left" || bord === "right";
}

/**
 * La position gardée par l'appareil.
 *
 * C'est une commodité propre à l'appareil, pas une donnée de la note : la
 * perdre — navigation privée, stockage refusé — ne coûte qu'un geste à refaire.
 */
export function lirePosition(): PositionBarre {
  try {
    const brut: unknown = JSON.parse(window.localStorage.getItem(BARRE_CLE) ?? "null");
    if (!brut || typeof brut !== "object") return BARRE_DEFAUT;
    const p = brut as Partial<PositionBarre>;
    const bord = BORDS.some((b) => b.bord === p.bord) ? (p.bord as BordBarre) : BARRE_DEFAUT.bord;
    const offset = typeof p.offset === "number" && p.offset >= 0 && p.offset <= 1 ? p.offset : 0.5;
    return { bord, offset, reduit: p.reduit === true };
  } catch {
    return BARRE_DEFAUT;
  }
}

export function ecrirePosition(position: PositionBarre) {
  try {
    window.localStorage.setItem(BARRE_CLE, JSON.stringify(position));
  } catch {
    // Stockage refusé : la barre obéit quand même, elle ne s'en souvient pas.
  }
}

/**
 * La position de la barre est un **état extérieur** à React.
 *
 * Elle vit dans le stockage de l'appareil, elle est partagée par toutes les
 * pages manuscrites d'une note, et elle n'existe pas au rendu serveur. La lire
 * dans un effet pour la poser ensuite dans un état ferait un rendu de plus à
 * chaque montage, et ferait sauter la barre de sa place par défaut à sa vraie
 * place sous les yeux de la personne. `useSyncExternalStore` est fait pour
 * exactement cela : un instantané côté serveur, un autre côté client, et
 * l'abonnement qui prévient les autres barres quand celle-ci bouge.
 */
const abonnes = new Set<() => void>();
let cache: PositionBarre | null = null;

function sAbonner(prevenir: () => void) {
  abonnes.add(prevenir);
  return () => {
    abonnes.delete(prevenir);
  };
}

/** L'instantané doit être **stable** : React compare les références. */
function instantane(): PositionBarre {
  cache ??= lirePosition();
  return cache;
}

function instantaneServeur(): PositionBarre {
  return BARRE_DEFAUT;
}

export function usePositionBarre(): [PositionBarre, (next: PositionBarre) => void] {
  const position = React.useSyncExternalStore(sAbonner, instantane, instantaneServeur);
  const poser = React.useCallback((next: PositionBarre) => {
    cache = next;
    ecrirePosition(next);
    for (const prevenir of [...abonnes]) prevenir();
  }, []);
  return [position, poser];
}

/** Marge entre la barre et le bord de l'écran, zone sûre comprise. */
const MARGE = 10;

/**
 * Place la barre à partir de son bord, de sa proportion et de sa taille.
 *
 * La taille est **mesurée**, jamais supposée : la barre change de hauteur avec
 * l'outil courant — la rangée des réglages disparaît pour le lasso — et une
 * position calculée sur une hauteur devinée la ferait sortir de l'écran.
 */
function placer(
  position: PositionBarre,
  taille: { w: number; h: number },
  ecran: { w: number; h: number },
): React.CSSProperties {
  const libreX = Math.max(0, ecran.w - taille.w - MARGE * 2);
  const libreY = Math.max(0, ecran.h - taille.h - MARGE * 2);
  if (estVertical(position.bord)) {
    return {
      top: MARGE + libreY * position.offset,
      [position.bord === "left" ? "left" : "right"]: MARGE,
    };
  }
  return {
    left: MARGE + libreX * position.offset,
    [position.bord === "bottom" ? "bottom" : "top"]: MARGE,
  };
}

/** Le bord le plus proche d'un point, et la proportion le long de ce bord. */
function bordLePlusProche(
  centre: { x: number; y: number },
  ecran: { w: number; h: number },
): { bord: BordBarre; offset: number } {
  const distances: { bord: BordBarre; d: number }[] = [
    { bord: "left", d: centre.x },
    { bord: "right", d: ecran.w - centre.x },
    { bord: "top", d: centre.y },
    { bord: "bottom", d: ecran.h - centre.y },
  ];
  distances.sort((a, b) => a.d - b.d);
  const bord = distances[0].bord;
  const offset = estVertical(bord)
    ? Math.min(1, Math.max(0, centre.y / Math.max(1, ecran.h)))
    : Math.min(1, Math.max(0, centre.x / Math.max(1, ecran.w)));
  return { bord, offset };
}

export function InkDock({
  position,
  onPosition,
  /** La barre flotte-t-elle au-dessus de la page, et peut-on la déplacer ? */
  flottante,
  bulle,
  children,
  toolbarRef,
}: {
  position: PositionBarre;
  onPosition: (next: PositionBarre) => void;
  flottante: boolean;
  /** Ce que montre la bulle repliée : l'instrument en cours. */
  bulle: React.ReactNode;
  children: React.ReactNode;
  toolbarRef?: React.Ref<HTMLDivElement>;
}) {
  const boite = React.useRef<HTMLDivElement>(null);
  const [taille, setTaille] = React.useState({ w: 0, h: 0 });
  const [ecran, setEcran] = React.useState({ w: 0, h: 0 });
  /** Position libre pendant le glisser : la barre suit le doigt, puis se colle. */
  const [glisse, setGlisse] = React.useState<{ x: number; y: number } | null>(null);
  const [menu, setMenu] = React.useState(false);

  /*
   * Taille de la barre et taille de l'écran, **observées**.
   *
   * Une mesure prise une fois vaut pour l'orientation où on l'a prise : la
   * barre ouverte en paysage puis l'iPad tourné garderait la place de l'autre
   * orientation, et se retrouverait hors de l'écran. Même règle que pour la
   * hauteur de la feuille.
   */
  React.useEffect(() => {
    const el = boite.current;
    if (!el) return;
    const mesurer = () => {
      const r = el.getBoundingClientRect();
      setTaille({ w: r.width, h: r.height });
      setEcran({ w: window.innerWidth, h: window.innerHeight });
    };
    const observer = new ResizeObserver(mesurer);
    observer.observe(el);
    window.addEventListener("resize", mesurer);
    window.addEventListener("orientationchange", mesurer);
    mesurer();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", mesurer);
      window.removeEventListener("orientationchange", mesurer);
    };
  }, [flottante, position.reduit, position.bord]);

  const vertical = estVertical(position.bord) && !position.reduit;

  /* ---------------------------------------------------------------- *
   * Le glisser.
   * ---------------------------------------------------------------- */

  const depart = React.useRef<{ dx: number; dy: number } | null>(null);

  function onGripDown(event: React.PointerEvent) {
    if (!flottante) return;
    const el = boite.current;
    if (!el) return;
    event.preventDefault();
    const r = el.getBoundingClientRect();
    depart.current = { dx: event.clientX - r.left, dy: event.clientY - r.top };
    setGlisse({ x: r.left, y: r.top });
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Capture refusée : on suit le pointeur tant qu'il reste sur la poignée.
    }
  }

  function onGripMove(event: React.PointerEvent) {
    const d = depart.current;
    if (!d) return;
    event.preventDefault();
    setGlisse({ x: event.clientX - d.dx, y: event.clientY - d.dy });
  }

  function onGripUp(event: React.PointerEvent) {
    const d = depart.current;
    if (!d) return;
    depart.current = null;
    setGlisse(null);
    /*
     * C'est **le doigt** qui désigne le bord, pas le centre de la barre.
     *
     * Mesuré sur le centre, une barre large de huit cents pixels lâchée contre
     * le bord gauche gardait son centre à quatre cents pixels de là : le bord
     * le plus proche de ce centre était le bas, et la barre y retournait. On
     * tire la barre **vers** un bord ; c'est là que la main pointe, et c'est
     * elle qui décide.
     */
    const { bord, offset } = bordLePlusProche(
      { x: event.clientX, y: event.clientY },
      { w: window.innerWidth, h: window.innerHeight },
    );
    onPosition({ ...position, bord, offset });
  }

  /* ---------------------------------------------------------------- *
   * La bulle.
   * ---------------------------------------------------------------- */

  if (flottante && position.reduit) {
    return (
      <div
        ref={boite}
        style={glisse ? { left: glisse.x, top: glisse.y } : placer(position, taille, ecran)}
        className="fixed z-10 touch-none"
      >
        <button
          type="button"
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          onClick={() => {
            if (!glisse) onPosition({ ...position, reduit: false });
          }}
          aria-label="Ouvrir les outils d'écriture"
          title="Ouvrir les outils — glisser pour déplacer"
          className="grid size-14 place-items-center rounded-full border border-outline-variant bg-surface-container elevation-3"
        >
          {bulle}
        </button>
      </div>
    );
  }

  /* ---------------------------------------------------------------- *
   * La barre.
   * ---------------------------------------------------------------- */

  const corps = (
    <div className={cn("flex min-w-0 items-start gap-1", vertical ? "flex-col" : "flex-row")}>
      {flottante ? (
        <div className={cn("flex shrink-0 items-center gap-0.5", vertical && "self-center")}>
          {/*
           * La poignée. Elle se glisse au doigt **et** s'ouvre au clavier :
           * un déplacement qui n'existe qu'au glisser n'existe pas pour qui
           * navigue au clavier ou au commutateur.
           */}
          <div className="relative">
            <button
              type="button"
              data-testid="barre-poignee"
              onPointerDown={onGripDown}
              onPointerMove={onGripMove}
              onPointerUp={onGripUp}
              onPointerCancel={onGripUp}
              onClick={() => {
                if (!glisse) setMenu((ouvert) => !ouvert);
              }}
              aria-label="Déplacer la barre d'outils"
              aria-haspopup="menu"
              aria-expanded={menu}
              title="Glisser pour déplacer la barre — ou toucher pour choisir un bord"
              className="grid size-11 shrink-0 cursor-grab touch-none place-items-center rounded-full text-on-surface-variant hover:text-on-surface active:cursor-grabbing"
            >
              <GripVertical className="size-5" />
            </button>
            {menu ? (
              <MenuBords
                position={position}
                onChoisir={(bord) => {
                  onPosition({ ...position, bord, offset: 0.5 });
                  setMenu(false);
                }}
                onFermer={() => setMenu(false)}
              />
            ) : null}
          </div>

          <button
            type="button"
            data-testid="barre-reduire"
            onClick={() => onPosition({ ...position, reduit: true })}
            aria-label="Réduire les outils en bulle"
            title="Réduire en bulle — la barre ne montre plus que l'instrument en cours"
            className="grid size-11 shrink-0 place-items-center rounded-full text-on-surface-variant hover:text-on-surface"
          >
            <ChevronDown className="size-5" />
          </button>
        </div>
      ) : null}

      <div
        ref={toolbarRef}
        role="toolbar"
        aria-label="Outils d'écriture"
        aria-orientation={vertical ? "vertical" : "horizontal"}
        className={cn(
          "flex min-w-0 flex-col gap-1",
          // Sur un bord vertical, la barre devient une colonne de deux boutons
          // de large : les groupes sont déjà en `flex-wrap`, il suffit de les
          // serrer. Et elle défile, parce que dix-huit commandes empilées ne
          // tiennent pas dans un iPhone en paysage.
          vertical && "scroll-slim max-h-[70svh] w-[6.5rem] overflow-y-auto",
        )}
      >
        {children}
      </div>
    </div>
  );

  if (!flottante) return corps;

  return (
    <div
      ref={boite}
      data-testid="barre-flottante"
      style={glisse ? { left: glisse.x, top: glisse.y } : placer(position, taille, ecran)}
      className={cn(
        "fixed z-10 max-w-[calc(100vw-1.25rem)] rounded-3xl border border-outline-variant bg-surface-container px-1.5 py-1 elevation-3",
        // Pendant le glisser, la barre suit le doigt sans transition : une
        // animation ferait traîner la barre derrière la main.
        !glisse && "transition-[left,top,bottom,right] duration-200",
      )}
    >
      {corps}
    </div>
  );
}

/** Le choix du bord, au clavier comme au doigt. */
function MenuBords({
  position,
  onChoisir,
  onFermer,
}: {
  position: PositionBarre;
  onChoisir: (bord: BordBarre) => void;
  onFermer: () => void;
}) {
  const panneau = React.useRef<HTMLDivElement>(null);

  /*
   * Le menu se retourne quand il n'y a pas la place au-dessus.
   *
   * Il est ancré au-dessus de la poignée, parce que la barre est le plus
   * souvent en bas de l'écran. Mais la barre se déplace : collée en haut, ou
   * sur un bord vertical où la poignée est tout en haut de la colonne, le menu
   * partait **au-dessus du bord de l'écran** — visible nulle part, et
   * impossible à toucher. Même règle que pour la palette de symboles : le
   * placement se pose sur l'élément dans un effet de mise en page, un état
   * React le ferait sauter.
   */
  React.useLayoutEffect(() => {
    const el = panneau.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.top < 8) {
      el.style.bottom = "auto";
      el.style.top = "100%";
      el.style.marginBottom = "0";
      el.style.marginTop = "0.25rem";
    }
    // Et il ne doit pas non plus sortir par la droite : sur un bord droit, la
    // poignée est à quelques pixels du bord de l'écran.
    const apres = el.getBoundingClientRect();
    if (apres.right > window.innerWidth - 8) {
      el.style.left = "auto";
      el.style.right = "0";
    }
  }, []);

  React.useEffect(() => {
    const clavier = (event: KeyboardEvent) => {
      if (event.key === "Escape") onFermer();
    };
    const dehors = (event: PointerEvent) => {
      const cible = event.target;
      if (!(cible instanceof Element)) return;
      if (cible.closest('[data-testid="barre-poignee"]')) return;
      if (!panneau.current?.contains(cible)) onFermer();
    };
    document.addEventListener("keydown", clavier);
    document.addEventListener("pointerdown", dehors, true);
    return () => {
      document.removeEventListener("keydown", clavier);
      document.removeEventListener("pointerdown", dehors, true);
    };
  }, [onFermer]);

  return (
    <div
      ref={panneau}
      role="menu"
      aria-label="Placer la barre d'outils"
      // Ancré au coin de la poignée et **vers le haut** : la barre est le plus
      // souvent en bas de l'écran, et un menu déplié vers le bas y sortirait.
      className="absolute bottom-full left-0 z-20 mb-1 w-40 rounded-xl border border-outline-variant bg-surface-container p-1 elevation-2"
    >
      {BORDS.map((entry) => (
        <button
          key={entry.bord}
          type="button"
          role="menuitemradio"
          aria-checked={position.bord === entry.bord}
          onClick={() => onChoisir(entry.bord)}
          className={cn(
            "flex min-h-11 w-full items-center rounded-lg px-3 m3-label-large transition-colors",
            position.bord === entry.bord
              ? "bg-primary-container text-on-primary-container"
              : "text-on-surface-variant hover:text-on-surface",
          )}
        >
          {entry.label}
        </button>
      ))}
    </div>
  );
}
