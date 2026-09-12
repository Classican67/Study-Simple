/**
 * Géométrie de la page manuscrite — sans canevas ni DOM.
 *
 * Le lasso et les formes reposent sur quelques calculs qu'on ne vérifie pas à
 * l'œil : « ce trait est-il dans la sélection ? », « ce gribouillis était-il un
 * rectangle ? ». Ils vivent ici, et ils sont testés.
 *
 * Partout, un trait est une suite plate `[x, y, pression, …]` en proportion de
 * la largeur de la page.
 */

export type Point = { x: number; y: number };

/** Points d'un trait, sans la pression. */
export function pointsOf(flat: number[]): Point[] {
  const points: Point[] = [];
  for (let i = 0; i + 2 < flat.length + 1; i += 3) {
    if (flat[i] === undefined || flat[i + 1] === undefined) break;
    points.push({ x: flat[i], y: flat[i + 1] });
  }
  return points;
}

export type Bounds = { minX: number; minY: number; maxX: number; maxY: number };

export function boundsOf(flat: number[]): Bounds | null {
  if (flat.length < 3) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let i = 0; i + 1 < flat.length; i += 3) {
    minX = Math.min(minX, flat[i]);
    maxX = Math.max(maxX, flat[i]);
    minY = Math.min(minY, flat[i + 1]);
    maxY = Math.max(maxY, flat[i + 1]);
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Un point est-il dans un polygone ?
 *
 * Lancer de rayon : on compte les côtés traversés par une demi-droite partant
 * du point. Un nombre impair signifie qu'on est à l'intérieur. C'est l'algorithme
 * classique, et il vaut pour un lasso de forme quelconque, y compris concave —
 * ce que donne toujours un tracé à main levée.
 */
export function pointInPolygon(point: Point, polygon: Point[]): boolean {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    const traverse = a.y > point.y !== b.y > point.y;
    if (!traverse) continue;
    const x = ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x;
    if (point.x < x) inside = !inside;
  }
  return inside;
}

/**
 * Un trait est-il pris par le lasso ?
 *
 * On exige qu'une **majorité** de ses points soit à l'intérieur, et non un
 * seul : entourer un mot ne doit pas emporter la longue barre de soulignement
 * qui passe dessous. Un trait très court n'a qu'un ou deux points, d'où le
 * seuil exprimé en proportion.
 */
export function strokeInLasso(flat: number[], polygon: Point[], ratio = 0.6): boolean {
  const points = pointsOf(flat);
  if (points.length === 0) return false;
  let inside = 0;
  for (const point of points) if (pointInPolygon(point, polygon)) inside++;
  return inside / points.length >= ratio;
}

/** Décale un trait. La pression est conservée telle quelle. */
export function translateStroke(flat: number[], dx: number, dy: number): number[] {
  const moved = [...flat];
  for (let i = 0; i + 1 < moved.length; i += 3) {
    moved[i] = round(moved[i] + dx);
    moved[i + 1] = round(moved[i + 1] + dy);
  }
  return moved;
}

export const SHAPES = ["line", "rect", "ellipse"] as const;
export type Shape = (typeof SHAPES)[number];

/**
 * Redresse un tracé à main levée en une forme nette.
 *
 * On ne devine pas la forme voulue : l'outil est choisi avant de tracer, comme
 * dans GoodNotes. Deviner se trompe, et corriger une mauvaise devinette coûte
 * plus cher que de choisir.
 *
 * La pression est fixée à une valeur constante : une forme géométrique dont
 * l'épaisseur varierait au gré du poignet n'aurait pas l'air nette.
 */
export function snapShape(flat: number[], shape: Shape): number[] {
  const bounds = boundsOf(flat);
  const points = pointsOf(flat);
  if (!bounds || points.length < 2) return flat;

  const P = 0.7;
  const first = points[0];
  const last = points[points.length - 1];

  if (shape === "line") {
    return [round(first.x), round(first.y), P, round(last.x), round(last.y), P];
  }

  if (shape === "rect") {
    const { minX, minY, maxX, maxY } = bounds;
    const coins: Point[] = [
      { x: minX, y: minY },
      { x: maxX, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
      { x: minX, y: minY },
    ];
    return coins.flatMap((p) => [round(p.x), round(p.y), P]);
  }

  // Ellipse inscrite dans le cadre du tracé, échantillonnée assez finement
  // pour qu'aucun angle ne se voie.
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  const rx = (bounds.maxX - bounds.minX) / 2;
  const ry = (bounds.maxY - bounds.minY) / 2;
  const STEPS = 48;
  const sortie: number[] = [];
  for (let i = 0; i <= STEPS; i++) {
    const angle = (i / STEPS) * Math.PI * 2;
    sortie.push(round(cx + rx * Math.cos(angle)), round(cy + ry * Math.sin(angle)), P);
  }
  return sortie;
}

/** Cadre englobant plusieurs traits, pour dessiner la poignée de sélection. */
export function unionBounds(strokes: number[][]): Bounds | null {
  let union: Bounds | null = null;
  for (const flat of strokes) {
    const b = boundsOf(flat);
    if (!b) continue;
    union = union
      ? {
          minX: Math.min(union.minX, b.minX),
          minY: Math.min(union.minY, b.minY),
          maxX: Math.max(union.maxX, b.maxX),
          maxY: Math.max(union.maxY, b.maxY),
        }
      : b;
  }
  return union;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Règle : une droite posée sur la page, qu'on déplace et qu'on oriente.
 *
 * `y` est l'ordonnée de son centre et `angle` son inclinaison en radians. `x`
 * est fixé au milieu de la page : une règle qu'on pourrait aussi promener
 * horizontalement n'apporte rien, et c'est un degré de liberté de moins à
 * manipuler du doigt.
 */
export type Ruler = { y: number; angle: number };

/** Distance en profondeur sous laquelle un trait se colle à la règle. */
export const RULER_SNAP = 0.045;

/**
 * Projette un point sur la droite de la règle.
 *
 * On ne colle que ce qui passe **près** d'elle : au-delà, on écrit à côté de la
 * règle sans vouloir s'y appuyer, exactement comme sur le papier.
 */
export function snapToRuler(point: Point, ruler: Ruler, width = 1): Point {
  const cx = width / 2;
  const cy = ruler.y;
  const dx = Math.cos(ruler.angle);
  const dy = Math.sin(ruler.angle);

  // Projection orthogonale sur la droite passant par (cx, cy) de direction (dx, dy).
  const t = (point.x - cx) * dx + (point.y - cy) * dy;
  const projete = { x: cx + t * dx, y: cy + t * dy };

  const distance = Math.hypot(point.x - projete.x, point.y - projete.y);
  return distance <= RULER_SNAP ? projete : point;
}

/** Applique la règle à tout un trait, point par point. */
export function snapStrokeToRuler(flat: number[], ruler: Ruler, width = 1): number[] {
  const sortie = [...flat];
  for (let i = 0; i + 2 < sortie.length + 1; i += 3) {
    if (sortie[i] === undefined || sortie[i + 1] === undefined) break;
    const p = snapToRuler({ x: sortie[i], y: sortie[i + 1] }, ruler, width);
    sortie[i] = round(p.x);
    sortie[i + 1] = round(p.y);
  }
  return sortie;
}

/** Angle en degrés, pour l'afficher. Toujours ramené entre -90 et 90. */
export function rulerDegrees(ruler: Ruler): number {
  let deg = (ruler.angle * 180) / Math.PI;
  while (deg > 90) deg -= 180;
  while (deg < -90) deg += 180;
  return Math.round(deg);
}

/**
 * Gomme précise : ce qui reste d'un trait après le passage d'une gomme ronde.
 *
 * La gomme ordinaire retire le trait entier dès qu'on l'effleure. C'est ce
 * qu'on veut pour rayer un mot, jamais pour corriger la queue d'un « g » au
 * milieu d'une ligne d'écriture — toute la ligne disparaît.
 *
 * Celle-ci **coupe** : le trait est rendu en morceaux, et l'on rend les
 * morceaux qui survivent. Le calcul se fait segment par segment, pas point par
 * point : une droite tracée à la règle ne compte que deux points, et les
 * comparer à la gomme ne trouverait jamais rien à effacer entre les deux.
 *
 * Renvoie le tableau d'origine, tel quel, quand la gomme ne touche à rien —
 * l'appelant peut s'y fier pour savoir qu'il n'y a rien à enregistrer.
 */
export function eraseStroke(flat: number[], point: Point, radius: number): number[][] {
  const n = Math.floor(flat.length / 3);
  if (n === 0) return [];

  // Rejet rapide : la gomme passe sur des centaines de traits à chaque geste.
  const bounds = boundsOf(flat);
  if (
    !bounds ||
    point.x < bounds.minX - radius ||
    point.x > bounds.maxX + radius ||
    point.y < bounds.minY - radius ||
    point.y > bounds.maxY + radius
  ) {
    return [flat];
  }

  const dedans = (i: number) => {
    const dx = flat[i * 3] - point.x;
    const dy = flat[i * 3 + 1] - point.y;
    return dx * dx + dy * dy <= radius * radius;
  };

  if (n === 1) return dedans(0) ? [] : [flat];

  const morceaux: number[][] = [];
  let courant: number[] = [];
  let touche = false;

  const pousser = (i: number) => courant.push(flat[i * 3], flat[i * 3 + 1], flat[i * 3 + 2]);
  const interpoler = (i: number, j: number, t: number) => {
    for (let k = 0; k < 3; k++) {
      courant.push(flat[i * 3 + k] + (flat[j * 3 + k] - flat[i * 3 + k]) * t);
    }
  };
  const clore = () => {
    // Un point isolé ne se dessine pas : il n'a pas de direction.
    if (courant.length >= 6) morceaux.push(courant);
    courant = [];
  };

  if (!dedans(0)) pousser(0);
  else touche = true;

  for (let i = 0; i + 1 < n; i++) {
    const coupe = segmentInCircle(
      { x: flat[i * 3], y: flat[i * 3 + 1] },
      { x: flat[(i + 1) * 3], y: flat[(i + 1) * 3 + 1] },
      point,
      radius,
    );
    if (!coupe) {
      pousser(i + 1);
      continue;
    }
    touche = true;
    const [t0, t1] = coupe;
    if (t0 > 0) interpoler(i, i + 1, t0);
    clore();
    if (t1 < 1) {
      interpoler(i, i + 1, t1);
      pousser(i + 1);
    }
  }
  clore();

  return touche ? morceaux : [flat];
}

/**
 * Portion d'un segment située dans un disque, en paramètre de 0 à 1.
 *
 * Résolution du second degré `|a + t·(b − a) − centre|² = r²`, bornée au
 * segment. `null` quand il n'en traverse rien.
 */
function segmentInCircle(
  a: Point,
  b: Point,
  centre: Point,
  radius: number,
): [number, number] | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const fx = a.x - centre.x;
  const fy = a.y - centre.y;

  const A = dx * dx + dy * dy;
  if (A === 0) return fx * fx + fy * fy <= radius * radius ? [0, 1] : null;

  const B = 2 * (fx * dx + fy * dy);
  const C = fx * fx + fy * fy - radius * radius;
  const discriminant = B * B - 4 * A * C;
  if (discriminant < 0) return null;

  const racine = Math.sqrt(discriminant);
  const t0 = Math.max(0, (-B - racine) / (2 * A));
  const t1 = Math.min(1, (-B + racine) / (2 * A));
  return t0 <= t1 ? [t0, t1] : null;
}
