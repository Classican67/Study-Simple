"use client";

import * as React from "react";
import { Eraser, Pen, Redo2, Trash2, Undo2 } from "lucide-react";

import { cn } from "@/lib/utils";
import { DEFAULT_RATIO, type DrawingContent, type Stroke } from "@/lib/notes";

/**
 * Prise de notes manuscrite, au stylet.
 *
 * Trois choix déterminent la qualité du tracé :
 *
 * 1. **Pointer Events**, et non Touch Events : c'est la seule interface qui
 *    donne le type de pointeur et la pression. Un Apple Pencil arrive en
 *    `pointerType: "pen"` avec une pression de 0 à 1.
 * 2. **`getCoalescedEvents`** : l'iPad échantillonne le stylet à 240 Hz mais
 *    ne déclenche l'événement qu'à 60. Sans les points intermédiaires, un
 *    trait rapide devient une ligne brisée.
 * 3. **Rejet de la paume** : dès qu'un stylet a servi, le doigt cesse de
 *    dessiner. Autrement la main posée sur l'écran laisse des traces — c'est
 *    le défaut qui rend une application de note inutilisable sur tablette.
 *
 * Les coordonnées sont enregistrées en proportion de la largeur (0 à 1) : le
 * même croquis se relit sur un téléphone comme sur un iPad.
 */

const INKS = [
  { name: "default", label: "Encre" },
  { name: "rose", label: "Rouge" },
  { name: "amber", label: "Orange" },
  { name: "emerald", label: "Vert" },
  { name: "blue", label: "Bleu" },
  { name: "violet", label: "Violet" },
] as const;

const SIZES = [
  { size: 1.5, label: "Fin" },
  { size: 3, label: "Moyen" },
  { size: 6, label: "Épais" },
];

export function DrawingBlock({
  content,
  onChange,
  readOnly = false,
}: {
  content: DrawingContent;
  onChange: (next: DrawingContent) => void;
  readOnly?: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const [ink, setInk] = React.useState<string>("default");
  const [size, setSize] = React.useState(3);
  const [erasing, setErasing] = React.useState(false);

  // Une fois un stylet vu, le doigt ne dessine plus : c'est le rejet de la
  // paume. Un `ref` et non un état — le changement ne doit rien re-rendre au
  // milieu d'un tracé.
  const penSeen = React.useRef(false);
  const [penMode, setPenMode] = React.useState(false);

  // Le trait en cours n'est pas dans l'état : le stocker déclencherait un
  // rendu React par point, soit des centaines par seconde.
  const drawing = React.useRef<Stroke | null>(null);
  const strokes = React.useRef<Stroke[]>(content.strokes);
  const undone = React.useRef<Stroke[]>([]);
  const [version, setVersion] = React.useState(0);
  // Le nombre de traits sert au libellé accessible, donc au rendu : il ne peut
  // pas vivre dans un `ref`, qu'on n'a pas le droit de lire pendant le rendu.
  const [strokeCount, setStrokeCount] = React.useState(content.strokes.length);

  /** Redemande un rendu après une modification des traits. */
  const bump = React.useCallback(() => {
    setVersion((v) => v + 1);
    setStrokeCount(strokes.current.length);
  }, []);

  // Le contenu peut changer sous nos pieds : chargement initial, annulation
  // venue du parent. On ne réaligne que si l'on ne dessine pas.
  React.useEffect(() => {
    if (drawing.current) return;
    strokes.current = content.strokes;
    bump();
  }, [content, bump]);

  const ratio = content.ratio || DEFAULT_RATIO;

  /** Redessine tout. Appelé au montage, au redimensionnement, à chaque trait. */
  const repaint = React.useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // Un canevas flou est le premier reproche fait à une app de dessin : on
    // suit la densité de l'écran, plafonnée pour ne pas exploser la mémoire.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    const colorOf = (name: string) =>
      styles.getPropertyValue(`--ink-${name}`).trim() || styles.color;

    context.lineCap = "round";
    context.lineJoin = "round";

    const all = drawing.current ? [...strokes.current, drawing.current] : strokes.current;
    for (const stroke of all) {
      context.strokeStyle = colorOf(stroke.color);
      paintStroke(context, stroke, width);
    }
  }, []);

  React.useEffect(() => {
    repaint();
  }, [repaint, version]);

  // Le bloc s'élargit avec la fenêtre ; les coordonnées étant relatives, il
  // suffit de redessiner.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => repaint());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [repaint]);

  // Le thème peut changer pendant l'édition : les encres sont des variables
  // CSS, il faut relire leur valeur.
  React.useEffect(() => {
    const observer = new MutationObserver(() => repaint());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [repaint]);

  function commit() {
    onChange({ ratio, strokes: strokes.current });
  }

  function accepts(event: React.PointerEvent): boolean {
    if (readOnly) return false;
    if (event.pointerType === "pen") return true;
    // Le doigt ne dessine plus dès qu'un stylet a servi.
    if (event.pointerType === "touch") return !penSeen.current;
    return true;
  }

  function pointOf(event: PointerEvent | React.PointerEvent, rect: DOMRect): number[] {
    // Rapportés à la largeur dans les deux axes : sans cela, un croquis
    // s'étirerait verticalement en changeant de format d'écran.
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.width;
    // Une souris annonce une pression nulle : on la traite comme un appui
    // moyen, sinon son trait serait invisible.
    const pressure = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5;
    return [round(x), round(y), Math.round(pressure * 100) / 100];
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!accepts(event)) return;
    if (event.pointerType === "pen" && !penSeen.current) {
      penSeen.current = true;
      setPenMode(true);
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();

    if (erasing) {
      eraseAt(pointOf(event, rect));
      return;
    }

    drawing.current = { color: ink, size, points: pointOf(event, rect) };
    bump();
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    if (erasing) {
      if (event.buttons > 0 && accepts(event)) eraseAt(pointOf(event, rect));
      return;
    }
    if (!drawing.current) return;

    // Les points intermédiaires que le navigateur a regroupés : c'est ce qui
    // sépare un trait lisse d'une ligne brisée sur un tracé rapide.
    const events =
      typeof event.nativeEvent.getCoalescedEvents === "function"
        ? event.nativeEvent.getCoalescedEvents()
        : [event.nativeEvent];
    for (const e of events.length > 0 ? events : [event.nativeEvent]) {
      drawing.current.points.push(...pointOf(e, rect));
    }
    repaint();
  }

  function onPointerUp() {
    if (!drawing.current) return;
    // Un simple appui ne laisse rien : deux points identiques ne font pas un
    // trait, et une pointe posée par mégarde ne doit pas marquer la page.
    if (drawing.current.points.length >= 6) {
      strokes.current = [...strokes.current, drawing.current];
      undone.current = [];
      drawing.current = null;
      bump();
      commit();
    } else {
      drawing.current = null;
      bump();
    }
  }

  /** Gomme : retire le trait dont un point passe sous le curseur. */
  function eraseAt(point: number[]) {
    const seuil = 0.02;
    const kept = strokes.current.filter((stroke) => {
      for (let i = 0; i < stroke.points.length; i += 3) {
        const dx = stroke.points[i] - point[0];
        const dy = stroke.points[i + 1] - point[1];
        if (dx * dx + dy * dy < seuil * seuil) return false;
      }
      return true;
    });
    if (kept.length === strokes.current.length) return;
    strokes.current = kept;
    bump();
    commit();
  }

  function undo() {
    const last = strokes.current.at(-1);
    if (!last) return;
    undone.current = [...undone.current, last];
    strokes.current = strokes.current.slice(0, -1);
    bump();
    commit();
  }

  function redo() {
    const last = undone.current.at(-1);
    if (!last) return;
    undone.current = undone.current.slice(0, -1);
    strokes.current = [...strokes.current, last];
    bump();
    commit();
  }

  function clear() {
    if (strokes.current.length === 0) return;
    undone.current = [...strokes.current].reverse();
    strokes.current = [];
    bump();
    commit();
  }

  return (
    <div className="space-y-2">
      {!readOnly ? (
        <div className="flex flex-wrap items-center gap-1">
          <div role="group" aria-label="Couleur d'encre" className="flex items-center gap-0.5">
            {INKS.map((entry) => (
              <button
                key={entry.name}
                type="button"
                onClick={() => {
                  setInk(entry.name);
                  setErasing(false);
                }}
                aria-label={entry.label}
                aria-pressed={!erasing && ink === entry.name}
                title={entry.label}
                className="grid size-11 place-items-center rounded-full"
              >
                <span
                  className={cn(
                    "block rounded-full transition-all",
                    !erasing && ink === entry.name ? "size-6 ring-2 ring-primary ring-offset-2 ring-offset-surface" : "size-5",
                  )}
                  style={{ backgroundColor: `var(--ink-${entry.name})` }}
                />
              </button>
            ))}
          </div>

          <div role="group" aria-label="Épaisseur" className="ml-1 flex items-center gap-0.5">
            {SIZES.map((entry) => (
              <button
                key={entry.size}
                type="button"
                onClick={() => {
                  setSize(entry.size);
                  setErasing(false);
                }}
                aria-label={entry.label}
                aria-pressed={!erasing && size === entry.size}
                title={entry.label}
                className={cn(
                  "grid size-11 place-items-center rounded-full transition-colors",
                  !erasing && size === entry.size ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant",
                )}
              >
                <span
                  className="block rounded-full bg-current"
                  style={{ width: entry.size * 2.5, height: entry.size * 2.5 }}
                />
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setErasing((e) => !e)}
            aria-pressed={erasing}
            aria-label="Gomme"
            title="Gomme"
            className={cn(
              "ml-1 grid size-11 place-items-center rounded-full transition-colors",
              erasing ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant",
            )}
          >
            <Eraser className="size-5" />
          </button>

          <div className="ml-auto flex items-center gap-0.5">
            {penMode ? (
              <span
                title="Un stylet a été détecté : le doigt ne dessine plus, pour ne pas marquer la page avec la paume."
                className="mr-1 flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1.5 m3-label-small text-on-surface-variant"
              >
                <Pen className="size-3.5" />
                Stylet
              </span>
            ) : null}
            <button
              type="button"
              onClick={undo}
              aria-label="Annuler le dernier trait"
              title="Annuler"
              className="grid size-11 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface"
            >
              <Undo2 className="size-5" />
            </button>
            <button
              type="button"
              onClick={redo}
              aria-label="Rétablir le trait annulé"
              title="Rétablir"
              className="grid size-11 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface"
            >
              <Redo2 className="size-5" />
            </button>
            <button
              type="button"
              onClick={clear}
              aria-label="Effacer tout le croquis"
              title="Tout effacer"
              className="grid size-11 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-error"
            >
              <Trash2 className="size-5" />
            </button>
          </div>
        </div>
      ) : null}

      <canvas
        ref={canvasRef}
        data-testid="drawing-canvas"
        role="img"
        aria-label={`Croquis manuscrit, ${strokeCount} trait${strokeCount > 1 ? "s" : ""}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={onPointerUp}
        // `touch-none` : sans lui le navigateur interprète le geste comme un
        // défilement et le tracé s'interrompt dès le premier mouvement.
        className={cn(
          "w-full touch-none rounded-xl border border-outline-variant bg-surface-lowest text-on-surface",
          !readOnly && (erasing ? "cursor-cell" : "cursor-crosshair"),
        )}
        style={{ aspectRatio: `1 / ${ratio}` }}
      />
    </div>
  );
}

/** Trace un trait, l'épaisseur suivant la pression relevée. */
function paintStroke(context: CanvasRenderingContext2D, stroke: Stroke, width: number) {
  const points = stroke.points;
  if (points.length < 6) {
    // Un point isolé : un rond, pour qu'un appui bref laisse tout de même
    // une marque visible.
    if (points.length === 3) {
      context.beginPath();
      context.arc(points[0] * width, points[1] * width, (stroke.size * points[2]) / 2, 0, Math.PI * 2);
      context.fillStyle = context.strokeStyle;
      context.fill();
    }
    return;
  }

  // Segment par segment plutôt qu'un seul chemin : c'est ce qui permet à
  // l'épaisseur de suivre la pression le long du trait.
  for (let i = 3; i < points.length; i += 3) {
    const x1 = points[i - 3] * width;
    const y1 = points[i - 2] * width;
    const x2 = points[i] * width;
    const y2 = points[i + 1] * width;
    context.lineWidth = Math.max(0.4, stroke.size * ((points[i - 1] + points[i + 2]) / 2));
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
  }
}

/** Trois décimales : au pixel près sur un écran large, et six fois plus léger. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
