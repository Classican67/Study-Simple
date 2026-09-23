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

/**
 * Quatre décimales, comme à la capture.
 *
 * Arrondir plus grossièrement ici reviendrait à dégrader un trait en le
 * déplaçant : le millième de page fait plusieurs pixels d'écran dès qu'on
 * zoome, et un trait lent y prendrait un escalier qu'il n'avait pas avant
 * d'être bougé.
 */
function round(value: number): number {
  return Math.round(value * 10000) / 10000;
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

/**
 * Les instruments.
 *
 * Un instrument n'est pas une icône : c'est une façon d'écrire. Une plume
 * s'effile aux deux bouts et répond fort à la pression ; un crayon est mat,
 * un peu translucide, et son trait a le grain du papier ; un feutre a une
 * largeur constante et le bout carré ; un surligneur passe **sous** l'encre.
 * Tout ce qui les distingue tient dans ce tableau — un seul endroit, pour que
 * l'écran, la relecture et l'export ne puissent pas en donner trois versions.
 *
 * `TOOLS` vit ici, et non dans `lib/notes.ts` qui le réexporte : c'est la
 * liste des instruments, et elle appartient aux instruments. La dépendance ne
 * va que dans un sens — `notes.ts` lit `ink.ts`, jamais l'inverse.
 */
export const TOOLS = ["pen", "fountain", "pencil", "marker", "highlighter"] as const;
export type Tool = (typeof TOOLS)[number];

export type Instrument = {
  /** Nom affiché, et nom accessible du bouton. */
  label: string;
  /** Effet de la pression sur l'épaisseur, de 0 (aucun) à 1. */
  thinning: number;
  /** Adoucissement du **contour**. Sans effet sur la trajectoire. */
  smoothing: number;
  /**
   * Lissage propre à `perfect-freehand`, à coefficient fixe.
   *
   * Le tremblement est traité en amont, à la capture (`lib/ink-smooth.ts`) ;
   * ce qui reste ici ne sert plus qu'aux traits **déjà enregistrés**, qui n'ont
   * jamais vu le filtre. Cf. la note de `LISSAGE.beta`.
   */
  streamline: number;
  /**
   * Effilement des bouts, en multiples de l'épaisseur.
   *
   * Exprimé ainsi, et non en unités de page : `getStroke` attend une
   * **distance**, qui n'a pas la même valeur à l'écran (repère de mille) et
   * dans le PDF (points typographiques). Un effilement écrit en dur y sortirait
   * deux fois trop long sur le papier.
   */
  taper: number;
  /** Bout arrondi. Un feutre a le bout carré, une plume non. */
  cap: boolean;
  /** Épaisseur réelle, en multiples de la taille choisie. */
  facteur: number;
  /** Opacité du trait. */
  alpha: number;
  /** Passe sous l'encre, comme un surligneur sur du papier. */
  dessous: boolean;
  /**
   * Grain du contour, en multiples de l'épaisseur.
   *
   * C'est ce qui donne au crayon sa mine. Le grain est **géométrique** — le
   * contour lui-même est perturbé — et non une texture peinte : une texture
   * n'existerait pas à l'export, et l'on retrouverait un crayon parfaitement
   * lisse dans le PDF d'une page qui ne l'était pas à l'écran.
   */
  grain: number;
  /** Les trois épaisseurs proposées par la barre d'outils. */
  tailles: readonly [number, number, number];
};

export const INSTRUMENTS: Record<Tool, Instrument> = {
  /** Le stylo à bille : opaque, régulier, la pression pour seul relief. */
  pen: {
    label: "Stylo",
    thinning: 0.62,
    smoothing: 0.62,
    streamline: 0.3,
    taper: 0,
    cap: true,
    facteur: 1,
    alpha: 1,
    dessous: false,
    grain: 0,
    tailles: [1.2, 2.5, 5],
  },
  /**
   * La plume : elle attaque fin, gonfle sous la main, et se relève fin.
   *
   * L'effilement vaut six fois l'épaisseur — assez pour qu'une jambe de lettre
   * se termine en pointe, pas assez pour qu'un trait court disparaisse.
   */
  fountain: {
    label: "Plume",
    thinning: 0.86,
    smoothing: 0.6,
    streamline: 0.28,
    taper: 6,
    cap: true,
    facteur: 1.15,
    alpha: 1,
    dessous: false,
    grain: 0,
    tailles: [1.4, 3, 6],
  },
  /** Le crayon : mat, légèrement transparent, et le grain de la mine. */
  pencil: {
    label: "Crayon",
    thinning: 0.35,
    smoothing: 0.5,
    streamline: 0.32,
    taper: 0,
    cap: true,
    facteur: 1.05,
    alpha: 0.78,
    dessous: false,
    grain: 0.34,
    tailles: [1.2, 2.4, 4.5],
  },
  /** Le feutre : largeur constante, bout carré, couleur franche. */
  marker: {
    label: "Feutre",
    thinning: 0,
    smoothing: 0.45,
    streamline: 0.3,
    taper: 0,
    cap: false,
    facteur: 2.2,
    alpha: 0.95,
    dessous: false,
    grain: 0,
    tailles: [1.6, 3, 5],
  },
  /**
   * Le surligneur : un feutre biseauté, translucide, qui passe **sous**
   * l'écriture — comme sur le papier, où l'encre a séché avant.
   */
  highlighter: {
    label: "Surligneur",
    thinning: 0,
    smoothing: 0.7,
    streamline: 0.38,
    taper: 0,
    cap: false,
    facteur: 4,
    alpha: 0.32,
    dessous: true,
    grain: 0,
    tailles: [2, 4, 6],
  },
};

/** L'instrument d'un trait. Les traits d'avant le surligneur n'en portent pas. */
export function instrumentOf(tool: string | undefined): Instrument {
  return INSTRUMENTS[(tool ?? "pen") as Tool] ?? INSTRUMENTS.pen;
}

/**
 * Épaisseur d'un trait, dans le repère demandé.
 *
 * `echelle` vaut 1 dans le repère de mille unités — celui de l'écran — et
 * `page.width / INK_REF` dans un PDF. Une seule fonction pour les deux : deux
 * multiplications écrites à deux endroits finissent toujours par différer.
 */
export function strokeWeight(stroke: { size: number; tool?: string }, echelle = 1): number {
  return stroke.size * instrumentOf(stroke.tool).facteur * echelle;
}

/**
 * Graine d'un trait, tirée de ses points.
 *
 * Le grain du crayon doit être **le même** à l'écran et sur le papier, sinon
 * le PDF ne montrerait pas le trait qu'on a tracé. Il se tire donc des points
 * enregistrés, qui sont les seuls à ne pas changer de repère.
 */
export function inkSeed(flat: number[]): number {
  let h = 2166136261;
  for (let i = 0; i < flat.length && i < 60; i++) {
    h ^= Math.round(flat[i] * 10000);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Perturbe un contour le long de sa normale : le grain de la mine.
 *
 * Deux fréquences superposées — une lente, qui fait onduler le bord, et une
 * rapide, qui l'écaille. Une seule donnerait soit une vague, soit un bruit
 * régulier, et ni l'une ni l'autre ne ressemble à du graphite.
 *
 * Tout est déterministe : même trait, même graine, même contour. C'est ce qui
 * permet au PDF de montrer exactement ce que l'écran montrait, et au trait de
 * ne pas frémir à chaque redessin.
 */
export function roughenOutline(outline: number[][], amplitude: number, graine: number): number[][] {
  if (amplitude <= 0 || outline.length < 3) return outline;
  const sortie: number[][] = [];
  for (let i = 0; i < outline.length; i++) {
    const [x, y] = outline[i];
    const [px, py] = outline[i === 0 ? outline.length - 1 : i - 1];
    const dx = x - px;
    const dy = y - py;
    const l = Math.hypot(dx, dy) || 1;
    // La normale au bord : c'est le long d'elle qu'une mine s'écaille, jamais
    // dans le sens du trait — l'allonger ou le raccourcir se verrait.
    const nx = -dy / l;
    const ny = dx / l;
    const bruit = Math.sin(i * 0.9 + graine * 0.0011) * 0.6 + Math.sin(i * 2.7 + graine * 0.0007) * 0.4;
    sortie.push([x + nx * bruit * amplitude, y + ny * bruit * amplitude, outline[i][2] ?? 0.5]);
  }
  return sortie;
}

/**
 * Réglages de `perfect-freehand`, partagés par l'écran et le papier.
/**
 * Réglages de `perfect-freehand`, partagés par l'écran et le papier.
 *
 * Ils vivaient en double — une copie dans le canevas, une autre dans
 * `lib/pdf-export.ts` — sous un commentaire affirmant que « l'écran et le
 * papier ne peuvent pas diverger ». Deux copies divergent toujours : il suffit
 * d'en régler une. Elles sont ici, et `tests/ink.test.ts` vérifie qu'il n'en
 * reste pas d'autre.
 */
/**
 * Le trait porte-t-il une pression réellement mesurée ?
 *
 * `perfect-freehand` **simule** la pression par défaut, à partir de la
 * *vitesse* du geste — et cette simulation remplace purement et simplement
 * celle que le stylet a mesurée. Conséquences, les deux visibles à l'œil :
 *
 * - **Le trait grésille.** La largeur suit la vitesse de la main, qui varie
 *   d'un échantillon à l'autre : mesuré, 23 % de variation de largeur le long
 *   d'un trait droit, contre 8 % avec la vraie pression.
 * - **Il est trois fois trop fin.** À pression 0,6, une épaisseur demandée de
 *   2,5 sortait à 0,96. Le stylo par défaut écrivait en fil d'araignée.
 *
 * Et pendant l'écriture, c'était pire : la couche vive ne redessine que la
 * queue du trait, et la vitesse simulée repart de zéro à chaque queue — donc
 * une rupture de largeur à chaque image, soixante fois par seconde.
 *
 * On ne la coupe pas pour autant : une souris et un doigt n'ont **pas** de
 * pression, et leur trait serait alors d'une régularité de machine. La règle
 * est donc tirée des données elles-mêmes — c'est ce qui permet à l'écran et à
 * l'export d'en décider pareil, sans champ supplémentaire à enregistrer.
 */
export function hasRealPressure(flat: number[]): boolean {
  if (flat.length < 12) return false;
  const premiere = flat[2];
  for (let i = 5; i < flat.length; i += 3) {
    // Un centième d'écart suffit : un stylet n'est jamais parfaitement stable,
    // une valeur inventée l'est toujours.
    if (Math.abs(flat[i] - premiere) > 0.01) return true;
  }
  return false;
}

/**
 * Repère de calcul des contours : une page large de mille unités.
 *
 * `getStroke` n'est **pas** invariant d'échelle : sur des coordonnées comprises
 * entre 0 et 1, ses seuils internes de distance écartent presque tous les
 * points et le contour dégénère en une tache large de la moitié de la page —
 * mesuré à 881 unités de haut pour un trait qui en fait 1,6. Tout se calcule
 * donc dans un repère de mille unités, où la bibliothèque se comporte comme
 * prévu, et c'est aussi la convention de `strokeWidth` à l'export.
 */
export const INK_REF = 1000;
