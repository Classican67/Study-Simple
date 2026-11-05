/**
 * Chercher dans ce qu'on a lu sur une page — logique pure.
 *
 * Une page lue est une liste de mots avec leur place. De là viennent deux choses :
 * le texte qu'on interroge pour la recherche globale, et les rectangles que la
 * loupe surligne.
 */

import { transformerPoint } from "@/lib/ink";
import {
  centreImage,
  isBackdropPage,
  isImagePage,
  pageBands,
  type DrawingContent,
} from "@/lib/notes";
import { normalizeForSearch } from "@/lib/search";

/** `[texte, x, y, largeur, hauteur]`, en proportion de la page. */
export type MotLu = [string, number, number, number, number];
export type RectLu = [number, number, number, number];

/** Une occurrence : un rectangle par mot, puisqu'une expression peut changer de ligne. */
export type Occurrence = RectLu[];

export function lireMots(brut: string): MotLu[] {
  try {
    const mots = JSON.parse(brut);
    return Array.isArray(mots) ? (mots as MotLu[]) : [];
  } catch {
    return [];
  }
}

/** Passe-t-on à la ligne d'un mot au suivant ? */
function changeDeLigne(a: MotLu, b: MotLu): boolean {
  return b[2] > a[2] + a[4] * 0.6;
}

/**
 * Le texte d'une page, lignes rétablies et césures recollées.
 *
 * Un cours met souvent « hémo-/globine » à cheval sur deux lignes : sans cela, le
 * mot ne serait jamais trouvé, et c'est toujours celui qu'on cherche.
 */
export function texteDePage(mots: MotLu[]): string {
  let sortie = "";
  mots.forEach((mot, i) => {
    const suivant = mots[i + 1];
    const texte = mot[0];
    if (!suivant) {
      sortie += texte;
    } else if (texte.endsWith("-") && changeDeLigne(mot, suivant) && /^\p{Ll}/u.test(suivant[0])) {
      sortie += texte.slice(0, -1);
    } else {
      sortie += `${texte}${changeDeLigne(mot, suivant) ? "\n" : " "}`;
    }
  });
  return sortie;
}

function rect(mot: MotLu): RectLu {
  return [mot[1], mot[2], mot[3], mot[4]];
}

/** Forme comparable d'un mot, ponctuation retirée. */
function motComparable(mot: string): string {
  return normalizeForSearch(mot).replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
}

/**
 * Où tombent les termes cherchés.
 *
 * Plusieurs termes qui se suivent forment une expression : on la surligne d'un
 * bloc. Sinon, chaque terme est montré là où il est — la page a été trouvée parce
 * qu'elle les contient tous, pas forcément côte à côte.
 */
export function occurrencesDansMots(mots: MotLu[], termes: string[]): Occurrence[] {
  if (termes.length === 0) return [];
  const comparables = mots.map((m) => motComparable(m[0]));

  /*
   * Un mot coupé en fin de ligne ne contient le terme qu'une fois recollé : on
   * compare donc aussi avec la paire, et l'occurrence couvre les deux morceaux.
   */
  const correspond = (i: number, terme: string): number => {
    if (comparables[i].includes(terme)) return 1;
    const suivant = mots[i + 1];
    if (suivant && mots[i][0].endsWith("-") && changeDeLigne(mots[i], suivant)) {
      if (`${comparables[i]}${comparables[i + 1]}`.includes(terme)) return 2;
    }
    return 0;
  };

  if (termes.length > 1) {
    const expressions: Occurrence[] = [];
    for (let i = 0; i < mots.length; i++) {
      let curseur = i;
      let complet = true;
      for (const terme of termes) {
        const pris = curseur < mots.length ? correspond(curseur, terme) : 0;
        if (pris === 0) {
          complet = false;
          break;
        }
        curseur += pris;
      }
      if (complet) {
        expressions.push(mots.slice(i, curseur).map(rect));
        i = curseur - 1;
      }
    }
    if (expressions.length > 0) return expressions;
  }

  const occurrences: Occurrence[] = [];
  for (let i = 0; i < mots.length; i++) {
    let pris = 0;
    for (const terme of termes) pris = Math.max(pris, correspond(i, terme));
    if (pris > 0) {
      occurrences.push(mots.slice(i, i + pris).map(rect));
      i += pris - 1;
    }
  }
  return occurrences;
}

/** Ce que la loupe reçoit du serveur pour une page. */
export type PageTrouvee = { file: string; page: number; occurrences: Occurrence[] };

export type Surligne = { x: number; y: number; l: number; h: number };

/** Une occurrence posée sur la surface, en proportion de la largeur de page. */
export type OccurrencePlacee = { file: string; page: number; rects: Surligne[]; haut: number };

/**
 * Ramène ce qu'on a trouvé sur la surface.
 *
 * Le serveur raisonne en pages d'un fichier, l'écran en hauteur de pile : un même
 * fichier peut y paraître deux fois, ou ne plus y paraître du tout si la page a été
 * retirée. Une image posée suit sa place et sa rotation.
 */
export function placerOccurrences(content: DrawingContent, pages: PageTrouvee[]): OccurrencePlacee[] {
  const parCle = new Map(pages.map((p) => [`${p.file}#${p.page}`, p]));
  const placees: OccurrencePlacee[] = [];

  for (const bande of pageBands(content.pages)) {
    const file = isBackdropPage(bande) ? bande.file : isImagePage(bande) ? bande.image : null;
    if (!file) continue;
    const numero = isBackdropPage(bande) ? bande.page : 1;
    for (const occurrence of parCle.get(`${file}#${numero}`)?.occurrences ?? []) {
      const rects = occurrence.map(([x, y, l, h]) => ({
        x,
        y: bande.top + y * bande.ratio,
        l,
        h: h * bande.ratio,
      }));
      placees.push({ file, page: numero, rects, haut: rects[0].y });
    }
  }

  for (const image of content.images) {
    const centre = centreImage(image);
    const rotation = { cx: centre.x, cy: centre.y, echelle: 1, angle: image.angle, dx: 0, dy: 0 };
    const hauteur = image.w * image.ratio;
    for (const occurrence of parCle.get(`${image.file}#1`)?.occurrences ?? []) {
      const rects = occurrence.map(([x, y, l, h]) => {
        const coins = [
          [x, y],
          [x + l, y],
          [x + l, y + h],
          [x, y + h],
        ].map(([cx, cy]) =>
          transformerPoint({ x: image.x + cx * image.w, y: image.y + cy * hauteur }, rotation),
        );
        const xs = coins.map((c) => c.x);
        const ys = coins.map((c) => c.y);
        return {
          x: Math.min(...xs),
          y: Math.min(...ys),
          l: Math.max(...xs) - Math.min(...xs),
          h: Math.max(...ys) - Math.min(...ys),
        };
      });
      placees.push({ file: image.file, page: 1, rects, haut: rects[0].y });
    }
  }

  return placees.sort((a, b) => a.haut - b.haut || a.rects[0].x - b.rects[0].x);
}
