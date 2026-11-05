/**
 * Chemins d'un trait pour un canevas.
 *
 * Sortis du canevas d'écriture : l'image d'une sélection, envoyée au
 * presse-papiers du système, doit être tracée exactement comme la page.
 */

import { INK_REF } from "@/lib/ink";
import { inkOutlines } from "@/lib/ink-stroke";
import type { Stroke } from "@/lib/notes";

/*
 * Les contours sont calculés dans le repère partagé de mille unités
 * (`INK_REF`), et gardés en cache : ils ne dépendent ni du zoom ni de la taille
 * de l'écran, et l'écran calcule exactement la géométrie que l'export PDF
 * calculera. Cf. `INK_REF` dans `lib/ink.ts` pour la raison — `getStroke` n'est
 * pas invariant d'échelle.
 */
const REF = INK_REF;

/**
 * Contour d'un trait, dans le repère de mille unités.
 *
 * Ne dépendant ni du zoom ni de la taille de l'écran, il est calculé une fois
 * et gardé en cache — c'est ce qui rend le redessin quasiment gratuit.
 */
function outlinesOf(stroke: Stroke): number[][][] {
  const points: number[][] = [];
  for (let i = 0; i + 2 < stroke.points.length; i += 3) {
    points.push([stroke.points[i] * REF, stroke.points[i + 1] * REF, stroke.points[i + 2] ?? 0.5]);
  }
  // Le calcul vit dans `lib/ink-stroke.ts`, avec celui de l'export : c'est la
  // seule façon de garantir qu'un trait sorte du PDF tel qu'on l'a vu. Ici
  // l'échelle vaut 1 — on est déjà dans le repère de mille unités.
  return inkOutlines(points, stroke.points, stroke.tool, stroke.size, 1);
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
 * Les chemins d'un trait — un par mèche.
 *
 * Ils sont remplis **séparément**, et c'est tout l'intérêt : réunis dans un
 * seul chemin, les recouvrements ne compteraient qu'une fois et l'on
 * retrouverait un aplat uni. Ce sont eux qui font la densité d'un crayon.
 */
export function pathsOf(stroke: Stroke): Path2D[] {
  const chemins: Path2D[] = [];
  for (const contour of outlinesOf(stroke)) {
    const path = pathOf(contour);
    if (path) chemins.push(path);
  }
  return chemins;
}

/**
 * Contours gardés en cache, par trait.
 *
 * C'est ce qui rend le redessin gratuit : repeindre une tuile ne recalcule
 * aucune géométrie, elle ne fait que rejouer des chemins déjà construits.
 * `WeakMap` — le cache s'efface avec les traits, sans avoir à le vider.
 */
const chemins = new WeakMap<Stroke, Path2D[]>();

export function cachedPaths(stroke: Stroke): Path2D[] {
  const connu = chemins.get(stroke);
  if (connu) return connu;
  const liste = pathsOf(stroke);
  chemins.set(stroke, liste);
  return liste;
}

/** Le contour d'un trait en chemin SVG, dans le repère de mille unités. */
export function contourSvg(stroke: Stroke): string {
  return outlinesOf(stroke)
    .map((contour) =>
      contour.length < 3
        ? ""
        : `M${contour.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join("L")}Z`,
    )
    .join("");
}
