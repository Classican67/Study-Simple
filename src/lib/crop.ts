/**
 * Calculs de recadrage — sans DOM, donc testables seuls.
 *
 * Le rectangle de recadrage est exprimé en **fractions de l'image** (0 à 1),
 * et non en pixels : il reste alors valable quelle que soit la taille à
 * laquelle l'image est affichée, et l'export n'a qu'à multiplier par les
 * dimensions réelles.
 */

export type CropRect = { x: number; y: number; width: number; height: number };

export const FULL_CROP: CropRect = { x: 0, y: 0, width: 1, height: 1 };

/** Côté minimal d'un recadrage, en fraction : en dessous, il devient inmanipulable. */
export const MIN_CROP = 0.08;

export type Corner = "nw" | "ne" | "sw" | "se";

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Déplace le rectangle sans jamais le laisser sortir de l'image. */
export function moveCrop(rect: CropRect, dx: number, dy: number): CropRect {
  return {
    ...rect,
    x: clamp(rect.x + dx, 0, 1 - rect.width),
    y: clamp(rect.y + dy, 0, 1 - rect.height),
  };
}

/**
 * Redimensionne par un coin. Le coin opposé reste fixe, et le rectangle ne
 * peut ni s'inverser ni sortir de l'image.
 */
export function resizeCrop(rect: CropRect, corner: Corner, px: number, py: number): CropRect {
  const left = rect.x;
  const top = rect.y;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;

  const x = clamp(px, 0, 1);
  const y = clamp(py, 0, 1);

  let nextLeft = left;
  let nextTop = top;
  let nextRight = right;
  let nextBottom = bottom;

  if (corner === "nw" || corner === "sw") nextLeft = Math.min(x, right - MIN_CROP);
  else nextRight = Math.max(x, left + MIN_CROP);

  if (corner === "nw" || corner === "ne") nextTop = Math.min(y, bottom - MIN_CROP);
  else nextBottom = Math.max(y, top + MIN_CROP);

  return {
    x: clamp(nextLeft, 0, 1 - MIN_CROP),
    y: clamp(nextTop, 0, 1 - MIN_CROP),
    width: clamp(nextRight - nextLeft, MIN_CROP, 1),
    height: clamp(nextBottom - nextTop, MIN_CROP, 1),
  };
}

/** Convertit un recadrage fractionnaire en pixels sources, arrondis. */
export function toSourceRect(
  rect: CropRect,
  naturalWidth: number,
  naturalHeight: number,
): { sx: number; sy: number; sw: number; sh: number } {
  const sx = Math.round(rect.x * naturalWidth);
  const sy = Math.round(rect.y * naturalHeight);
  return {
    sx,
    sy,
    // Au moins un pixel : un canvas de largeur nulle lève une exception.
    sw: Math.max(1, Math.round(rect.width * naturalWidth)),
    sh: Math.max(1, Math.round(rect.height * naturalHeight)),
  };
}

/**
 * Taille d'export, bornée par le plus grand côté.
 *
 * Une photo d'iPad fait 12 Mpx : la stocker telle quelle remplirait le NAS
 * sans rien apporter, une carte de révision n'ayant jamais besoin de plus.
 * On ne agrandit jamais une image plus petite que la borne.
 */
export function fitWithin(width: number, height: number, maxSide: number) {
  const largest = Math.max(width, height);
  if (largest <= maxSide) return { width, height };
  const ratio = maxSide / largest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}
