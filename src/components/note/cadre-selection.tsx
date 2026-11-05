"use client";

import * as React from "react";
import { RotateCw } from "lucide-react";

import { TRANSFO_NEUTRE, type Bounds, type Transfo } from "@/lib/ink";
import { cn } from "@/lib/utils";

/**
 * Le cadre de ce que le lasso a retenu.
 *
 * Il se saisit au milieu pour déplacer, par un coin pour agrandir, par la
 * pastille du haut pour tourner — les trois gestes de tout logiciel de dessin,
 * pour un schéma comme pour trois lignes d'écriture.
 *
 * Il ne connaît rien de ce qu'il encadre : il ne produit qu'une transformation
 * (`Transfo`), que le canevas applique. C'est ce qui garantit que l'encre et les
 * images bougent ensemble.
 *
 * ## Pourquoi des éléments HTML, et pas la couche des repères
 *
 * Le cadre était dessiné sur le canevas, où il ne pouvait rien proposer : une
 * poignée dessinée ne se tabule pas, n'a pas de nom et ne se mesure pas à
 * quarante-quatre pixels.
 */

/** Marge du cadre autour de ce qu'il entoure, en proportion de la page. */
export const MARGE_CADRE = 0.012;

const POIGNEES = [
  { id: "nw", label: "haut gauche", place: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", curseur: "cursor-nwse-resize" },
  { id: "ne", label: "haut droit", place: "right-0 top-0 translate-x-1/2 -translate-y-1/2", curseur: "cursor-nesw-resize" },
  { id: "se", label: "bas droit", place: "bottom-0 right-0 translate-x-1/2 translate-y-1/2", curseur: "cursor-nwse-resize" },
  { id: "sw", label: "bas gauche", place: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2", curseur: "cursor-nesw-resize" },
] as const;

/** Tous les quinze degrés, à trois degrés près : un zéro franc s'obtient sans viser. */
const ANGLE_FRANC = Math.PI / 12;
const ANGLE_ACCROCHE = (3 * Math.PI) / 180;

export function accrocherAngle(angle: number): number {
  const franc = Math.round(angle / ANGLE_FRANC) * ANGLE_FRANC;
  return Math.abs(angle - franc) < ANGLE_ACCROCHE ? franc : angle;
}

type Geste =
  | { type: "deplacer"; x: number; y: number }
  | { type: "agrandir"; vx: number; vy: number }
  | { type: "tourner"; depart: number };

export function CadreSelection({
  cadre,
  transfo,
  pageW,
  echelleMin,
  onDebut,
  onTransfo,
  onFin,
  barre,
}: {
  /** Ce qui est retenu, avant le geste en cours. */
  cadre: Bounds;
  /** Le geste en cours : le cadre le suit, pour ne pas rester derrière l'image. */
  transfo: Transfo | null;
  pageW: number;
  /** Plus petite échelle permise, pour ne pas perdre ce qu'on réduit. */
  echelleMin: number;
  onDebut: () => void;
  onTransfo: (t: Transfo) => void;
  onFin: (t: Transfo) => void;
  /** Les actions de la sélection, posées au-dessus du cadre. */
  barre?: React.ReactNode;
}) {
  const racine = React.useRef<HTMLDivElement>(null);
  const geste = React.useRef<{ geste: Geste; pointeur: number } | null>(null);
  const dernier = React.useRef<Transfo>(TRANSFO_NEUTRE);

  const cx = (cadre.minX + cadre.maxX) / 2;
  const cy = (cadre.minY + cadre.maxY) / 2;
  const base: Transfo = { ...TRANSFO_NEUTRE, cx, cy };

  /** Centre du cadre à l'écran : tout se mesure depuis lui, défilement compris. */
  function centreEcran() {
    const page = racine.current?.parentElement?.getBoundingClientRect();
    const largeur = page?.width ?? pageW;
    return {
      x: (page?.left ?? 0) + cx * largeur,
      y: (page?.top ?? 0) + cy * largeur,
      largeur,
    };
  }

  function commencer(event: React.PointerEvent, type: Geste["type"]) {
    event.preventDefault();
    event.stopPropagation();
    const c = centreEcran();
    const debut: Geste =
      type === "deplacer"
        ? { type, x: event.clientX, y: event.clientY }
        : type === "agrandir"
          ? { type, vx: event.clientX - c.x, vy: event.clientY - c.y }
          : { type, depart: Math.atan2(event.clientY - c.y, event.clientX - c.x) };
    geste.current = { geste: debut, pointeur: event.pointerId };
    dernier.current = base;
    try {
      racine.current?.setPointerCapture(event.pointerId);
    } catch {
      // Pointeur déjà relâché : le geste s'arrêtera au prochain lever.
    }
    onDebut();
  }

  function suivre(event: React.PointerEvent) {
    const courant = geste.current;
    if (!courant || event.pointerId !== courant.pointeur) return;
    event.preventDefault();
    const c = centreEcran();
    const g = courant.geste;
    let suivant = base;
    if (g.type === "deplacer") {
      suivant = { ...base, dx: (event.clientX - g.x) / c.largeur, dy: (event.clientY - g.y) / c.largeur };
    } else if (g.type === "agrandir") {
      /*
       * La projection du geste sur la diagonale de départ, et non la distance au
       * centre : tirer le coin au-delà du centre faisait remonter la distance,
       * et l'image regrandissait — jusqu'à deux fois la page — au lieu de se
       * réduire au minimum.
       */
      const carre = Math.max(1, g.vx * g.vx + g.vy * g.vy);
      const projection = ((event.clientX - c.x) * g.vx + (event.clientY - c.y) * g.vy) / carre;
      suivant = { ...base, echelle: Math.max(echelleMin, projection) };
    } else {
      const angle = Math.atan2(event.clientY - c.y, event.clientX - c.x);
      suivant = { ...base, angle: accrocherAngle(angle - g.depart) };
    }
    dernier.current = suivant;
    onTransfo(suivant);
  }

  function finir(event: React.PointerEvent) {
    const courant = geste.current;
    if (!courant || event.pointerId !== courant.pointeur) return;
    geste.current = null;
    onFin(dernier.current);
  }

  /*
   * Au clavier : les flèches déplacent, Plus et Moins agrandissent. Sans cela,
   * les poignées seraient atteignables à la tabulation sans servir à rien.
   */
  function clavier(event: React.KeyboardEvent) {
    const pas = event.shiftKey ? 0.02 : 0.004;
    let suivant: Transfo | null = null;
    if (event.key === "ArrowLeft") suivant = { ...base, dx: -pas };
    else if (event.key === "ArrowRight") suivant = { ...base, dx: pas };
    else if (event.key === "ArrowUp") suivant = { ...base, dy: -pas };
    else if (event.key === "ArrowDown") suivant = { ...base, dy: pas };
    else if (event.key === "+" || event.key === "=") suivant = { ...base, echelle: 1.05 };
    else if (event.key === "-") suivant = { ...base, echelle: Math.max(echelleMin, 1 / 1.05) };
    if (!suivant) return;
    event.preventDefault();
    onDebut();
    onFin(suivant);
  }

  const t = transfo ?? base;
  const marge = MARGE_CADRE * t.echelle;
  const largeur = (cadre.maxX - cadre.minX) * t.echelle + marge * 2;
  const hauteur = (cadre.maxY - cadre.minY) * t.echelle + marge * 2;
  const centreX = cx + t.dx;
  const centreY = cy + t.dy;

  return (
    <div
      ref={racine}
      data-testid="cadre-selection"
      role="group"
      aria-label="Sélection : glisser pour déplacer, flèches du clavier, plus et moins pour la taille"
      tabIndex={0}
      onPointerDown={(event) => commencer(event, "deplacer")}
      onPointerMove={suivre}
      onPointerUp={finir}
      onPointerCancel={finir}
      onKeyDown={clavier}
      className="pointer-events-auto absolute cursor-move rounded-[2px] outline-2 outline-primary"
      style={{
        left: `${(centreX - largeur / 2) * pageW}px`,
        top: `${(centreY - hauteur / 2) * pageW}px`,
        width: `${largeur * pageW}px`,
        height: `${hauteur * pageW}px`,
        transform: t.angle ? `rotate(${t.angle}rad)` : undefined,
        touchAction: "none",
      }}
    >
      {POIGNEES.map((poignee) => (
        <button
          key={poignee.id}
          type="button"
          data-poignee={poignee.id}
          aria-label={`Redimensionner par le coin ${poignee.label}`}
          onPointerDown={(event) => commencer(event, "agrandir")}
          className={cn(
            "absolute grid size-11 place-items-center rounded-full",
            poignee.place,
            poignee.curseur,
          )}
          style={{ touchAction: "none" }}
        >
          <span
            aria-hidden
            className="size-3.5 rounded-full border-2 border-primary bg-surface-lowest elevation-1"
          />
        </button>
      ))}

      <span aria-hidden className="absolute bottom-full left-1/2 h-5 w-0.5 -translate-x-1/2 bg-primary" />
      <button
        type="button"
        data-poignee="rotation"
        aria-label="Tourner la sélection"
        onPointerDown={(event) => commencer(event, "tourner")}
        className="absolute bottom-full left-1/2 mb-3 grid size-11 -translate-x-1/2 cursor-grab place-items-center rounded-full"
        style={{ touchAction: "none" }}
      >
        <span
          aria-hidden
          className="grid size-7 place-items-center rounded-full bg-primary text-on-primary elevation-1"
        >
          <RotateCw className="size-4" />
        </span>
      </button>

      {barre && !transfo ? (
        // Sous le cadre : au-dessus, la pastille de rotation occupe déjà la
        // place. Elle se contre-tourne pour rester lisible.
        <div
          className="absolute left-1/2 top-full z-10 mt-3 -translate-x-1/2"
          style={{ transform: t.angle ? `translateX(-50%) rotate(${-t.angle}rad)` : undefined }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {barre}
        </div>
      ) : null}
    </div>
  );
}
