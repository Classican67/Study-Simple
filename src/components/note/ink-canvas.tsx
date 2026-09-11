"use client";

import * as React from "react";
import { getStroke } from "perfect-freehand";

import { DEFAULT_RATIO, MAX_RATIO, type DrawingContent, type Paper, type Stroke, type Tool } from "@/lib/notes";
import { cn } from "@/lib/utils";

/**
 * Surface d'écriture manuscrite.
 *
 * Ce qui sépare un croquis d'une vraie prise de notes tient à trois choses :
 *
 * 1. **La forme du trait.** Une suite de segments d'épaisseur variable donne un
 *    trait anguleux et granuleux. `perfect-freehand` calcule le *contour* du
 *    trait à partir des points et de la pression, et on le remplit : c'est ce
 *    qui donne une encre qui s'épaissit et s'affine comme une plume.
 * 2. **Les points intermédiaires.** L'iPad échantillonne le stylet à 240 Hz
 *    mais ne déclenche l'événement qu'à 60. `getCoalescedEvents` les récupère ;
 *    sans eux, un trait rapide devient une ligne brisée.
 * 3. **Le rejet de la paume.** Dès qu'un stylet a servi, le doigt cesse
 *    d'écrire et sert à faire défiler. C'est ce qui permet de poser la main sur
 *    l'écran, donc d'écrire vraiment.
 *
 * Les coordonnées sont enregistrées en proportion de la **largeur** (0 à 1) :
 * la même page se relit sur un téléphone comme sur un iPad.
 */

export type InkTool = Tool | "eraser";

const OPTIONS = {
  pen: { thinning: 0.62, smoothing: 0.5, streamline: 0.42 },
  // Un surligneur ne varie pas d'épaisseur et ne s'effile pas : c'est un feutre
  // à pointe biseautée, pas une plume.
  highlighter: { thinning: 0, smoothing: 0.62, streamline: 0.5 },
} as const;

export function InkCanvas({
  content,
  onChange,
  tool,
  color,
  size,
  className,
  /** En plein écran, la page s'allonge quand on écrit près du bas. */
  growable = true,
  readOnly = false,
  onStrokeCount,
  onPenMode,
  onView,
}: {
  content: DrawingContent;
  onChange: (next: DrawingContent) => void;
  tool: InkTool;
  color: string;
  size: number;
  className?: string;
  growable?: boolean;
  readOnly?: boolean;
  onStrokeCount?: (count: number) => void;
  /** Prévient que le rejet de la paume s'est enclenché. */
  onPenMode?: (active: boolean) => void;
  /**
   * Facteur de zoom courant, prévenu depuis le geste lui-même.
   *
   * Le rapporter depuis un effet déclencherait un rendu du parent en cascade
   * après chaque rendu du canevas ; l'annoncer là où la valeur change coûte un
   * rendu, pas deux.
   *
   * La remise à zéro, elle, se fait en remontant le composant depuis le parent
   * (`key`) : rien à réinitialiser à la main, et les traits viennent de toute
   * façon du contenu.
   */
  onView?: (scale: number) => void;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  // Le trait en cours ne vit pas dans l'état : l'y mettre déclencherait un rendu
  // React par point, soit des centaines par seconde.
  const drawing = React.useRef<Stroke | null>(null);
  const strokes = React.useRef<Stroke[]>(content.strokes);
  const [version, setVersion] = React.useState(0);
  // Le nombre de traits sert au libellé accessible, donc au rendu : il ne peut
  // pas vivre dans un `ref`, qu'on n'a pas le droit de lire pendant le rendu.
  const [count, setCount] = React.useState(content.strokes.length);

  // Une fois un stylet vu, le doigt ne dessine plus : c'est le rejet de la paume.
  const penSeen = React.useRef(false);
  const [penMode, setPenMode] = React.useState(false);

  /*
   * Zoom et déplacement.
   *
   * Indispensable sur iPad : on écrit gros, puis on recule pour voir la page
   * entière. La transformation est appliquée en CSS sur le canevas lui-même —
   * et non au contexte de dessin — parce que les coordonnées sont calculées à
   * partir de `getBoundingClientRect()`, qui reflète déjà la transformation.
   * Le calcul du tracé reste donc identique, à n'importe quel niveau de zoom.
   */
  const [view, setView] = React.useState({ scale: 1, x: 0, y: 0 });
  // Doigts posés. Deux ou plus : on manipule la vue, on ne trace pas.
  const touches = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{ distance: number; x: number; y: number; scale: number } | null>(null);

  const ratio = content.ratio || DEFAULT_RATIO;
  const paper = content.paper ?? "blank";

  const bump = React.useCallback(() => {
    setVersion((v) => v + 1);
    setCount(strokes.current.length);
    onStrokeCount?.(strokes.current.length);
  }, [onStrokeCount]);

  React.useEffect(() => {
    if (drawing.current) return;
    strokes.current = content.strokes;
    bump();
  }, [content, bump]);

  /** Redessine tout. Appelé au montage, au redimensionnement, à chaque trait. */
  const repaint = React.useCallback(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    // Un canevas flou est le premier reproche fait à une application d'écriture.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, width, height);

    const styles = getComputedStyle(canvas);
    const colorOf = (name: string) => styles.getPropertyValue(`--ink-${name}`).trim() || styles.color;

    const all = drawing.current ? [...strokes.current, drawing.current] : strokes.current;
    // Les surligneurs passent sous l'encre, comme sur le papier : on surligne un
    // texte déjà écrit, et le trait ne doit pas le voiler.
    for (const stroke of [...all].sort((a, b) => rank(a) - rank(b))) {
      paintStroke(context, stroke, width, colorOf(stroke.color));
    }
  }, []);

  React.useEffect(() => {
    repaint();
  }, [repaint, version, paper]);

  // La page s'élargit avec la fenêtre ; les coordonnées étant relatives, il
  // suffit de redessiner.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => repaint());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [repaint]);

  // Le thème peut changer pendant l'écriture : les encres sont des variables CSS.
  React.useEffect(() => {
    const observer = new MutationObserver(() => repaint());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [repaint]);

  function commit(nextRatio = ratio) {
    onChange({ ratio: nextRatio, paper, strokes: strokes.current });
  }

  function accepts(event: React.PointerEvent): boolean {
    if (readOnly) return false;
    if (event.pointerType === "pen") return true;
    // Le doigt ne dessine plus dès qu'un stylet a servi : il fait défiler.
    if (event.pointerType === "touch") return !penSeen.current;
    return true;
  }

  function pointOf(event: PointerEvent | React.PointerEvent, rect: DOMRect): number[] {
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.width;
    // Une souris annonce une pression nulle : on la traite comme un appui moyen,
    // sinon son trait serait invisible.
    const pressure = event.pointerType === "pen" && event.pressure > 0 ? event.pressure : 0.5;
    return [round(x), round(y), Math.round(pressure * 100) / 100];
  }

  /** Centre et écartement des doigts posés. */
  function pinch() {
    const points = [...touches.current.values()];
    const x = points.reduce((s, p) => s + p.x, 0) / points.length;
    const y = points.reduce((s, p) => s + p.y, 0) / points.length;
    const distance =
      points.length >= 2 ? Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y) : 0;
    return { x, y, distance };
  }

  function onPointerDown(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "touch") {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.current.size >= 2) {
        // Un second doigt : ce n'est plus un tracé, c'est un geste. Le trait
        // commencé par mégarde est abandonné plutôt que laissé à moitié.
        drawing.current = null;
        const { x, y, distance } = pinch();
        gesture.current = { distance, x, y, scale: view.scale };
        setVersion((v) => v + 1);
        return;
      }
    }

    if (!accepts(event)) return;
    if (event.pointerType === "pen" && !penSeen.current) {
      penSeen.current = true;
      setPenMode(true);
      onPenMode?.(true);
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const rect = event.currentTarget.getBoundingClientRect();

    if (tool === "eraser") {
      eraseAt(pointOf(event, rect));
      return;
    }
    drawing.current = { color, size, tool, points: pointOf(event, rect) };
    setVersion((v) => v + 1);
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "touch" && touches.current.has(event.pointerId)) {
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (gesture.current && touches.current.size >= 2) {
        const { x, y, distance } = pinch();
        const depart = gesture.current;
        // Bornes : au-delà, on ne retrouve plus sa page.
        const scale = Math.min(6, Math.max(0.5, (depart.scale * distance) / (depart.distance || 1)));
        setView((v) => ({ scale, x: v.x + (x - depart.x), y: v.y + (y - depart.y) }));
        onView?.(scale);
        gesture.current = { ...depart, x, y };
        return;
      }

      // Un seul doigt, stylet déjà vu : il déplace la page au lieu d'écrire.
      if (penSeen.current && touches.current.size === 1 && !drawing.current) {
        const point = touches.current.get(event.pointerId)!;
        setView((v) => ({ ...v, x: v.x + event.movementX, y: v.y + event.movementY }));
        touches.current.set(event.pointerId, point);
        return;
      }
    }

    const rect = event.currentTarget.getBoundingClientRect();
    if (tool === "eraser") {
      if (event.buttons > 0 && accepts(event)) eraseAt(pointOf(event, rect));
      return;
    }
    if (!drawing.current) return;

    const events =
      typeof event.nativeEvent.getCoalescedEvents === "function"
        ? event.nativeEvent.getCoalescedEvents()
        : [event.nativeEvent];
    for (const e of events.length > 0 ? events : [event.nativeEvent]) {
      drawing.current.points.push(...pointOf(e, rect));
    }
    repaint();
  }

  function onPointerUp(event?: React.PointerEvent<HTMLCanvasElement>) {
    if (event?.pointerType === "touch") {
      touches.current.delete(event.pointerId);
      if (touches.current.size < 2) gesture.current = null;
    }

    const trait = drawing.current;
    drawing.current = null;
    if (!trait) return;

    // Un simple appui ne laisse rien : une pointe posée par mégarde ne doit pas
    // marquer la page.
    if (trait.points.length < 6) {
      setVersion((v) => v + 1);
      return;
    }

    strokes.current = [...strokes.current, trait];
    bump();

    /*
     * La page s'allonge quand on approche du bas, comme un cahier qu'on
     * déroule. Sans cela il faudrait décider de la hauteur avant d'écrire —
     * exactement ce qu'on ne sait jamais.
     */
    const bas = maxY(trait);
    const nouveauRatio = growable && bas > ratio - 0.12 ? Math.min(MAX_RATIO, bas + 0.45) : ratio;
    commit(nouveauRatio);
  }

  /** Gomme : retire le trait dont un point passe sous la pointe. */
  function eraseAt(point: number[]) {
    const seuil = 0.018;
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

  return (
    <canvas
      ref={canvasRef}
      data-testid="drawing-canvas"
      data-pen-mode={penMode ? "true" : "false"}
      role="img"
      aria-label={`Page manuscrite, ${count} trait${count > 1 ? "s" : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onPointerLeave={onPointerUp}
      className={cn(
        "w-full bg-surface-lowest text-on-surface",
        paperClass(paper),
        !readOnly && (tool === "eraser" ? "cursor-cell" : "cursor-crosshair"),
        className,
      )}
      style={{
        aspectRatio: `1 / ${ratio}`,
        transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
        transformOrigin: "center top",
        // Sans cela, le navigateur applique sa propre inertie au geste et la
        // page saute pendant qu'on pince.
        touchAction: "none",
      }}
    />
  );
}

/** Classe du fond de page. Les lignes sont dessinées en CSS, pas au canevas :
 *  elles ne font pas partie du contenu et ne doivent pas peser à l'export. */
export function paperClass(paper: Paper): string {
  switch (paper) {
    case "ruled":
      return "paper-ruled";
    case "grid":
      return "paper-grid";
    case "dots":
      return "paper-dots";
    default:
      return "";
  }
}

/** Le surligneur passe sous l'encre. */
function rank(stroke: Stroke): number {
  return stroke.tool === "highlighter" ? 0 : 1;
}

function maxY(stroke: Stroke): number {
  let max = 0;
  for (let i = 1; i < stroke.points.length; i += 3) max = Math.max(max, stroke.points[i]);
  return max;
}

/**
 * Trace un trait en remplissant son contour.
 *
 * `getStroke` rend une enveloppe fermée qui suit la pression : la remplir donne
 * une encre qui s'épaissit et s'affine, là où une ligne d'épaisseur variable
 * laisse des angles à chaque changement.
 */
function paintStroke(
  context: CanvasRenderingContext2D,
  stroke: Stroke,
  width: number,
  color: string,
) {
  const points: number[][] = [];
  for (let i = 0; i < stroke.points.length; i += 3) {
    points.push([stroke.points[i] * width, stroke.points[i + 1] * width, stroke.points[i + 2]]);
  }
  if (points.length === 0) return;

  const tool = stroke.tool ?? "pen";
  const outline = getStroke(points, {
    size: stroke.size * (tool === "highlighter" ? 4 : 1),
    ...OPTIONS[tool],
    // Un trait terminé : les extrémités sont fermées, sinon l'enveloppe reste
    // ouverte et le remplissage fuit.
    last: true,
  });
  if (outline.length < 3) return;

  context.save();
  // Le surligneur laisse voir ce qu'il recouvre, et ne se cumule pas sur
  // lui-même à chaque aller-retour du poignet.
  context.globalAlpha = tool === "highlighter" ? 0.32 : 1;
  context.fillStyle = color;

  context.beginPath();
  context.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    // Courbes plutôt que segments : le contour compte des dizaines de points,
    // et les relier droit rendrait visible sa facettisation.
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    context.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  context.closePath();
  context.fill();
  context.restore();
}

/** Trois décimales : au pixel près sur un écran large, et six fois plus léger. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
