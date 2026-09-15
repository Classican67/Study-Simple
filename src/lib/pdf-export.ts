import { getStroke } from "perfect-freehand";

import { INK_OPTIONS, INK_REF, hasRealPressure } from "@/lib/ink";
import { PAPER_COLORS, PAPER_STEPS, type Paper, type Stroke } from "@/lib/notes";

/**
 * Conversion des traits manuscrits vers le PDF — géométrie pure, testable.
 *
 * Deux systèmes de coordonnées s'opposent, et c'est là que se logent les
 * erreurs :
 *
 * - **Nos traits** sont en proportion de la **largeur** de la page, origine en
 *   haut à gauche, y vers le bas. Une page A4 va donc de y = 0 à y ≈ 1,414.
 * - **Le PDF** est en points, origine en **bas** à gauche, y vers le haut.
 *
 * La conversion tient en une ligne — `y_pdf = hauteur − y × largeur` — mais
 * l'oublier retourne le document sans qu'aucune erreur ne le signale.
 */

export type PageSize = { width: number; height: number };

/** Un point du trait, en points PDF. */
export function toPdfPoint(
  x: number,
  y: number,
  page: PageSize,
): { x: number; y: number } {
  return { x: x * page.width, y: page.height - y * page.width };
}

/**
 * Contour d'un trait, en chemin SVG et en coordonnées PDF.
 *
 * On exporte le **contour rempli**, comme à l'écran, et non une ligne d'épaisseur
 * fixe : c'est ce qui fait qu'un trait exporté ressemble au trait tracé. Le
 * calcul est le même qu'au rendu — même bibliothèque, mêmes réglages — donc
 * l'écran et le papier ne peuvent pas diverger.
 */
export function strokeOutline(stroke: Stroke, page: PageSize): number[][] {
  const points: number[][] = [];
  for (let i = 0; i + 2 < stroke.points.length + 1; i += 3) {
    if (stroke.points[i] === undefined || stroke.points[i + 1] === undefined) break;
    const p = toPdfPoint(stroke.points[i], stroke.points[i + 1], page);
    points.push([p.x, p.y, stroke.points[i + 2]]);
  }
  if (points.length === 0) return [];

  const tool = stroke.tool ?? "pen";
  return getStroke(points, {
    // L'épaisseur est en proportion de la largeur, comme les coordonnées.
    size: strokeWidth(stroke, page),
    ...INK_OPTIONS[tool],
    // Même règle qu'à l'écran, et pour la même raison : la pression mesurée
    // l'emporte sur celle que la bibliothèque déduirait de la vitesse.
    simulatePressure: !hasRealPressure(stroke.points),
    last: true,
  });
}

/** Épaisseur du trait, en points PDF. */
export function strokeWidth(stroke: Stroke, page: PageSize): number {
  return stroke.size * (stroke.tool === "highlighter" ? 4 : 1) * (page.width / INK_REF);
}

export function strokeToSvgPath(stroke: Stroke, page: PageSize): string | null {
  const outline = strokeOutline(stroke, page);
  if (outline.length < 3) return null;

  const [premier, ...reste] = outline;
  const segments = reste.map(([x, y]) => `L ${round(x)} ${round(y)}`).join(" ");
  return `M ${round(premier[0])} ${round(premier[1])} ${segments} Z`;
}

/**
 * Liste de points d'une annotation Ink, au format de la norme.
 *
 * `/InkList` attend des suites plates `[x1 y1 x2 y2 …]` en coordonnées PDF —
 * c'est ce que tout lecteur conforme sait relire, Acrobat compris.
 */
export function strokeToInkList(stroke: Stroke, page: PageSize): number[] {
  const plat: number[] = [];
  for (let i = 0; i + 2 < stroke.points.length + 1; i += 3) {
    if (stroke.points[i] === undefined || stroke.points[i + 1] === undefined) break;
    const p = toPdfPoint(stroke.points[i], stroke.points[i + 1], page);
    plat.push(round(p.x), round(p.y));
  }
  return plat;
}

/** Cadre englobant d'un trait, en coordonnées PDF. Requis par `/Rect`. */
export function strokeRect(
  stroke: Stroke,
  page: PageSize,
): [number, number, number, number] | null {
  const liste = strokeToInkList(stroke, page);
  if (liste.length < 2) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < liste.length; i += 2) {
    minX = Math.min(minX, liste[i]);
    maxX = Math.max(maxX, liste[i]);
    minY = Math.min(minY, liste[i + 1]);
    maxY = Math.max(maxY, liste[i + 1]);
  }
  // Marge de l'épaisseur du trait : un `/Rect` trop serré fait rogner
  // l'annotation par certains lecteurs.
  const marge = strokeWidth(stroke, page);
  return [minX - marge, minY - marge, maxX + marge, maxY + marge];
}

/** Les encres, en composantes RVB de 0 à 1, comme l'attend le PDF. */
export const INK_RGB: Record<string, [number, number, number]> = {
  default: [0.1, 0.1, 0.12],
  rose: [0.79, 0.16, 0.24],
  amber: [0.72, 0.45, 0.05],
  emerald: [0.05, 0.5, 0.31],
  blue: [0.09, 0.4, 0.75],
  violet: [0.45, 0.2, 0.83],
};

export function inkRgb(name: string): [number, number, number] {
  return INK_RGB[name] ?? INK_RGB.default;
}

/**
 * Opacité d'un trait à l'export.
 * Un surligneur doit laisser lire le texte qu'il recouvre, sur le papier
 * comme à l'écran.
 */
export function strokeOpacity(stroke: Stroke): number {
  return stroke.tool === "highlighter" ? 0.32 : 1;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Opérateurs PDF traçant le contour d'un trait, pour un flux d'apparence.
 *
 * Une annotation Ink sans flux d'apparence (`/AP`) est laissée au bon vouloir
 * du lecteur : Acrobat en fabrique un, d'autres n'affichent rien. La norme
 * recommande d'en fournir un, et c'est la seule façon d'être sûr que le trait
 * se voie partout — c'est précisément ce que ne font pas les applications dont
 * les fichiers annotés « ne s'ouvrent nulle part ailleurs ».
 */
export function strokeToPdfOperators(stroke: Stroke, page: PageSize): string | null {
  const outline = strokeOutline(stroke, page);
  if (outline.length < 3) return null;

  const [r, g, b] = inkRgb(stroke.color);
  const lignes = [`${r} ${g} ${b} rg`, `${round(outline[0][0])} ${round(outline[0][1])} m`];
  for (const [x, y] of outline.slice(1)) lignes.push(`${round(x)} ${round(y)} l`);
  lignes.push("h", "f");
  return lignes.join("\n");
}

/**
 * Les repères du papier — lignes, carreaux, points — en coordonnées PDF.
 *
 * L'écran les dessine en CSS, et pendant longtemps l'export ne les dessinait
 * pas du tout : une page à lignes sortait blanche du PDF. Ce qui était écrit
 * entre les lignes se retrouvait suspendu dans le vide, et une page de cahier
 * exportée ne ressemblait plus à ce qu'on avait sous les yeux.
 *
 * La géométrie vient de `PAPER_STEPS`, la même constante que celle dont la
 * feuille de style tire ses pas : c'est ce qui garantit qu'une ligne tombe à la
 * même hauteur sur le papier que sur l'écran.
 *
 * L'origine du PDF est en **bas** à gauche : les lignes se comptent donc depuis
 * `height`, car un cahier se remplit du haut vers le bas et c'est le haut de la
 * page qui doit coïncider.
 */
export type PaperGuides = {
  /** Segments `[x1, y1, x2, y2]`. */
  lines: [number, number, number, number][];
  /** Centres des points. */
  dots: [number, number][];
  /** Épaisseur d'un trait, et diamètre d'un point. */
  thickness: number;
};

export function paperGuides(paper: Paper, page: PageSize): PaperGuides {
  // Un pixel d'écran sur une page large de mille : la même finesse qu'en CSS.
  const thickness = page.width / INK_REF;
  const guides: PaperGuides = { lines: [], dots: [], thickness };

  const pas = PAPER_STEPS[paper] * page.width;
  if (!pas || pas <= 0) return guides;

  if (paper === "ruled" || paper === "grid") {
    // Le dégradé CSS pose son trait au **bas** de chaque bande : la première
    // ligne est donc à un interligne du haut de la page, pas au ras du bord.
    for (let y = page.height - pas; y > 0; y -= pas) {
      guides.lines.push([0, y, page.width, y]);
    }
  }
  if (paper === "grid") {
    for (let x = pas; x < page.width; x += pas) {
      guides.lines.push([x, 0, x, page.height]);
    }
  }
  if (paper === "dots") {
    /*
     * `radial-gradient` centre son point au milieu de sa tuile : les points
     * tombent donc à un demi-interligne des bords, et non dessus. Les compter
     * depuis le coin aurait donné une grille décalée d'un demi-carreau par
     * rapport à l'écran — un défaut qu'on ne voit qu'en superposant les deux.
     */
    for (let y = page.height - pas / 2; y > 0; y -= pas) {
      for (let x = pas / 2; x < page.width; x += pas) {
        guides.dots.push([x, y]);
      }
    }
  }
  return guides;
}

/** Convertit une couleur `#rrggbb` en composantes de 0 à 1, comme l'attend le PDF. */
function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

/**
 * Couleurs du papier, tirées de la même source que la feuille de style.
 *
 * Une page imprimée doit ressembler à celle qu'on avait sous les yeux : le
 * blanc cassé du fond comme le gris chaud du réglage. Sur le papier, on est
 * toujours en thème clair.
 */
export const PAPER_FOND_RGB = hexRgb(PAPER_COLORS.fond);
export const PAPER_RGB = hexRgb(PAPER_COLORS.trait);
