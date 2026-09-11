"use client";

import * as React from "react";
import { getStroke } from "perfect-freehand";

import {
  boundsOf,
  snapShape,
  snapStrokeToRuler,
  strokeInLasso,
  translateStroke,
  unionBounds,
  type Point,
  type Ruler,
  type Shape,
} from "@/lib/ink";
import { DEFAULT_RATIO, MAX_RATIO, type DrawingContent, type Paper, type Stroke, type Tool } from "@/lib/notes";
import { PdfPage } from "@/components/note/pdf-page";
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

export type InkTool = Tool | "eraser" | "lasso" | "shape";

/** Largeur de la règle, en proportion de la page. */
const RULER_THICKNESS = 0.055;

/** Le point tombe-t-il sur la règle ? */
function nearRuler(point: number[], ruler: Ruler): boolean {
  const dx = Math.cos(ruler.angle);
  const dy = Math.sin(ruler.angle);
  // Distance perpendiculaire au bord d'appui, du bon côté seulement.
  const profondeur = -(point[0] - 0.5) * dy + (point[1] - ruler.y) * dx;
  return profondeur >= -0.006 && profondeur <= RULER_THICKNESS;
}

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
  shape = "rect",
  color,
  size,
  className,
  /** En plein écran, la page s'allonge quand on écrit près du bas. */
  growable = true,
  /** Hauteur visible. Sans elle, la fenêtre prend la hauteur de la page. */
  height,
  readOnly = false,
  onStrokeCount,
  onPenMode,
  onView,
  selection = [],
  onSelect,
  ruler = null,
  onRuler,
  eraseHighlightsOnly = false,
  penOnly = false,
}: {
  content: DrawingContent;
  onChange: (next: DrawingContent) => void;
  tool: InkTool;
  /** Forme tracée quand l'outil est « shape ». */
  shape?: Shape;
  color: string;
  size: number;
  className?: string;
  growable?: boolean;
  height?: number;
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
  /**
   * Traits retenus par le lasso, par leur rang.
   *
   * La sélection appartient au parent : c'est lui qui propose de la supprimer,
   * et supprimer revient à réécrire la liste des traits, ce qu'il fait déjà
   * pour l'annulation. La garder ici obligerait à une interface impérative,
   * donc à muter une référence pendant le rendu.
   */
  selection?: number[];
  onSelect?: (indices: number[]) => void;
  /**
   * Règle posée sur la page, ou absente.
   *
   * Ce n'est pas un outil au sens des autres : on continue d'écrire au stylo,
   * et les traits qui passent près d'elle se redressent — comme une vraie règle
   * sur laquelle on appuie le crayon.
   */
  ruler?: Ruler | null;
  onRuler?: (ruler: Ruler) => void;
  /** La gomme ne retire que les surlignages, en laissant l'écriture. */
  eraseHighlightsOnly?: boolean;
  /** Le doigt n'écrit jamais, même avant qu'un stylet ait servi. */
  penOnly?: boolean;
}) {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  // Largeur mesurée de la page, en pixels. Sert à convertir les coordonnées,
  // qui sont enregistrées en proportion de cette largeur.
  const [width, setWidth] = React.useState(0);

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

  /*
   * Lasso : le tracé en cours, puis les traits retenus.
   *
   * Les traits retenus sont désignés par leur **rang** et non par référence :
   * ils sont remplacés à chaque déplacement, une référence deviendrait périmée.
   */
  const lasso = React.useRef<Point[] | null>(null);
  // Manipulation de la règle : « move » la translate, « rotate » l'oriente.
  const rulerDrag = React.useRef<"move" | "rotate" | null>(null);
  // Déplacement d'une sélection : point de départ, en coordonnées de page.
  const moving = React.useRef<{ x: number; y: number } | null>(null);
  // Doigts posés. Deux ou plus : on manipule la vue, on ne trace pas.
  const touches = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{ distance: number; x: number; y: number; scale: number } | null>(null);

  const ratio = content.ratio || DEFAULT_RATIO;
  const paper = content.paper ?? "blank";
  const backdrop = content.backdrop ?? null;
  // Hauteur totale de la page, et hauteur de la fenêtre qui la montre.
  const pageHeight = Math.round(width * ratio);
  const viewport = height ?? Math.min(pageHeight, 900);

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
    const scroller = scrollRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context || !scroller) return;

    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (w === 0 || h === 0) return;

    // La densité est plafonnée, et le canevas ne fait jamais que la taille de
    // la fenêtre : on reste loin des limites de Safari.
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const top = scroller.scrollTop;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, w, h);
    // Décalage du défilement : seul ce qui est visible est dessiné.
    context.translate(0, -top);

    const styles = getComputedStyle(canvas);
    const colorOf = (name: string) => styles.getPropertyValue(`--ink-${name}`).trim() || styles.color;

    const all = drawing.current ? [...strokes.current, drawing.current] : strokes.current;
    // Les surligneurs passent sous l'encre, comme sur le papier : on surligne un
    // texte déjà écrit, et le trait ne doit pas le voiler.
    for (const stroke of [...all].sort((a, b) => rank(a) - rank(b))) {
      // Hors de la fenêtre : rien à peindre. C'est ce qui permet à une page de
      // plusieurs milliers de traits de rester fluide.
      const b = boundsOf(stroke.points);
      if (b && (b.maxY * w < top - 0.05 * w || b.minY * w > top + h + 0.05 * w)) continue;
      paintStroke(context, stroke, w, colorOf(stroke.color));
    }

    // La règle, par-dessus tout le reste : c'est un objet posé sur la page.
    if (ruler) {
      const cx = w / 2;
      const cy = ruler.y * w;
      const demi = w;
      const epaisseur = RULER_THICKNESS * w;
      context.save();
      context.translate(cx, cy);
      context.rotate(ruler.angle);
      context.fillStyle = styles.getPropertyValue("--color-primary").trim() || "#7c3aed";
      context.globalAlpha = 0.12;
      context.fillRect(-demi, 0, demi * 2, epaisseur);
      context.globalAlpha = 0.85;
      context.fillRect(-demi, 0, demi * 2, 1.5);
      context.globalAlpha = 0.5;
      for (let x = -demi; x <= demi; x += w / 20) {
        const haut = Math.round(x / (w / 20)) % 5 === 0 ? epaisseur * 0.5 : epaisseur * 0.28;
        context.fillRect(x, 1.5, 1, haut);
      }
      context.restore();
    }

    // Le lasso en cours de tracé : pointillés, comme partout.
    const trace = lasso.current;
    if (trace && trace.length > 1) {
      context.save();
      context.setLineDash([6, 5]);
      context.lineWidth = 1.5;
      context.strokeStyle = styles.getPropertyValue("--color-primary").trim() || "#7c3aed";
      context.beginPath();
      context.moveTo(trace[0].x * w, trace[0].y * w);
      for (const point of trace.slice(1)) context.lineTo(point.x * w, point.y * w);
      context.closePath();
      context.stroke();
      context.restore();
    }

    // Le cadre de la sélection, pour montrer ce qu'on s'apprête à déplacer.
    const retenus = selection.map((i) => strokes.current[i]?.points).filter(Boolean);
    const cadre = unionBounds(retenus as number[][]);
    if (cadre) {
      const marge = 0.012;
      context.save();
      context.setLineDash([5, 4]);
      context.lineWidth = 1.5;
      context.strokeStyle = styles.getPropertyValue("--color-primary").trim() || "#7c3aed";
      context.strokeRect(
        (cadre.minX - marge) * w,
        (cadre.minY - marge) * w,
        (cadre.maxX - cadre.minX + marge * 2) * w,
        (cadre.maxY - cadre.minY + marge * 2) * w,
      );
      context.restore();
    }
    // `selection` et `ruler` sont des dépendances réelles : elles se dessinent.
  }, [selection, ruler]);

  React.useEffect(() => {
    repaint();
  }, [repaint, version, paper]);

  // La page s'élargit avec la fenêtre ; les coordonnées étant relatives, il
  // suffit de redessiner.
  React.useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => {
      setWidth(canvas.clientWidth);
      repaint();
    });
    observer.observe(canvas);
    setWidth(canvas.clientWidth);
    return () => observer.disconnect();
  }, [repaint]);

  // Le thème peut changer pendant l'écriture : les encres sont des variables CSS.
  React.useEffect(() => {
    const observer = new MutationObserver(() => repaint());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [repaint]);

  function commit(nextRatio = ratio) {
    // Le contenu est **étendu**, jamais reconstruit champ par champ : une
    // reconstruction oubliait le document de fond, et le premier trait
    // enregistré effaçait le PDF qu'on venait d'annoter.
    onChange({ ...content, ratio: nextRatio, strokes: strokes.current });
  }

  function accepts(event: React.PointerEvent): boolean {
    if (readOnly) return false;
    if (event.pointerType === "pen") return true;
    // Le doigt ne dessine plus dès qu'un stylet a servi — ou dès que le verrou
    // est posé, pour pouvoir appuyer la main avant même d'approcher le stylet.
    if (event.pointerType === "touch") return !penSeen.current && !penOnly;
    return true;
  }

  function pointOf(event: PointerEvent | React.PointerEvent, rect: DOMRect): number[] {
    // Le canevas ne montre qu'une fenêtre de la page : la position dans la
    // page ajoute le défilement.
    const top = scrollRef.current?.scrollTop ?? 0;
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top + top) / rect.width;
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

    const point = pointOf(event, rect);

    /*
     * La règle se saisit à la main, pas au stylet.
     *
     * C'est la répartition d'une vraie règle : le crayon écrit le long du
     * bord, la main la déplace. Sans cette distinction, poser la pointe sur la
     * règle pour tracer la ferait glisser — le contraire de ce qu'on veut.
     */
    if (ruler && onRuler && event.pointerType !== "pen" && nearRuler(point, ruler)) {
      // Le tiers extérieur oriente, le centre translate — comme on ferait
      // pivoter une vraie règle en la tenant par un bout.
      const long = Math.abs((point[0] - 0.5) * Math.cos(ruler.angle) + (point[1] - ruler.y) * Math.sin(ruler.angle));
      rulerDrag.current = long > 0.22 ? "rotate" : "move";
      return;
    }

    if (tool === "lasso") {
      // Repartir d'une sélection existante : si l'on repose le doigt dedans,
      // c'est pour la déplacer, pas pour en tracer une autre.
      const retenus = selection.map((i) => strokes.current[i]?.points).filter(Boolean);
      const cadre = unionBounds(retenus as number[][]);
      const marge = 0.012;
      if (
        cadre &&
        point[0] >= cadre.minX - marge &&
        point[0] <= cadre.maxX + marge &&
        point[1] >= cadre.minY - marge &&
        point[1] <= cadre.maxY + marge
      ) {
        moving.current = { x: point[0], y: point[1] };
        return;
      }

      onSelect?.([]);
      lasso.current = [{ x: point[0], y: point[1] }];
      setVersion((v) => v + 1);
      return;
    }

    // Le stylo, le surligneur et les formes tracent tous de la même façon ;
    // seule la fin du geste diffère.
    drawing.current = {
      color,
      size,
      tool: tool === "shape" ? "pen" : tool,
      points: point,
    };
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
    if (rulerDrag.current && ruler && onRuler) {
      if (event.buttons === 0) return;
      const point = pointOf(event, rect);
      if (rulerDrag.current === "move") {
        onRuler({ ...ruler, y: Math.max(0, Math.min(ratio, point[1])) });
      } else {
        onRuler({ ...ruler, angle: Math.atan2(point[1] - ruler.y, point[0] - 0.5) });
      }
      return;
    }

    if (tool === "eraser") {
      if (event.buttons > 0 && accepts(event)) eraseAt(pointOf(event, rect));
      return;
    }

    if (tool === "lasso") {
      if (event.buttons === 0) return;
      const point = pointOf(event, rect);

      if (moving.current) {
        const dx = point[0] - moving.current.x;
        const dy = point[1] - moving.current.y;
        const bouge = new Set(selection);
        strokes.current = strokes.current.map((stroke, i) =>
          bouge.has(i) ? { ...stroke, points: translateStroke(stroke.points, dx, dy) } : stroke,
        );
        moving.current = { x: point[0], y: point[1] };
        repaint();
        return;
      }

      if (lasso.current) {
        lasso.current.push({ x: point[0], y: point[1] });
        repaint();
      }
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
    if (rulerDrag.current) {
      rulerDrag.current = null;
      return;
    }

    if (event?.pointerType === "touch") {
      touches.current.delete(event.pointerId);
      if (touches.current.size < 2) gesture.current = null;
    }

    // Fin d'un déplacement de sélection : on enregistre la nouvelle position.
    if (moving.current) {
      moving.current = null;
      commit();
      return;
    }

    // Fin d'un tracé de lasso : on retient ce qu'il entoure.
    if (lasso.current) {
      const polygone = lasso.current;
      lasso.current = null;
      onSelect?.(
        polygone.length >= 3
          ? strokes.current
              .map((stroke, i) => (strokeInLasso(stroke.points, polygone) ? i : -1))
              .filter((i) => i >= 0)
          : [],
      );
      setVersion((v) => v + 1);
      return;
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

    // Une forme est redressée au lâcher : l'outil est choisi avant de tracer,
    // on ne devine pas ce que le gribouillis voulait dire.
    const redresse =
      ruler && (tool === "pen" || tool === "highlighter")
        ? { ...trait, points: snapStrokeToRuler(trait.points, ruler) }
        : trait;
    const final =
      tool === "shape" ? { ...trait, points: snapShape(trait.points, shape) } : redresse;
    strokes.current = [...strokes.current, final];
    bump();

    /*
     * La page s'allonge quand on approche du bas, comme un cahier qu'on
     * déroule. Sans cela il faudrait décider de la hauteur avant d'écrire —
     * exactement ce qu'on ne sait jamais.
     */
    const bas = maxY(final);
    const nouveauRatio = growable && bas > ratio - 0.12 ? Math.min(MAX_RATIO, bas + 0.45) : ratio;
    commit(nouveauRatio);
  }

  /** Gomme : retire le trait dont un point passe sous la pointe. */
  function eraseAt(point: number[]) {
    const seuil = 0.018;
    const kept = strokes.current.filter((stroke) => {
      // Gomme sélective : on surligne beaucoup et on se trompe souvent ;
      // effacer l'écriture par la même occasion est rageant.
      if (eraseHighlightsOnly && stroke.tool !== "highlighter") return true;
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
    /*
     * Canevas **fenêtré**.
     *
     * Une page qui s'allonge atteint vite plusieurs milliers de pixels. Un
     * canevas de cette taille dépasse la limite de Safari sur iPad — 16,7 Mpx
     * et 4096 px de côté — et cesse alors de peindre quoi que ce soit : mesuré
     * à 28 656 px de haut et 68 Mpx pour une page de douze écrans.
     *
     * Le canevas fait donc la taille de la **fenêtre**, il colle en haut du
     * conteneur qui défile, et le dessin est décalé du défilement. La page
     * peut s'allonger autant qu'on veut, le canevas garde la même taille — et
     * redessiner ne coûte plus que ce qui est visible.
     *
     * Le fond de page vit sur le conteneur, pas sur le canevas : il doit
     * défiler avec le contenu, et il n'a pas de limite de taille.
     */
    <div
      ref={scrollRef}
      onScroll={() => repaint()}
      className={cn("scroll-slim relative overflow-y-auto overscroll-contain", className)}
      style={{ height: viewport }}
    >
      <div
        className={cn("relative w-full bg-surface-lowest", backdrop ? null : paperClass(paper))}
        style={{ height: `${pageHeight}px` }}
      >
        {/* Le document importé, sous les annotations. Il défile avec la page,
            et le fond de cahier s'efface : on n'annote pas un document sur du
            papier quadrillé. */}
        {backdrop ? (
          <PdfPage
            file={backdrop.file}
            page={backdrop.page}
            className="pointer-events-none absolute inset-0"
          />
        ) : null}
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
            "sticky top-0 block w-full text-on-surface",
            !readOnly && (tool === "eraser" ? "cursor-cell" : "cursor-crosshair"),
          )}
          style={{
            height: viewport,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})`,
            transformOrigin: "center top",
            // Sans cela, le navigateur applique sa propre inertie au geste et
            // la page saute pendant qu'on pince.
            touchAction: "none",
          }}
        />
      </div>
    </div>
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
