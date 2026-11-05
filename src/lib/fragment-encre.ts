/**
 * Ce que le lasso retient : des traits et des images, pris ensemble.
 *
 * Copier, couper, dupliquer et coller sont une seule opération vue de deux
 * côtés : **extraire** un fragment d'une surface, le **reposer** sur une autre.
 * Tout est ici, sans DOM ni presse-papiers, parce que c'est ici que se trouvent
 * les erreurs qu'on ne voit pas : un identifiant d'image dupliqué, un fragment
 * collé hors de la page, un rang de sélection qui ne désigne plus le bon trait.
 */

import {
  transformerTrait,
  translateStroke,
  unionBounds,
  type Bounds,
  type Point,
  type Transfo,
} from "@/lib/ink";
import {
  MAX_IMAGES_POSEES,
  MAX_RATIO,
  cadreImage,
  cadreTexte,
  nouvelIdImage,
  transformerImage,
  transformerTexte,
  type DrawingContent,
  type ImagePosee,
  type Stroke,
  type ZoneTexte,
} from "@/lib/notes";

export type FragmentEncre = {
  strokes: Stroke[];
  images: ImagePosee[];
  textes: ZoneTexte[];
  /** Cadre d'ensemble, dans le repère de la surface d'origine. */
  cadre: Bounds;
};

/** Cadre commun à des traits et à des images. */
export function cadreCommun(
  strokes: Stroke[],
  images: ImagePosee[],
  textes: ZoneTexte[] = [],
): Bounds | null {
  let cadre = unionBounds(strokes.map((s) => s.points));
  for (const b of [...images.map(cadreImage), ...textes.map(cadreTexte)]) {
    cadre = cadre
      ? {
          minX: Math.min(cadre.minX, b.minX),
          minY: Math.min(cadre.minY, b.minY),
          maxX: Math.max(cadre.maxX, b.maxX),
          maxY: Math.max(cadre.maxY, b.maxY),
        }
      : b;
  }
  return cadre;
}

export function extraireFragment(
  content: DrawingContent,
  rangs: number[],
  ids: string[],
): FragmentEncre | null {
  const strokes = rangs.map((i) => content.strokes[i]).filter((s): s is Stroke => Boolean(s));
  const voulus = new Set(ids);
  const images = content.images.filter((image) => voulus.has(image.id));
  const textes = content.textes.filter((zone) => voulus.has(zone.id));
  const cadre = cadreCommun(strokes, images, textes);
  return cadre ? { strokes, images, textes, cadre } : null;
}

/** Retire de la surface ce que la sélection désigne. */
export function retirerSelection(
  content: DrawingContent,
  rangs: number[],
  ids: string[],
): DrawingContent {
  const partis = new Set(rangs);
  const voulus = new Set(ids);
  return {
    ...content,
    strokes: partis.size > 0 ? content.strokes.filter((_, i) => !partis.has(i)) : content.strokes,
    images: voulus.size > 0 ? content.images.filter((image) => !voulus.has(image.id)) : content.images,
    textes: voulus.size > 0 ? content.textes.filter((zone) => !voulus.has(zone.id)) : content.textes,
  };
}

export type Collage = {
  content: DrawingContent;
  /** Rangs des traits posés : ils forment la nouvelle sélection. */
  rangs: number[];
  ids: string[];
};

/**
 * Pose un fragment sur une surface, centré sur un point.
 *
 * Le fragment reste entier dans la page en largeur : collé depuis une page
 * zoomée, ou depuis le bord d'une autre, il sortait sinon du papier et l'on
 * croyait que rien n'avait été collé. En hauteur, une surface simple s'allonge
 * pour le recevoir ; une pile a la hauteur de ses pages, il y est ramené.
 *
 * Les images reçoivent de nouveaux identifiants, et jamais un nouveau fichier :
 * elles désignent le même, ce que `nettoyerFichiers` sait compter.
 */
export function collerFragment(
  content: DrawingContent,
  fragment: FragmentEncre,
  centre: Point,
): Collage {
  const { cadre } = fragment;
  const largeur = cadre.maxX - cadre.minX;
  const hauteur = cadre.maxY - cadre.minY;

  const gauche = Math.max(0, Math.min(1 - largeur, centre.x - largeur / 2));
  const hautVoulu = Math.max(0, centre.y - hauteur / 2);
  const empile = content.pages.length > 0;
  const haut = empile ? Math.min(hautVoulu, Math.max(0, content.ratio - hauteur)) : hautVoulu;

  const dx = gauche - cadre.minX;
  const dy = haut - cadre.minY;

  const places = MAX_IMAGES_POSEES - content.images.length;
  const images = fragment.images
    .slice(0, Math.max(0, places))
    .map((image) => ({ ...image, id: nouvelIdImage(), x: image.x + dx, y: image.y + dy }));
  const strokes = fragment.strokes.map((stroke) => ({
    ...stroke,
    points: translateStroke(stroke.points, dx, dy),
  }));
  // `?? []` : un fragment gardé sur l'appareil peut dater d'avant les zones de texte.
  const textes = (fragment.textes ?? []).map((zone) => ({
    ...zone,
    id: nouvelIdImage(),
    x: zone.x + dx,
    y: zone.y + dy,
  }));

  const bas = haut + hauteur;
  const ratio = !empile && bas > content.ratio - 0.05 ? Math.min(MAX_RATIO, bas + 0.1) : content.ratio;

  const depart = content.strokes.length;
  return {
    content: {
      ...content,
      ratio,
      strokes: [...content.strokes, ...strokes],
      images: [...content.images, ...images],
      textes: [...content.textes, ...textes],
    },
    rangs: strokes.map((_, i) => depart + i),
    ids: [...images.map((image) => image.id), ...textes.map((zone) => zone.id)],
  };
}

/** Épaisseur maximale d'un trait, celle que `parseDrawing` accepte à la relecture. */
const EPAISSEUR_MAX = 60;

/** Un trait transformé : son épaisseur suit l'agrandissement, sinon il maigrit. */
export function transformerTraitEntier(stroke: Stroke, t: Transfo): Stroke {
  return {
    ...stroke,
    points: transformerTrait(stroke.points, t),
    size:
      t.echelle === 1
        ? stroke.size
        : Math.min(EPAISSEUR_MAX, Math.round(stroke.size * t.echelle * 1000) / 1000),
  };
}

/** Applique une transformation à tout ce qui est retenu. */
export function transformerSelection(
  content: DrawingContent,
  rangs: number[],
  ids: string[],
  t: Transfo,
): DrawingContent {
  const bouges = new Set(rangs);
  const voulus = new Set(ids);
  return {
    ...content,
    strokes: content.strokes.map((s, i) => (bouges.has(i) ? transformerTraitEntier(s, t) : s)),
    images: content.images.map((im) => (voulus.has(im.id) ? transformerImage(im, t) : im)),
    textes: content.textes.map((zone) => (voulus.has(zone.id) ? transformerTexte(zone, t) : zone)),
  };
}
