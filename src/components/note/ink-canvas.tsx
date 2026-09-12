"use client";

import * as React from "react";
import { getStroke } from "perfect-freehand";

import {
  boundsOf,
  eraseStroke,
  INK_OPTIONS,
  INK_REF,
  snapShape,
  snapStrokeToRuler,
  strokeInLasso,
  translateStroke,
  unionBounds,
  type Bounds,
  type Point,
  type Ruler,
  type Shape,
} from "@/lib/ink";
import {
  DEFAULT_RATIO,
  MAX_RATIO,
  pageAtY,
  pageBands,
  type DrawingContent,
  type Paper,
  type Stroke,
  type Tool,
} from "@/lib/notes";
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
 * Les coordonnées **et l'épaisseur** sont enregistrées en proportion de la
 * largeur de la page : la même page se relit sur un téléphone comme sur un
 * iPad, et l'export PDF calcule exactement la même géométrie.
 *
 * ## Trois couches, et pourquoi
 *
 * Tout tenait sur un seul canevas collant, redessiné en entier à chaque point
 * et à chaque événement de défilement. Trois défauts en découlaient
 * directement, et ils se corrigent par la répartition :
 *
 * - **La couche fixe** — l'encre déjà posée — vit en **tuiles placées dans la
 *   page**, pas dans la fenêtre. Faire défiler ne redessine donc *rien* : les
 *   tuiles glissent avec le papier, comme l'encre sur une feuille. C'est ce qui
 *   faisait disparaître l'écriture pendant qu'on faisait défiler un document,
 *   puis la faisait revenir rognée : la fenêtre bougeait, le dessin non.
 * - **La couche vive** ne porte que le trait en cours. Elle ne redessine que la
 *   **queue** du trait à chaque image : le coût par image ne dépend plus de la
 *   longueur du trait, là où recalculer le contour entier faisait ramer un
 *   paraphe long avant même de l'avoir fini.
 * - **La couche des repères** porte la règle, le lasso et le cadre de
 *   sélection, qui n'ont aucune raison d'être recalculés quand on écrit.
 *
 * ## Le zoom passe par la mise en page
 *
 * Agrandir le canevas en CSS — `transform: scale()` — multiplie des pixels
 * déjà tracés : à trois fois, l'écriture était crénelée comme une image
 * étirée. Ici le zoom change la **largeur de la page** ; les tuiles sont donc
 * rasterisées à la résolution réellement affichée, et le trait reste net à
 * n'importe quel niveau. C'est aussi ce qui permet au déplacement d'être un
 * vrai défilement, qui emmène le document de fond avec l'encre.
 */

export type InkTool = Tool | "eraser" | "lasso" | "shape";

/** Largeur de la règle, en proportion de la page. */
const RULER_THICKNESS = 0.055;

/**
 * Densité de rendu.
 *
 * Au-delà de deux, la mémoire vidéo double pour une netteté que l'œil ne
 * distingue plus — et sur iPad c'est la mémoire qui décide si l'onglet survit.
 */
const DPR_MAX = 2;

/** Limite de Safari pour un côté de canevas. Au-delà, il ne peint plus rien. */
const SIDE_MAX = 4096;

/** Hauteur d'une tuile, en pixels de page. */
const TILE_H = 768;

/** Fenêtre peinte en avance, en fraction de la hauteur visible. */
const OVERSCAN = 0.5;

/**
 * Nombre de tuiles gardées en mémoire.
 *
 * Chacune pèse sa surface en pixels fois quatre octets : à cinq tuiles on
 * tient dans une cinquantaine de mégaoctets, ce qui laisse la place aux pages
 * de pdf.js sur un iPad d'entrée de gamme.
 */
const TILES_MAX = 5;

const MIN_SCALE = 1;
const MAX_SCALE = 6;

/**
 * Points redessinés à chaque image du trait en cours.
 *
 * Le contour d'un trait dépend des points qui précèdent — le lissage est une
 * moyenne glissante — mais son influence décroît en `streamline` puissance n :
 * au douzième point en arrière elle est sous le millième de pixel. Redessiner
 * une queue qui recouvre les images précédentes donne donc exactement le même
 * trait, à coût constant.
 */
const LIVE_TAIL = 16;

/** Le point tombe-t-il sur la règle ? */
function nearRuler(point: number[], ruler: Ruler): boolean {
  const dx = Math.cos(ruler.angle);
  const dy = Math.sin(ruler.angle);
  // Distance perpendiculaire au bord d'appui, du bon côté seulement.
  const profondeur = -(point[0] - 0.5) * dy + (point[1] - ruler.y) * dx;
  return profondeur >= -0.006 && profondeur <= RULER_THICKNESS;
}

/*
 * Les contours sont calculés dans le repère partagé de mille unités
 * (`INK_REF`), et gardés en cache : ils ne dépendent ni du zoom ni de la taille
 * de l'écran, et l'écran calcule exactement la géométrie que l'export PDF
 * calculera. Cf. `INK_REF` dans `lib/ink.ts` pour la raison — `getStroke` n'est
 * pas invariant d'échelle.
 */
const REF = INK_REF;

/** Épaisseur du trait, dans le repère de mille unités. */
function strokeSize(stroke: Stroke): number {
  return stroke.size * ((stroke.tool ?? "pen") === "highlighter" ? 4 : 1);
}

/** La même épaisseur, en proportion de la page : pour écarter le hors-champ. */
function strokeMargin(stroke: Stroke): number {
  return strokeSize(stroke) / REF;
}

/** Le surligneur passe sous l'encre, comme sur le papier. */
function rank(stroke: Stroke): number {
  return (stroke.tool ?? "pen") === "highlighter" ? 0 : 1;
}

function strokeAlpha(stroke: Stroke): number {
  return (stroke.tool ?? "pen") === "highlighter" ? 0.32 : 1;
}

/**
 * Contour d'un trait dans le repère de mille unités, éventuellement d'un
 * morceau.
 *
 * Ne dépendant ni du zoom ni de la taille de l'écran, il est calculé une fois
 * et gardé en cache — c'est ce qui rend le redessin quasiment gratuit.
 */
function outlineOf(stroke: Stroke, depuis = 0, jusqu = Infinity): number[][] {
  const points: number[][] = [];
  const debut = Math.max(0, depuis) * 3;
  const fin = Math.min(stroke.points.length, jusqu === Infinity ? stroke.points.length : jusqu * 3);
  for (let i = debut; i + 2 < fin; i += 3) {
    points.push([stroke.points[i] * REF, stroke.points[i + 1] * REF, stroke.points[i + 2] ?? 0.5]);
  }
  if (points.length === 0) return [];
  return getStroke(points, {
    size: strokeSize(stroke),
    ...INK_OPTIONS[(stroke.tool ?? "pen") as Tool],
    // Un trait terminé : les extrémités sont fermées, sinon l'enveloppe reste
    // ouverte et le remplissage fuit.
    last: true,
  });
}

/** Chemin fermé d'un contour. Des courbes, pour ne pas voir les facettes. */
function pathOf(outline: number[][]): Path2D | null {
  if (outline.length < 3) return null;
  const path = new Path2D();
  path.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) {
    const [x0, y0] = outline[i - 1];
    const [x1, y1] = outline[i];
    path.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
  }
  path.closePath();
  return path;
}

/**
 * Contours gardés en cache, par trait.
 *
 * C'est ce qui rend le redessin gratuit : repeindre une tuile ne recalcule
 * aucune géométrie, elle ne fait que rejouer des chemins déjà construits.
 * `WeakMap` — le cache s'efface avec les traits, sans avoir à le vider.
 */
const chemins = new WeakMap<Stroke, Path2D | null>();

function cachedPath(stroke: Stroke): Path2D | null {
  if (chemins.has(stroke)) return chemins.get(stroke) ?? null;
  const path = pathOf(outlineOf(stroke));
  chemins.set(stroke, path);
  return path;
}

/** Cadres englobants gardés en cache, pour écarter vite ce qui est hors champ. */
const cadres = new WeakMap<Stroke, Bounds | null>();

function cachedBounds(stroke: Stroke): Bounds | null {
  if (cadres.has(stroke)) return cadres.get(stroke) ?? null;
  const b = boundsOf(stroke.points);
  cadres.set(stroke, b);
  return b;
}

/** Les deux cadres se touchent-ils ? La marge couvre l'épaisseur du trait. */
function overlaps(a: Bounds, b: Bounds, marge: number): boolean {
  return (
    a.maxX + marge >= b.minX &&
    a.minX - marge <= b.maxX &&
    a.maxY + marge >= b.minY &&
    a.minY - marge <= b.maxY
  );
}

/** Trois décimales : au pixel près sur un écran large, et six fois plus léger. */
function round(value: number): number {
  return Math.round(value * 1000) / 1000;
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

type Tuile = { col: number; row: number; canvas: HTMLCanvasElement; sale: boolean };

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
  scrollId,
  erasePrecise = false,
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
   */
  onView?: (scale: number) => void;
  /**
   * Traits retenus par le lasso, par leur rang.
   *
   * La sélection appartient au parent : c'est lui qui propose de la supprimer,
   * et supprimer revient à réécrire la liste des traits, ce qu'il fait déjà
   * pour l'annulation.
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
  /** La gomme coupe le trait au lieu de le retirer entier. */
  erasePrecise?: boolean;
  /** Repère de la surface, pour que le volet de pages sache où défiler. */
  scrollId?: string;
  /** Le doigt n'écrit jamais, même avant qu'un stylet ait servi. */
  penOnly?: boolean;
}) {
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const pageRef = React.useRef<HTMLDivElement>(null);
  const tilesRef = React.useRef<HTMLDivElement>(null);
  const liveRef = React.useRef<HTMLCanvasElement>(null);
  const decorRef = React.useRef<HTMLCanvasElement>(null);

  // Largeur de la page au zoom 1, en pixels : c'est la largeur disponible.
  // Les coordonnées enregistrées en sont des fractions.
  const [width, setWidth] = React.useState(0);
  const [scale, setScale] = React.useState(1);
  const [count, setCount] = React.useState(content.strokes.length);
  const [penMode, setPenMode] = React.useState(false);

  const ratio = content.ratio || DEFAULT_RATIO;
  const paper = content.paper ?? "blank";
  const bands = React.useMemo(() => pageBands(content.pages ?? []), [content.pages]);

  const pageW = Math.max(0, Math.round(width * scale));
  const pageH = Math.round(pageW * ratio);
  const viewport = height ?? Math.min(Math.round(width * ratio) || 520, 900);

  /*
   * Ce que les gestionnaires d'événements doivent lire sans passer par un
   * rendu. Un `ref` miroir plutôt que la valeur d'état : un gestionnaire de
   * `pointermove` installé au montage garderait sinon la valeur de ce
   * montage-là, et écrirait au mauvais endroit après le premier zoom.
   */
  const vue = React.useRef({ pageW: 0, pageH: 0, scale: 1, ratio });
  // Avant la peinture, et donc avant qu'un geste puisse survenir : un effet
  // ordinaire arriverait après les effets qui repeignent, qui liraient alors la
  // géométrie du rendu précédent.
  React.useLayoutEffect(() => {
    vue.current = { pageW, pageH, scale, ratio };
  }, [pageW, pageH, scale, ratio]);

  const strokes = React.useRef<Stroke[]>(content.strokes);
  /*
   * Les traits dans l'ordre de peinture, mémorisés.
   *
   * Les surligneurs passent sous l'encre : il faut donc trier. Trier à chaque
   * tuile peinte refaisait le même travail cinq fois par image.
   */
  const ordre = React.useRef<{ source: Stroke[]; liste: Stroke[] } | null>(null);
  const ordonnes = React.useCallback(() => {
    if (ordre.current?.source === strokes.current) return ordre.current.liste;
    const liste =
      strokes.current.length > 1
        ? [...strokes.current].sort((a, b) => rank(a) - rank(b))
        : strokes.current;
    ordre.current = { source: strokes.current, liste };
    return liste;
  }, []);
  const drawing = React.useRef<Stroke | null>(null);
  // Couleur résolue au poser du stylet : `getComputedStyle` à chaque image du
  // tracé coûte une consultation du style calculé par point tracé.
  const encreVive = React.useRef("#000");
  // Jusqu'où la couche vive a déjà peint le trait en cours.
  const livePeint = React.useRef(0);

  const penSeen = React.useRef(false);
  const lasso = React.useRef<Point[] | null>(null);
  const rulerDrag = React.useRef<"move" | "rotate" | null>(null);
  const moving = React.useRef<{ x: number; y: number } | null>(null);
  const touches = React.useRef(new Map<number, { x: number; y: number }>());
  const gesture = React.useRef<{ distance: number; x: number; y: number; scale: number } | null>(null);
  // Le stylet est posé : aucun doigt ne doit alors déplacer la page. C'est la
  // paume qui traîne, pas une intention.
  const penDown = React.useRef(false);
  // Vitesse du dernier déplacement, pour la lancée.
  const fling = React.useRef({ vx: 0, vy: 0, t: 0, raf: 0 });

  const tuiles = React.useRef(new Map<string, Tuile>());
  // Génération du pavage : elle change avec le zoom et la largeur, ce qui force
  // la refabrication des tuiles à la bonne résolution.
  const generation = React.useRef("");

  const dpr = React.useRef(1);
  React.useEffect(() => {
    dpr.current = Math.min(window.devicePixelRatio || 1, DPR_MAX);
  }, []);

  /* ------------------------------------------------------------------ *
   * Pages du document importé : seules celles proches de l'écran sont
   * rendues. Un polycopié de deux cents pages ferait sinon deux cents
   * canevas de pdf.js en mémoire, et l'onglet meurt avant d'avoir fini.
   * ------------------------------------------------------------------ */
  const [fenetre, setFenetre] = React.useState({ premiere: 0, derniere: 1 });

  const majFenetre = React.useCallback(() => {
    const conteneur = scrollRef.current;
    const largeur = vue.current.pageW;
    if (!conteneur || bands.length === 0 || largeur === 0) return;
    const haut = conteneur.scrollTop / largeur;
    const bas = (conteneur.scrollTop + conteneur.clientHeight) / largeur;
    const premiere = Math.max(0, pageAtY(bands, haut) - 1);
    const derniere = Math.min(bands.length - 1, pageAtY(bands, bas) + 1);
    setFenetre((f) => (f.premiere === premiere && f.derniere === derniere ? f : { premiere, derniere }));
  }, [bands]);

  /* ------------------------------------------------------------------ *
   * La couche fixe : des tuiles placées dans la page.
   * ------------------------------------------------------------------ */

  /** Découpage courant de la page en tuiles. */
  const pavage = React.useCallback(() => {
    const { pageW: w, pageH: h } = vue.current;
    if (w === 0 || h === 0) return null;
    // Assez de colonnes pour qu'aucune tuile ne dépasse la limite de Safari.
    const cols = Math.max(1, Math.ceil((w * dpr.current) / SIDE_MAX));
    const tileW = w / cols;
    const rows = Math.max(1, Math.ceil(h / TILE_H));
    return { cols, rows, tileW, tileH: TILE_H, w, h };
  }, []);

  /** Peint une tuile : les traits qui la traversent, et rien d'autre. */
  const peindreTuile = React.useCallback((t: Tuile) => {
    const plan = pavage();
    const canvas = t.canvas;
    const context = canvas.getContext("2d");
    if (!plan || !context) return;

    const { tileW, tileH, w } = plan;
    const x = t.col * tileW;
    const y = t.row * tileH;
    const largeurCss = Math.min(tileW, w - x);
    const hauteurCss = Math.min(tileH, plan.h - y);
    const d = dpr.current;

    const px = Math.max(1, Math.round(largeurCss * d));
    const py = Math.max(1, Math.round(hauteurCss * d));
    if (canvas.width !== px || canvas.height !== py) {
      canvas.width = px;
      canvas.height = py;
    }

    context.setTransform(d, 0, 0, d, 0, 0);
    context.clearRect(0, 0, largeurCss, hauteurCss);
    context.translate(-x, -y);
    // Les chemins sont dans le repère de mille unités : c'est ce qui permet de
    // les garder en cache d'un zoom à l'autre.
    context.scale(w / REF, w / REF);

    const styles = getComputedStyle(canvas);
    const encre = (name: string) =>
      styles.getPropertyValue(`--ink-${name}`).trim() || styles.color;

    const zone: Bounds = {
      minX: x / w,
      minY: y / w,
      maxX: (x + largeurCss) / w,
      maxY: (y + hauteurCss) / w,
    };

    for (const stroke of ordonnes()) {
      const b = cachedBounds(stroke);
      if (b && !overlaps(b, zone, strokeMargin(stroke))) continue;
      const path = cachedPath(stroke);
      if (!path) continue;
      context.globalAlpha = strokeAlpha(stroke);
      context.fillStyle = encre(stroke.color);
      context.fill(path);
    }
    context.globalAlpha = 1;
    t.sale = false;
  }, [pavage, ordonnes]);

  /** Crée, retire et repeint les tuiles selon ce qui est visible. */
  const majTuiles = React.useCallback(() => {
    const conteneur = tilesRef.current;
    const scroller = scrollRef.current;
    const plan = pavage();
    if (!conteneur || !scroller || !plan) return;

    const { cols, rows, tileW, tileH } = plan;
    /*
     * La marque ne retient **pas** la hauteur de la page.
     *
     * Le zoom et la largeur changent la taille des tuiles : il faut alors les
     * refaire. L'allongement de la page, lui, n'en change aucune — il en ajoute
     * seulement. Or la page s'allonge à chaque trait écrit près du bas : y
     * inclure la hauteur refabriquait tout le pavage à chaque ligne, ce qui
     * annulait l'essentiel du gain.
     */
    const marque = `${plan.w}x${cols}x${dpr.current}`;
    if (generation.current !== marque) {
      generation.current = marque;
      for (const t of tuiles.current.values()) t.canvas.remove();
      tuiles.current.clear();
    }

    const hautVisible = scroller.scrollTop;
    const basVisible = hautVisible + scroller.clientHeight;
    const gaucheVisible = scroller.scrollLeft;
    const droiteVisible = gaucheVisible + scroller.clientWidth;
    const margeY = scroller.clientHeight * OVERSCAN;
    const centreY = (hautVisible + basVisible) / 2;
    const centreX = (gaucheVisible + droiteVisible) / 2;

    // Candidates, de la plus proche du centre de l'écran à la plus lointaine :
    // sous plafond de mémoire, ce sont les plus proches qu'on garde.
    const voulues: { col: number; row: number; d: number }[] = [];
    for (let row = 0; row < rows; row++) {
      const y0 = row * tileH;
      if (y0 + tileH < hautVisible - margeY || y0 > basVisible + margeY) continue;
      for (let col = 0; col < cols; col++) {
        const x0 = col * tileW;
        if (x0 + tileW < gaucheVisible - tileW * 0.5 || x0 > droiteVisible + tileW * 0.5) continue;
        voulues.push({
          col,
          row,
          d: Math.abs(y0 + tileH / 2 - centreY) + Math.abs(x0 + tileW / 2 - centreX),
        });
      }
    }
    voulues.sort((a, b) => a.d - b.d);
    const gardees = voulues.slice(0, TILES_MAX);
    const cles = new Set(gardees.map((t) => `${t.col}:${t.row}`));

    for (const [cle, t] of tuiles.current) {
      if (cles.has(cle)) continue;
      t.canvas.remove();
      tuiles.current.delete(cle);
    }

    for (const { col, row } of gardees) {
      const cle = `${col}:${row}`;
      let t = tuiles.current.get(cle);
      if (!t) {
        const canvas = document.createElement("canvas");
        canvas.setAttribute("aria-hidden", "true");
        canvas.dataset.inkTile = `${col}:${row}`;
        canvas.style.position = "absolute";
        canvas.style.left = `${col * tileW}px`;
        canvas.style.top = `${row * tileH}px`;
        canvas.style.pointerEvents = "none";
        conteneur.appendChild(canvas);
        t = { col, row, canvas, sale: true };
        tuiles.current.set(cle, t);
      }
      // La dernière rangée est rognée par le bas de la page : elle grandit
      // quand la page s'allonge, et il faut alors la repeindre — mais elle
      // seule.
      const largeur = `${Math.min(tileW, plan.w - col * tileW)}px`;
      const hauteur = `${Math.min(tileH, plan.h - row * tileH)}px`;
      if (t.canvas.style.width !== largeur || t.canvas.style.height !== hauteur) {
        t.canvas.style.width = largeur;
        t.canvas.style.height = hauteur;
        t.sale = true;
      }
      if (t.sale) peindreTuile(t);
    }
  }, [pavage, peindreTuile]);

  /**
   * Signale que l'encre a changé.
   *
   * `zone` permet de ne repeindre que les tuiles concernées : ajouter un trait
   * ne touche qu'une tuile ou deux, et repeindre toute la page à chaque lettre
   * était précisément ce qui faisait accrocher l'écriture.
   */
  const salir = React.useCallback(
    (zone?: Bounds | null) => {
      const plan = pavage();
      if (!plan) return;
      for (const t of tuiles.current.values()) {
        if (zone) {
          const x = (t.col * plan.tileW) / plan.w;
          const y = (t.row * plan.tileH) / plan.w;
          const cadre: Bounds = {
            minX: x,
            minY: y,
            maxX: x + plan.tileW / plan.w,
            maxY: y + plan.tileH / plan.w,
          };
          if (!overlaps(zone, cadre, 0.02)) continue;
        }
        t.sale = true;
      }
      majTuiles();
    },
    [pavage, majTuiles],
  );

  /* ------------------------------------------------------------------ *
   * Les couches vive et des repères, collées à la fenêtre.
   * ------------------------------------------------------------------ */

  /** Prépare un contexte de fenêtre en unités normalisées de page. */
  const cadrer = React.useCallback((canvas: HTMLCanvasElement | null) => {
    const scroller = scrollRef.current;
    if (!canvas || !scroller) return null;
    const context = canvas.getContext("2d", { desynchronized: true });
    if (!context) return null;

    const d = dpr.current;
    const w = scroller.clientWidth;
    const h = scroller.clientHeight;
    if (w === 0 || h === 0) return null;
    const px = Math.round(w * d);
    const py = Math.round(h * d);
    if (canvas.width !== px || canvas.height !== py) {
      canvas.width = px;
      canvas.height = py;
    }
    context.setTransform(d, 0, 0, d, 0, 0);
    return { context, w, h };
  }, []);

  /**
   * Cale un contexte de fenêtre sur la page.
   *
   * `facteur` choisit l'unité de travail : `1` pour une fraction de la largeur
   * — ce qu'utilisent la règle, le lasso et la sélection, qui sont décrits
   * ainsi — et `1 / REF` pour les contours d'encre, calculés dans le repère de
   * mille unités.
   */
  const placerFenetre = React.useCallback(
    (context: CanvasRenderingContext2D, facteur = 1) => {
      const scroller = scrollRef.current;
      if (!scroller) return 0;
      context.translate(-scroller.scrollLeft, -scroller.scrollTop);
      context.scale(vue.current.pageW * facteur, vue.current.pageW * facteur);
      return vue.current.pageW;
    },
    [],
  );

  /** Efface la couche vive et oublie ce qu'elle avait peint. */
  const viderVive = React.useCallback(() => {
    const pret = cadrer(liveRef.current);
    if (!pret) return;
    pret.context.clearRect(0, 0, pret.w, pret.h);
    livePeint.current = 0;
  }, [cadrer]);

  /**
   * Peint le trait en cours.
   *
   * Le stylo ne repeint que la queue, par-dessus ce qui est déjà là : le coût
   * par image ne dépend donc pas de la longueur du trait. Le surligneur, lui,
   * est translucide — le recouvrement s'y verrait comme une tache plus foncée à
   * chaque jointure — il est donc effacé et repeint en entier.
   */
  const peindreVive = React.useCallback(() => {
    const trait = drawing.current;
    const pret = cadrer(liveRef.current);
    if (!pret || !trait) return;
    const { context, w, h } = pret;
    const total = Math.floor(trait.points.length / 3);
    if (total === 0) return;

    const translucide = (trait.tool ?? "pen") === "highlighter";
    if (translucide || livePeint.current === 0) {
      context.clearRect(0, 0, w, h);
      livePeint.current = 0;
    }
    const depuis = translucide ? 0 : Math.max(0, livePeint.current - LIVE_TAIL);

    context.save();
    placerFenetre(context, 1 / REF);
    const path = pathOf(outlineOf(trait, depuis, total));
    if (path) {
      context.globalAlpha = strokeAlpha(trait);
      context.fillStyle = encreVive.current;
      context.fill(path);
    }
    context.restore();
    livePeint.current = total;
  }, [cadrer, placerFenetre]);

  /** Peint la règle, le lasso et le cadre de sélection. */
  const peindreRepere = React.useCallback(() => {
    const pret = cadrer(decorRef.current);
    if (!pret) return;
    const { context, w, h } = pret;
    context.clearRect(0, 0, w, h);

    const styles = getComputedStyle(decorRef.current!);
    const primaire = styles.getPropertyValue("--color-primary").trim() || "#7c3aed";

    context.save();
    const largeur = placerFenetre(context);
    if (largeur === 0) {
      context.restore();
      return;
    }
    // Les épaisseurs sont données en pixels d'écran : on divise par l'échelle,
    // sinon un trait de repère d'un pixel deviendrait large d'un millier.
    const trait = 1.5 / largeur;

    if (ruler) {
      const demi = 1;
      const epaisseur = RULER_THICKNESS;
      context.save();
      context.translate(0.5, ruler.y);
      context.rotate(ruler.angle);
      context.fillStyle = primaire;
      context.globalAlpha = 0.12;
      context.fillRect(-demi, 0, demi * 2, epaisseur);
      context.globalAlpha = 0.85;
      context.fillRect(-demi, 0, demi * 2, trait);
      context.globalAlpha = 0.5;
      for (let x = -demi; x <= demi; x += 1 / 20) {
        const haut = Math.round(x * 20) % 5 === 0 ? epaisseur * 0.5 : epaisseur * 0.28;
        context.fillRect(x, trait, trait * 0.7, haut);
      }
      context.restore();
    }

    const trace = lasso.current;
    if (trace && trace.length > 1) {
      context.save();
      context.setLineDash([6 / largeur, 5 / largeur]);
      context.lineWidth = trait;
      context.strokeStyle = primaire;
      context.beginPath();
      context.moveTo(trace[0].x, trace[0].y);
      for (const point of trace.slice(1)) context.lineTo(point.x, point.y);
      context.closePath();
      context.stroke();
      context.restore();
    }

    const retenus = selection.map((i) => strokes.current[i]?.points).filter(Boolean);
    const cadre = unionBounds(retenus as number[][]);
    if (cadre) {
      const marge = 0.012;
      context.save();
      context.setLineDash([5 / largeur, 4 / largeur]);
      context.lineWidth = trait;
      context.strokeStyle = primaire;
      context.strokeRect(
        cadre.minX - marge,
        cadre.minY - marge,
        cadre.maxX - cadre.minX + marge * 2,
        cadre.maxY - cadre.minY + marge * 2,
      );
      context.restore();
    }
    context.restore();
  }, [cadrer, placerFenetre, ruler, selection]);

  /*
   * Une seule demande de dessin par image.
   *
   * Le stylet rapporte jusqu'à deux cents points par seconde ; peindre à
   * chaque événement dessinait trois fois la même image et laissait l'écriture
   * en retard sur la pointe.
   */
  const attente = React.useRef({ raf: 0, vive: false, repere: false, tuiles: false });

  const demander = React.useCallback(
    (quoi: "vive" | "repere" | "tuiles") => {
      attente.current[quoi] = true;
      if (attente.current.raf) return;
      attente.current.raf = requestAnimationFrame(() => {
        const quoiFaire = { ...attente.current };
        attente.current = { raf: 0, vive: false, repere: false, tuiles: false };
        if (quoiFaire.tuiles) majTuiles();
        if (quoiFaire.vive) peindreVive();
        if (quoiFaire.repere) peindreRepere();
      });
    },
    [majTuiles, peindreVive, peindreRepere],
  );

  React.useEffect(
    () => () => {
      if (attente.current.raf) cancelAnimationFrame(attente.current.raf);
      if (fling.current.raf) cancelAnimationFrame(fling.current.raf);
    },
    [],
  );

  /* ------------------------------------------------------------------ *
   * Mesure, contenu, thème.
   * ------------------------------------------------------------------ */

  React.useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    const mesurer = () => setWidth(scroller.clientWidth);
    const observer = new ResizeObserver(mesurer);
    observer.observe(scroller);
    mesurer();
    return () => observer.disconnect();
  }, []);

  // Le contenu peut venir de l'extérieur : chargement, annulation, duplication.
  // Pendant un tracé, on ne se laisse pas écraser — la main est sur la page.
  React.useEffect(() => {
    if (drawing.current) return;
    // Notre propre écho : le parent nous rend la liste que nous venons de lui
    // donner. Rien n'a changé à l'écran, il n'y a rien à repeindre — et
    // repeindre ici doublait le travail de chaque lettre écrite.
    if (content.strokes === strokes.current) return;
    strokes.current = content.strokes;
    setCount(content.strokes.length);
    onStrokeCount?.(content.strokes.length);
    salir(null);
    peindreRepere();
  }, [content, onStrokeCount, salir, peindreRepere]);

  // Largeur, zoom, papier : tout le pavage est à refaire.
  React.useEffect(() => {
    majTuiles();
    peindreRepere();
    majFenetre();
  }, [pageW, pageH, paper, majTuiles, peindreRepere, majFenetre]);

  React.useEffect(() => {
    peindreRepere();
  }, [peindreRepere]);

  // Le thème peut changer pendant l'écriture : les encres sont des variables CSS.
  React.useEffect(() => {
    const observer = new MutationObserver(() => {
      salir(null);
      peindreRepere();
    });
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [salir, peindreRepere]);

  /* ------------------------------------------------------------------ *
   * Enregistrement.
   * ------------------------------------------------------------------ */

  const commit = React.useCallback(
    (nextRatio = vue.current.ratio) => {
      // Le contenu est **étendu**, jamais reconstruit champ par champ : une
      // reconstruction oubliait le document de fond, et le premier trait
      // enregistré effaçait le PDF qu'on venait d'annoter.
      onChange({ ...content, ratio: nextRatio, strokes: strokes.current });
    },
    [content, onChange],
  );

  const compter = React.useCallback(() => {
    setCount(strokes.current.length);
    onStrokeCount?.(strokes.current.length);
  }, [onStrokeCount]);

  /* ------------------------------------------------------------------ *
   * Défilement, zoom, lancée.
   * ------------------------------------------------------------------ */

  const defiler = React.useCallback((dx: number, dy: number) => {
    const scroller = scrollRef.current;
    if (!scroller) return;
    scroller.scrollLeft -= dx;
    scroller.scrollTop -= dy;
  }, []);

  /**
   * Zoom autour d'un point de l'écran, en gardant ce point sous les doigts.
   *
   * Sans ce recalage, pincer fait fuir la page : on grossit autour du coin
   * haut-gauche et ce qu'on regardait sort de l'écran. Le point focal est noté
   * ici, et le défilement est recalé **au même passage que la mise en page** —
   * le faire une image plus tard viserait encore l'ancienne largeur, et le
   * geste sautillerait.
   */
  const focale = React.useRef<{ fx: number; fy: number; ex: number; ey: number } | null>(null);

  const zoomer = React.useCallback(
    (facteur: number, clientX: number, clientY: number) => {
      const scroller = scrollRef.current;
      if (!scroller || width === 0) return;
      const avant = vue.current.pageW;
      const suivant = Math.min(MAX_SCALE, Math.max(MIN_SCALE, facteur));
      if (Math.round(width * suivant) === avant) return;

      const rect = scroller.getBoundingClientRect();
      focale.current = {
        // Position du point focal dans la page, en fraction de sa largeur.
        fx: (clientX - rect.left + scroller.scrollLeft) / avant,
        fy: (clientY - rect.top + scroller.scrollTop) / avant,
        ex: clientX - rect.left,
        ey: clientY - rect.top,
      };
      setScale(suivant);
      onView?.(suivant);
    },
    [width, onView],
  );

  React.useLayoutEffect(() => {
    const scroller = scrollRef.current;
    const cible = focale.current;
    if (!scroller || !cible || pageW === 0) return;
    focale.current = null;
    scroller.scrollLeft = Math.max(0, cible.fx * pageW - cible.ex);
    scroller.scrollTop = Math.max(0, cible.fy * pageW - cible.ey);
  }, [pageW]);

  const lancer = React.useCallback(() => {
    if (fling.current.raf) cancelAnimationFrame(fling.current.raf);
    const pas = () => {
      const f = fling.current;
      // Frottement : quatre-vingt-treize pour cent par image donne une lancée
      // d'environ une demi-seconde, comme le défilement du système.
      f.vx *= 0.93;
      f.vy *= 0.93;
      if (Math.abs(f.vx) < 0.02 && Math.abs(f.vy) < 0.02) {
        f.raf = 0;
        return;
      }
      defiler(f.vx * 16, f.vy * 16);
      demander("tuiles");
      demander("repere");
      f.raf = requestAnimationFrame(pas);
    };
    if (Math.abs(fling.current.vx) > 0.05 || Math.abs(fling.current.vy) > 0.05) {
      fling.current.raf = requestAnimationFrame(pas);
    }
  }, [defiler, demander]);

  const stopper = React.useCallback(() => {
    if (fling.current.raf) cancelAnimationFrame(fling.current.raf);
    fling.current = { vx: 0, vy: 0, t: 0, raf: 0 };
  }, []);

  /* ------------------------------------------------------------------ *
   * Entrées.
   * ------------------------------------------------------------------ */

  function accepts(event: React.PointerEvent): boolean {
    if (readOnly) return false;
    if (event.pointerType === "pen") return true;
    // Le doigt ne dessine plus dès qu'un stylet a servi — ou dès que le verrou
    // est posé, pour pouvoir appuyer la main avant même d'approcher le stylet.
    if (event.pointerType === "touch") return !penSeen.current && !penOnly;
    return true;
  }

  /** Le doigt sert-il à déplacer la page plutôt qu'à écrire ? */
  function doigtDeplace(): boolean {
    return readOnly || penSeen.current || penOnly;
  }

  /**
   * Position dans la page, en fraction de sa largeur.
   *
   * Mesurée sur la **page**, pas sur le canevas : son rectangle tient déjà
   * compte du défilement et du zoom, donc il n'y a plus de décalage à
   * recomposer à la main — c'est ce calcul à la main qui décalait l'encre après
   * un déplacement au doigt.
   */
  function pointOf(event: PointerEvent | React.PointerEvent): number[] {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return [0, 0, 0.5];
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
    /*
     * iPadOS déclenche sa sélection de texte sur un appui maintenu, et le
     * geste retournait toute la page en surbrillance au milieu d'une phrase.
     * `preventDefault` coupe ce geste à la racine — et il faut le faire dès
     * `pointerdown`, la décision étant prise avant le premier mouvement.
     */
    event.preventDefault();
    stopper();

    if (event.pointerType === "touch") {
      // Un doigt posé pendant que le stylet écrit, c'est la paume : on l'ignore.
      if (penDown.current) return;
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touches.current.size >= 2) {
        // Deux doigts : ce n'est plus un tracé, c'est un geste. Le trait
        // commencé par mégarde est abandonné plutôt que laissé à moitié.
        if (drawing.current) {
          drawing.current = null;
          viderVive();
        }
        const { x, y, distance } = pinch();
        gesture.current = { distance, x, y, scale: vue.current.scale };
        return;
      }
      if (doigtDeplace()) {
        fling.current = { vx: 0, vy: 0, t: event.timeStamp, raf: 0 };
        return;
      }
    }

    if (!accepts(event)) return;
    if (event.pointerType === "pen") {
      penDown.current = true;
      // Un stylet vu : le doigt ne dessine plus. C'est le rejet de la paume, et
      // les doigts déjà posés sont oubliés pour qu'ils ne déplacent rien.
      touches.current.clear();
      gesture.current = null;
      if (!penSeen.current) {
        penSeen.current = true;
        setPenMode(true);
        onPenMode?.(true);
      }
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointOf(event);

    if (tool === "eraser") {
      eraseAt(point);
      return;
    }

    /*
     * La règle se saisit à la main, pas au stylet.
     *
     * C'est la répartition d'une vraie règle : le crayon écrit le long du
     * bord, la main la déplace. Sans cette distinction, poser la pointe sur la
     * règle pour tracer la ferait glisser — le contraire de ce qu'on veut.
     */
    if (ruler && onRuler && event.pointerType !== "pen" && nearRuler(point, ruler)) {
      const long = Math.abs(
        (point[0] - 0.5) * Math.cos(ruler.angle) + (point[1] - ruler.y) * Math.sin(ruler.angle),
      );
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
      demander("repere");
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
    const styles = getComputedStyle(event.currentTarget);
    encreVive.current = styles.getPropertyValue(`--ink-${color}`).trim() || styles.color;
    livePeint.current = 0;
    demander("vive");
  }

  function onPointerMove(event: React.PointerEvent<HTMLCanvasElement>) {
    if (event.pointerType === "touch" && touches.current.has(event.pointerId)) {
      const avant = touches.current.get(event.pointerId)!;
      touches.current.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (gesture.current && touches.current.size >= 2) {
        const { x, y, distance } = pinch();
        const depart = gesture.current;
        defiler(x - depart.x, y - depart.y);
        // Deux pixels d'écart : en dessous, c'est le tremblement de la main et
        // non une intention de zoomer. L'écartement de départ n'est remis à
        // jour que lorsqu'on a effectivement zoomé, sinon un pincement lent
        // n'atteindrait jamais le seuil.
        const bouge = depart.distance > 0 && Math.abs(distance - depart.distance) > 2;
        if (bouge) zoomer((depart.scale * distance) / depart.distance, x, y);
        else {
          demander("tuiles");
          demander("repere");
        }
        gesture.current = bouge
          ? { distance, x, y, scale: Math.min(MAX_SCALE, Math.max(MIN_SCALE, (depart.scale * distance) / depart.distance)) }
          : { ...depart, x, y };
        return;
      }

      if (doigtDeplace() && touches.current.size === 1) {
        const dx = event.clientX - avant.x;
        const dy = event.clientY - avant.y;
        const dt = Math.max(1, event.timeStamp - fling.current.t);
        fling.current = { vx: dx / dt, vy: dy / dt, t: event.timeStamp, raf: 0 };
        defiler(dx, dy);
        demander("tuiles");
        demander("repere");
        return;
      }
    }

    if (rulerDrag.current && ruler && onRuler) {
      if (event.buttons === 0) return;
      const point = pointOf(event);
      if (rulerDrag.current === "move") {
        onRuler({ ...ruler, y: Math.max(0, Math.min(vue.current.ratio, point[1])) });
      } else {
        onRuler({ ...ruler, angle: Math.atan2(point[1] - ruler.y, point[0] - 0.5) });
      }
      return;
    }

    if (tool === "eraser") {
      if (event.buttons > 0 && accepts(event)) eraseAt(pointOf(event));
      return;
    }

    if (tool === "lasso") {
      if (event.buttons === 0) return;
      const point = pointOf(event);

      if (moving.current) {
        const dx = point[0] - moving.current.x;
        const dy = point[1] - moving.current.y;
        const bouge = new Set(selection);
        strokes.current = strokes.current.map((stroke, i) =>
          bouge.has(i) ? { ...stroke, points: translateStroke(stroke.points, dx, dy) } : stroke,
        );
        moving.current = { x: point[0], y: point[1] };
        // Le déplacement traverse la page : on repeint les tuiles montées, ce
        // qui ne coûte que de rejouer des chemins déjà en cache.
        salir(null);
        demander("repere");
        return;
      }

      if (lasso.current) {
        lasso.current.push({ x: point[0], y: point[1] });
        demander("repere");
      }
      return;
    }

    if (!drawing.current) return;

    /*
     * Les points intermédiaires.
     *
     * Le stylet est échantillonné bien plus vite que l'écran ne se rafraîchit ;
     * sans eux, un trait rapide devient une ligne brisée.
     */
    const bruts =
      typeof event.nativeEvent.getCoalescedEvents === "function"
        ? event.nativeEvent.getCoalescedEvents()
        : [];
    for (const e of bruts.length > 0 ? bruts : [event.nativeEvent]) {
      drawing.current.points.push(...pointOf(e));
    }
    demander("vive");
  }

  function onPointerUp(event?: React.PointerEvent<HTMLCanvasElement>) {
    if (event?.pointerType === "touch") {
      touches.current.delete(event.pointerId);
      if (touches.current.size < 2) gesture.current = null;
      if (touches.current.size === 0 && doigtDeplace()) lancer();
    }
    if (event?.pointerType === "pen") penDown.current = false;

    if (rulerDrag.current) {
      rulerDrag.current = null;
      return;
    }

    // Fin d'un déplacement de sélection : on enregistre la nouvelle position.
    if (moving.current) {
      moving.current = null;
      compter();
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
      demander("repere");
      return;
    }

    // La gomme enregistre au lever de main, pas à chaque point : sérialiser la
    // page entière deux cents fois par seconde la faisait accrocher.
    if (gommeEnCours.current) {
      gommeEnCours.current = false;
      compter();
      commit();
      return;
    }

    const trait = drawing.current;
    drawing.current = null;
    if (!trait) return;

    // Un simple appui ne laisse rien : une pointe posée par mégarde ne doit pas
    // marquer la page.
    if (trait.points.length < 6) {
      viderVive();
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
    compter();
    // Seules les tuiles que le trait traverse sont repeintes, puis la couche
    // vive est effacée : l'encre passe d'une couche à l'autre sans clignoter.
    salir(cachedBounds(final));
    viderVive();

    /*
     * La page s'allonge quand on approche du bas, comme un cahier qu'on
     * déroule. Sans cela il faudrait décider de la hauteur avant d'écrire —
     * exactement ce qu'on ne sait jamais.
     */
    const bas = cachedBounds(final)?.maxY ?? 0;
    // Une surface qui porte un document ne s'allonge pas : sa hauteur est celle
    // de ses pages, et la relecture la recalculerait de toute façon.
    const nouveauRatio =
      growable && bands.length === 0 && bas > vue.current.ratio - 0.12
        ? Math.min(MAX_RATIO, bas + 0.45)
        : vue.current.ratio;
    commit(nouveauRatio);
  }

  /**
   * Gomme.
   *
   * Deux gestes différents sous le même outil : retirer le trait qu'on
   * effleure — pour rayer un mot d'un geste — ou **couper** ce qui passe sous
   * la pointe, pour reprendre la queue d'une lettre sans emporter la ligne.
   */
  const gommeEnCours = React.useRef(false);

  function eraseAt(point: number[]) {
    const seuil = 0.018;
    const zone: Bounds = {
      minX: point[0] - seuil,
      minY: point[1] - seuil,
      maxX: point[0] + seuil,
      maxY: point[1] + seuil,
    };
    const protege = (stroke: Stroke) =>
      // Gomme sélective : on surligne beaucoup et on se trompe souvent ;
      // effacer l'écriture par la même occasion est rageant.
      eraseHighlightsOnly && (stroke.tool ?? "pen") !== "highlighter";

    if (erasePrecise) {
      const restants: Stroke[] = [];
      let touche = false;
      for (const stroke of strokes.current) {
        if (protege(stroke)) {
          restants.push(stroke);
          continue;
        }
        const morceaux = eraseStroke(stroke.points, { x: point[0], y: point[1] }, seuil);
        // `eraseStroke` rend le tableau d'origine quand elle n'a rien touché.
        if (morceaux.length === 1 && morceaux[0] === stroke.points) {
          restants.push(stroke);
          continue;
        }
        touche = true;
        for (const points of morceaux) restants.push({ ...stroke, points });
      }
      if (!touche) return;
      strokes.current = restants;
      gommeEnCours.current = true;
      compter();
      salir(zone);
      return;
    }

    const kept = strokes.current.filter((stroke) => {
      if (protege(stroke)) return true;
      for (let i = 0; i < stroke.points.length; i += 3) {
        const dx = stroke.points[i] - point[0];
        const dy = stroke.points[i + 1] - point[1];
        if (dx * dx + dy * dy < seuil * seuil) return false;
      }
      return true;
    });
    if (kept.length === strokes.current.length) return;
    // Un trait entier disparaît : ce n'est pas la zone de la gomme qu'il faut
    // repeindre, c'est celle du trait retiré.
    const restants = new Set(kept);
    const zoneTraits = unionBounds(
      strokes.current.filter((s) => !restants.has(s)).map((s) => s.points),
    );
    strokes.current = kept;
    gommeEnCours.current = true;
    compter();
    salir(zoneTraits ?? zone);
  }

  /** Molette : défilement, et zoom avec la touche de commande. */
  function onWheel(event: React.WheelEvent<HTMLCanvasElement>) {
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      zoomer(vue.current.scale * Math.exp(-event.deltaY / 220), event.clientX, event.clientY);
      return;
    }
    const scroller = scrollRef.current;
    if (!scroller) return;
    // La couche collante intercepte la molette : sans cela la page ne
    // défilerait plus du tout au trackpad.
    scroller.scrollLeft += event.deltaX;
    scroller.scrollTop += event.deltaY;
    demander("tuiles");
    demander("repere");
  }

  const fenetreStyle: React.CSSProperties = {
    position: "sticky",
    top: 0,
    left: 0,
    /*
     * La largeur de la **fenêtre**, pas celle de la page.
     *
     * Au zoom, la page peut faire cinq mille pixels de large : un canevas de
     * cette largeur dépasse la limite de Safari et cesse de peindre. Les
     * couches collantes ne couvrent donc que ce qui est visible, et le
     * défilement est appliqué dans leur contexte de dessin.
     */
    width: width || "100%",
    height: viewport,
    // Sans cela, le navigateur applique sa propre inertie au geste et la page
    // saute pendant qu'on pince.
    touchAction: "none",
    // iPadOS met toute la page en surbrillance sur un appui maintenu, comme
    // s'il s'agissait de texte. Rien n'est sélectionnable ici.
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTouchCallout: "none",
    WebkitTapHighlightColor: "transparent",
  };

  return (
    <div
      ref={scrollRef}
      data-ink-scroll={scrollId}
      onScroll={() => {
        // Défiler pendant un tracé — rare, mais possible à la molette : la
        // couche vive est collée à la fenêtre, sa queue accumulée ne serait
        // plus au bon endroit. On la refait en entier.
        if (drawing.current) livePeint.current = 0;
        demander("tuiles");
        demander("repere");
        if (drawing.current) demander("vive");
        majFenetre();
      }}
      className={cn("ink-surface scroll-slim relative overflow-auto overscroll-contain", className)}
      style={{ height: viewport, touchAction: "none" }}
    >
      <div
        ref={pageRef}
        className={cn(
          "relative",
          // Le fond de la pile est plus sombre que le papier : sans ce contraste
          // la gouttière entre deux pages ne se voit pas, et l'on ne sait plus
          // où l'une finit.
          bands.length > 0
            ? "bg-surface-container-high"
            : cn("bg-surface-lowest", paperClass(paper)),
        )}
        style={
          {
            width: pageW || "100%",
            height: `${pageH}px`,
            // L'interligne suit la largeur de la page : c'est ce qui fait
            // grossir le cahier avec le zoom, au lieu de resserrer ses lignes
            // sous une écriture devenue six fois plus grande.
            "--paper-step": `${Math.max(12, Math.round(pageW * 0.034))}px`,
          } as React.CSSProperties
        }
      >
        {/* Le document importé, sous les annotations : toutes ses pages sur la
            même surface, comme un polycopié qu'on fait défiler d'un geste. Le
            fond de cahier s'efface — on n'annote pas un document sur du papier
            quadrillé. */}
        {bands.map((band, index) =>
          index >= fenetre.premiere && index <= fenetre.derniere ? (
            <div
              key={`${band.file}-${band.page}`}
              aria-hidden
              className="pointer-events-none absolute left-0 w-full bg-surface-lowest elevation-1"
              style={{
                top: `${Math.round(band.top * pageW)}px`,
                height: `${Math.round(band.ratio * pageW)}px`,
              }}
            >
              {/* La page est rendue à la largeur réellement affichée : au zoom,
                  un fond rasterisé une fois pour toutes serait aussi flou que
                  l'encre l'était. */}
              <PdfPage file={band.file} page={band.page} width={pageW} className="absolute inset-0" />
            </div>
          ) : (
            // La place est gardée même quand la page n'est pas rendue : sans
            // cela le document se replierait dès qu'on s'en éloigne.
            <div
              key={`${band.file}-${band.page}`}
              aria-hidden
              className="pointer-events-none absolute left-0 w-full bg-surface-lowest"
              style={{
                top: `${Math.round(band.top * pageW)}px`,
                height: `${Math.round(band.ratio * pageW)}px`,
              }}
            />
          ),
        )}

        {/* Les tuiles d'encre, posées dans la page. Elles sont créées à la main
            plutôt que rendues par React : leur nombre change à chaque
            défilement, et un rendu React par tuile coûterait plus que la
            peinture elle-même. */}
        <div
          ref={tilesRef}
          aria-hidden
          // Repère de la couche : les mesures de `verify/ecriture-e2e.mjs` lisent
          // les pixels de l'encre, et elles les confondaient avec ceux des pages
          // de pdf.js, qui sont posées en absolu elles aussi.
          data-ink-tiles=""
          // `text-on-surface` : les encres sont des variables CSS héritées, et
          // `currentColor` reste le dernier recours si l'une manquait.
          className="pointer-events-none absolute inset-0 text-on-surface"
        />

        {/* Le trait en cours, seul sur sa couche. */}
        <canvas
          ref={liveRef}
          aria-hidden
          className="pointer-events-none block text-on-surface"
          style={{ ...fenetreStyle, marginBottom: -viewport }}
        />

        {/* Les repères — règle, lasso, sélection — et la surface qui reçoit les
            gestes. C'est la couche du dessus : c'est donc elle qui écoute. */}
        <canvas
          ref={decorRef}
          data-testid="drawing-canvas"
          data-pen-mode={penMode ? "true" : "false"}
          data-zoom={scale.toFixed(2)}
          role="img"
          aria-label={`Page manuscrite, ${count} trait${count > 1 ? "s" : ""}`}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onLostPointerCapture={() => onPointerUp()}
          onWheel={onWheel}
          onContextMenu={(event) => event.preventDefault()}
          className={cn(
            "block text-on-surface",
            !readOnly && (tool === "eraser" ? "cursor-cell" : "cursor-crosshair"),
          )}
          style={{ ...fenetreStyle, marginBottom: -viewport }}
        />
      </div>
    </div>
  );
}
