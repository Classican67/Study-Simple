/**
 * Blocs de note — formes, valeurs par défaut et bornes. Sans base ni DOM.
 *
 * Le contenu d'un bloc est stocké en JSON dans une colonne de texte : sa forme
 * dépend du type, et c'est ici qu'elle est décrite. Toutes les lectures sont
 * **tolérantes** — un JSON tronqué, un champ manquant ou d'un autre type
 * renvoie un bloc vide plutôt qu'une exception. Une note ne doit pas devenir
 * illisible en entier parce qu'un bloc l'est.
 */

// `lib/ink.ts` ne connaît que de la géométrie — points, cadres, polygones — et
// n'importe rien d'ici : la dépendance ne va que dans ce sens.
import {
  boundsOf,
  transformerPoint,
  translateStroke,
  TOOLS,
  type Bounds,
  type Point,
  type Tool,
  type Transfo,
} from "@/lib/ink";

export const BLOCK_KINDS = ["text", "table", "drawing", "image"] as const;
export type BlockKind = (typeof BLOCK_KINDS)[number];

export function isBlockKind(value: unknown): value is BlockKind {
  return typeof value === "string" && (BLOCK_KINDS as readonly string[]).includes(value);
}

// --- Texte ------------------------------------------------------------------

/**
 * Le style est porté par le bloc, pas par le balisage.
 *
 * Le moteur de texte enrichi de l'app est **en ligne** : gras, italique,
 * couleur. Y ajouter titres et listes demanderait un analyseur de blocs. Les
 * traiter comme un attribut du bloc donne la même structure qu'un traitement
 * de texte — un titre, un paragraphe, une puce — sans réécrire le parseur.
 */
export const TEXT_STYLES = ["h1", "h2", "p", "quote", "bullet"] as const;
export type TextStyle = (typeof TEXT_STYLES)[number];

export type TextContent = { style: TextStyle; markup: string };

/*
 * C'est une borne de **relecture** : au-delà, le texte était coupé sans rien
 * dire à la réouverture. Vingt mille caractères, c'est sept pages : un chapitre
 * collé depuis un cours les dépasse. Le collage répartit de toute façon les
 * longs textes sur plusieurs blocs (`lib/collage.ts`).
 */
export const MAX_TEXT_LENGTH = 200_000;

export function parseText(raw: string): TextContent {
  const data = safeParse(raw);
  const style = data?.style;
  return {
    style: (TEXT_STYLES as readonly unknown[]).includes(style) ? (style as TextStyle) : "p",
    markup: typeof data?.markup === "string" ? data.markup.slice(0, MAX_TEXT_LENGTH) : "",
  };
}

// --- Tableau ----------------------------------------------------------------

export type TableContent = { rows: string[][] };

// Bornes : au-delà, un tableau ne se lit plus dans une note et le rendu se
// paie en performance. Ce n'est pas un tableur complet, c'est un tableau.
export const MAX_TABLE_ROWS = 60;
export const MAX_TABLE_COLS = 12;
export const MAX_CELL_LENGTH = 500;

export function parseTable(raw: string): TableContent {
  const data = safeParse(raw);
  const rows = Array.isArray(data?.rows) ? data.rows : null;
  if (!rows) return emptyTable();

  const cleaned = rows
    .slice(0, MAX_TABLE_ROWS)
    .map((row: unknown) =>
      (Array.isArray(row) ? row : [])
        .slice(0, MAX_TABLE_COLS)
        .map((cell: unknown) => (typeof cell === "string" ? cell.slice(0, MAX_CELL_LENGTH) : "")),
    );
  if (cleaned.length === 0) return emptyTable();

  // Une grille irrégulière viendrait d'un ajout de colonne interrompu : on la
  // complète plutôt que de laisser le rendu deviner.
  const width = Math.max(1, ...cleaned.map((row) => row.length));
  return { rows: cleaned.map((row) => [...row, ...Array(width - row.length).fill("")]) };
}

export function emptyTable(): TableContent {
  // Trois colonnes et trois lignes : de quoi voir tout de suite que c'est un
  // tableau, sans imposer de tout supprimer si l'on en voulait moins.
  return { rows: Array.from({ length: 3 }, () => ["", "", ""]) };
}

// --- Dessin -----------------------------------------------------------------

/**
 * Un trait : une couleur, une épaisseur, et des points aplatis en
 * `[x, y, pression, x, y, pression, …]`.
 *
 * Aplatis plutôt qu'en objets : une page de notes au stylet fait vite quelques
 * milliers de points, et `{"x":12.3,"y":45.6,"p":0.5}` pèse six fois plus que
 * `12.3,45.6,0.5`.
 *
 * Les coordonnées sont **relatives** à la largeur du bloc (0 à 1) : le même
 * croquis se relit sur un téléphone comme sur un iPad, sans être tronqué.
 */
/*
 * Les instruments vivent dans `lib/ink.ts`, avec ce qui les distingue —
 * épaisseur, opacité, effilement, grain. On les réexporte ici parce que c'est
 * `Stroke` qui les porte, et que la moitié de l'application les lit depuis ce
 * module.
 */
export { TOOLS, type Tool };

export type Stroke = {
  color: string;
  size: number;
  /** Absent sur les traits d'avant l'arrivée du surligneur : c'était un stylo. */
  tool?: Tool;
  points: number[];
};

/** Fond de page, comme on choisit un cahier. */
export const PAPERS = ["blank", "ruled", "grid", "dots"] as const;
export type Paper = (typeof PAPERS)[number];

/**
 * Classe CSS du fond.
 *
 * Les lignes sont dessinées par le navigateur, pas au canevas : elles ne font
 * pas partie du contenu, n'ont pas à être enregistrées, et suivent le thème
 * toutes seules. L'export PDF les redessine de son côté, depuis
 * `PAPER_STEPS` — c'est la même géométrie, pas la même technique.
 *
 * Dans un module neutre et non dans le canevas : le volet des pages s'en sert
 * aussi pour montrer une page ajoutée, et une valeur exportée d'un fichier
 * « use client » n'arrive pas comme une vraie valeur dans un composant serveur.
 */
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

/**
 * Interligne de chaque fond, en proportion de la largeur de la page.
 *
 * Ce sont les pas d'un vrai cahier ramenés à une page A4 large de 210 mm :
 * 7 mm pour des lignes, 5 mm pour des carreaux et des points. Exprimés en
 * proportion, ils suivent la largeur de la page — donc le zoom — au lieu de se
 * resserrer sous une écriture devenue six fois plus grande.
 *
 * **Une seule source.** L'écran les lit en CSS (`--paper-width`, cf.
 * `globals.css`) et l'export PDF les redessine à l'identique : deux valeurs
 * séparées se seraient décalées, et ce qu'on écrit entre deux lignes ne serait
 * plus entre les lignes sur le papier.
 */
export const PAPER_STEPS: Record<Paper, number> = {
  blank: 0,
  ruled: 7 / 210,
  grid: 5 / 210,
  dots: 5 / 210,
};

/**
 * Pas du réglage, en pixels CSS, **aligné sur la grille de pixels de l'écran**.
 *
 * Le pas vaut sept millimètres d'une page A4, ce qui tombe sur 25,4291 px pour
 * une page de mille soixante-huit. Une valeur pareille ne tombe jamais sur un
 * pixel : le navigateur étale alors chaque trait sur deux rangées au lieu
 * d'une, et il ne les étale pas de la même façon selon l'orientation. Les
 * verticales d'un quadrillage sortaient donc plus épaisses et plus sombres que
 * les horizontales, et les carreaux n'étaient pas carrés — un désordre qui se
 * voit tout de suite et qu'aucune mesure de proportion ne révèle.
 *
 * On arrondit donc au pixel **de l'écran**, densité comprise. L'écart avec les
 * sept millimètres exacts reste sous un pour cent, et l'export garde la
 * proportion juste : c'est à l'écran seul que la grille de pixels impose sa
 * loi.
 */
export function paperStepPx(paper: Paper, pageWidth: number, dpr = 1): number {
  const fraction = PAPER_STEPS[paper];
  if (!fraction || pageWidth <= 0) return 0;
  const densite = dpr > 0 ? dpr : 1;
  // Deux pixels au minimum : en dessous, le réglage devient un aplat.
  return Math.max(2, Math.round(fraction * pageWidth * densite) / densite);
}

/**
 * Couleur du papier, et de son réglage.
 *
 * Un blanc pur est un écran, pas une feuille : il fatigue à la lecture et fait
 * ressortir l'encre d'une façon qui n'appartient à aucun cahier. Ce blanc cassé
 * très légèrement chaud est celui d'un papier ordinaire, et son réglage est un
 * gris chaud assorti — un gris bleuté sur du crème jure.
 *
 * Partagées par l'écran et l'export, comme `PAPER_STEPS` : une page imprimée
 * doit ressembler à celle qu'on avait sous les yeux.
 */
export const PAPER_COLORS = {
  /** Fond de la feuille. */
  fond: "#fcf8ee",
  /** Lignes, carreaux et points. */
  trait: "#d7d0c0",
} as const;

/**
 * Page de document servant de fond, pour l'annoter.
 *
 * `file` est le PDF stocké — tout import est converti en PDF — et `page` le
 * numéro de page, à partir de 1. Le fond n'est pas recopié dans le bloc : un
 * même document sert de fond à toutes ses pages.
 */
export type Backdrop = { file: string; page: number };

/** Une page du document, avec son format à elle. */
export type BackdropPage = Backdrop & { ratio: number };

/**
 * Une page ajoutée à la main, avec son fond.
 *
 * C'est la feuille qu'on glisse dans un polycopié : le cours s'arrête au milieu
 * d'un chapitre et il faut de la place pour l'exercice, ou bien le professeur
 * commente une figure pendant dix minutes. Sans elle, il fallait écrire dans la
 * marge ou ouvrir un autre bloc — donc perdre le fil du document.
 */
export type BlankPage = { paper: Paper; ratio: number };

/**
 * Une photo devenue page annotable.
 *
 * Le tableau du cours, la page d'un camarade, un schéma d'un livre : on les
 * photographie, et il faut pouvoir écrire dessus — entourer, flécher,
 * annoter — exactement comme sur un polycopié importé. C'est donc une **page**
 * de la surface, et non un bloc à part : elle hérite ainsi de l'écriture, du
 * zoom, du volet des pages et de l'export, sans rien réinventer.
 *
 * `image` est le nom du fichier stocké, comme `file` l'est pour un document.
 */
export type ImagePage = { image: string; ratio: number };

/** Une page de la surface : du document importé, ajoutée, ou photographiée. */
export type NotePage = BackdropPage | BlankPage | ImagePage;

/** Cette page vient-elle du document importé ? */
export function isBackdropPage(page: NotePage): page is BackdropPage {
  return "file" in page;
}

/** Cette page est-elle une photo ? */
export function isImagePage(page: NotePage): page is ImagePage {
  return "image" in page;
}

/**
 * Le genre d'une page, en un mot.
 *
 * Trois genres et deux gardes de type : demander « est-ce le document ? » puis
 * « est-ce une photo ? » à chaque endroit finissait par en oublier un.
 */
export function pageKind(page: NotePage): "document" | "image" | "blank" {
  if (isBackdropPage(page)) return "document";
  if (isImagePage(page)) return "image";
  return "blank";
}

/**
 * Une image **posée sur** la page, à la place et à la taille qu'on veut.
 *
 * À ne pas confondre avec `ImagePage`, où l'image est la page. Là, c'est le
 * schéma qu'on glisse dans un coin de ses notes, à côté de ce qu'on écrit, ou
 * par-dessus un polycopié : il se déplace, s'agrandit et tourne, et l'on écrit
 * dessus — il passe **sous** l'encre.
 *
 * Tout est en proportion de la largeur de la page, comme les traits, et repéré
 * d'un bout à l'autre de la pile : une image posée suit donc le zoom, l'écran
 * d'un autre appareil et les pages qu'on insère avant elle, exactement comme
 * l'écriture voisine. Séparés, les deux finiraient par se décaler.
 *
 * `x` et `y` sont le coin haut-gauche **avant rotation** ; `angle` tourne autour
 * du centre, ce qui garde le cadre stable quand on règle l'orientation.
 */
export type ImagePosee = {
  id: string;
  /** Nom du fichier stocké. La même clef que `BackdropPage`, cf. `deltaTouche`. */
  file: string;
  x: number;
  y: number;
  /** Largeur, en proportion de celle de la page. */
  w: number;
  /** Hauteur sur largeur : on ne déforme pas une image. */
  ratio: number;
  /** En radians. */
  angle: number;
};

/**
 * Du texte posé sur la page : une zone qu'on tape, qu'on colle, qu'on déplace.
 *
 * Comme une image posée, elle est en proportion de la largeur de page — **sa taille
 * de caractères aussi** : elle suit le zoom et sort à la même taille sur le papier.
 * Le contenu est le même balisage que partout, donc gras, couleurs, listes et
 * symboles mathématiques n'ont rien à apprendre.
 *
 * `h` est mesuré à l'écran et gardé : le lasso, le toucher et le cadre en ont besoin,
 * et aucun d'eux n'a de quoi mettre du texte en page.
 */
export type ZoneTexte = {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Corps du texte, en proportion de la largeur de page. */
  taille: number;
  markup: string;
  angle: number;
};

/** Environ le corps 12 d'une page A4. */
export const TAILLE_TEXTE_DEFAUT = 0.024;
export const TAILLE_TEXTE_MIN = 0.008;
export const TAILLE_TEXTE_MAX = 0.2;
export const MAX_ZONES_TEXTE = 300;

/** Mise en page d'une zone : partagée par l'écran et le PDF, qui doivent coïncider. */
export const MISE_EN_PAGE_TEXTE = {
  interligne: 1.35,
  /** Entre deux paragraphes, en multiples du corps. */
  entreBlocs: 0.4,
  /** Retrait d'une liste, par niveau, en multiples du corps. */
  retrait: 1.2,
  /** Corps des titres de rang 1, 2 et 3, en multiples du corps. */
  titres: [1.35, 1.15, 1.05],
} as const;

/** Une zone a la même géométrie qu'une image de même format. */
function formeDeZone(zone: ZoneTexte): ImagePosee {
  return {
    id: zone.id,
    file: "",
    x: zone.x,
    y: zone.y,
    w: zone.w,
    ratio: zone.w > 0 ? zone.h / zone.w : 1,
    angle: zone.angle,
  };
}

export function centreTexte(zone: ZoneTexte): Point {
  return centreImage(formeDeZone(zone));
}

export function cadreTexte(zone: ZoneTexte): Bounds {
  return cadreImage(formeDeZone(zone));
}

export function pointSurTexte(point: Point, zone: ZoneTexte): boolean {
  return pointSurImage(point, formeDeZone(zone));
}

/**
 * Agrandir une zone agrandit son texte : c'est ce qu'on attend d'une sélection, et
 * la mise en page ne change pas.
 */
export function transformerTexte(zone: ZoneTexte, t: Transfo): ZoneTexte {
  const centre = transformerPoint(centreTexte(zone), t);
  const taille = Math.min(TAILLE_TEXTE_MAX, Math.max(TAILLE_TEXTE_MIN, zone.taille * t.echelle));
  const facteur = taille / zone.taille;
  const w = zone.w * facteur;
  const h = zone.h * facteur;
  return {
    ...zone,
    x: arrondi(centre.x - w / 2),
    y: arrondi(centre.y - h / 2),
    w: arrondi(w),
    h: arrondi(h),
    taille: arrondi(taille),
    angle: arrondi(normaliserAngle(zone.angle + t.angle)),
  };
}

/** Le texte brut des zones d'une page, pour la recherche. */
export function texteDesZones(zones: ZoneTexte[], enTexte: (markup: string) => string): string {
  return zones.map((zone) => enTexte(zone.markup)).join(" ");
}

/**
 * Les zones d'un contenu, sans analyser tout le contenu.
 *
 * `textes` est la dernière clef du document, et cette lecture a lieu à chaque
 * enregistrement : on repart de la fin, et une page de vingt mégaoctets ne coûte que
 * ce que pèsent ses zones.
 */
export function zonesDuContenu(raw: string): ZoneTexte[] {
  const debut = raw.lastIndexOf('"textes":[');
  if (debut === -1) return [];
  try {
    return lireZonesTexte(JSON.parse(raw.slice(debut + '"textes":'.length, raw.lastIndexOf("]") + 1)));
  } catch {
    return parseDrawing(raw).textes;
  }
}

/** Plus de deux cents images sur une surface, ce n'est plus une note. */
export const MAX_IMAGES_POSEES = 200;
/** En dessous, les poignées se recouvrent et l'image ne se rattrape plus. */
export const IMAGE_LARGEUR_MIN = 0.03;
export const IMAGE_LARGEUR_MAX = 3;

/** Identifiant d'une image posée — court : il vit dans un document de la base. */
export function nouvelIdImage(): string {
  return Math.random().toString(36).slice(2, 10);
}

/** Les quatre coins d'une image, rotation comprise. */
export function coinsImage(image: ImagePosee): Point[] {
  const h = image.w * image.ratio;
  const cx = image.x + image.w / 2;
  const cy = image.y + h / 2;
  const rotation: Transfo = { cx, cy, echelle: 1, angle: image.angle, dx: 0, dy: 0 };
  return [
    { x: image.x, y: image.y },
    { x: image.x + image.w, y: image.y },
    { x: image.x + image.w, y: image.y + h },
    { x: image.x, y: image.y + h },
  ].map((coin) => transformerPoint(coin, rotation));
}

/** Le centre d'une image : c'est lui qui décide de sa page, comme le milieu d'un trait. */
export function centreImage(image: ImagePosee): Point {
  return { x: image.x + image.w / 2, y: image.y + (image.w * image.ratio) / 2 };
}

/** Cadre d'une image, rotation comprise. */
export function cadreImage(image: ImagePosee): Bounds {
  const coins = coinsImage(image);
  return {
    minX: Math.min(...coins.map((c) => c.x)),
    minY: Math.min(...coins.map((c) => c.y)),
    maxX: Math.max(...coins.map((c) => c.x)),
    maxY: Math.max(...coins.map((c) => c.y)),
  };
}

/** Ce point tombe-t-il sur l'image ? On ramène le point dans le repère de l'image. */
export function pointSurImage(point: Point, image: ImagePosee): boolean {
  const centre = centreImage(image);
  const redresse = transformerPoint(point, {
    cx: centre.x,
    cy: centre.y,
    echelle: 1,
    angle: -image.angle,
    dx: 0,
    dy: 0,
  });
  return (
    redresse.x >= image.x &&
    redresse.x <= image.x + image.w &&
    redresse.y >= image.y &&
    redresse.y <= image.y + image.w * image.ratio
  );
}

/** Applique une transformation à une image posée, sans la déformer. */
export function transformerImage(image: ImagePosee, t: Transfo): ImagePosee {
  const centre = transformerPoint(centreImage(image), t);
  const w = Math.min(IMAGE_LARGEUR_MAX, Math.max(IMAGE_LARGEUR_MIN, image.w * t.echelle));
  return {
    ...image,
    x: arrondi(centre.x - w / 2),
    y: arrondi(centre.y - (w * image.ratio) / 2),
    w: arrondi(w),
    angle: arrondi(normaliserAngle(image.angle + t.angle)),
  };
}

function arrondi(value: number): number {
  return Math.round(value * 10000) / 10000;
}

/** Ramène un angle entre -π et π : un tour complet ne doit rien changer au contenu. */
function normaliserAngle(angle: number): number {
  const tour = Math.PI * 2;
  const reste = ((angle % tour) + tour) % tour;
  return reste > Math.PI ? reste - tour : reste;
}

export type DrawingContent = {
  strokes: Stroke[];
  ratio: number;
  /**
   * Fond de la surface, quand elle n'a qu'une page.
   *
   * Dès qu'il y a des pages, chacune porte le sien : une page ajoutée au milieu
   * d'un polycopié est à carreaux ou à lignes indépendamment de ses voisines.
   */
  paper: Paper;
  /**
   * Les pages de la surface, dans l'ordre, empilées les unes sous les autres.
   *
   * Un document est **une** surface, pas une page par bloc : on fait défiler
   * un polycopié d'un geste, on annote une figure à cheval sur deux pages, et
   * la palette reste la même du début à la fin. Vide pour une page blanche
   * simple, dont la hauteur est alors `ratio` et le fond `paper`.
   */
  pages: NotePage[];
  /** Les images posées sur la surface, de la plus basse à la plus haute. */
  images: ImagePosee[];
  /** Les zones de texte. **Toujours la dernière clef** : cf. `zonesDuContenu`. */
  textes: ZoneTexte[];
};

/**
 * Espace entre deux pages, en proportion de la largeur.
 *
 * Assez pour qu'on voie où finit une page, assez peu pour qu'on continue de
 * lire — c'est le blanc du massicot, pas une séparation.
 */
export const PAGE_GAP = 0.02;

/** Une page placée sur la surface, avec sa hauteur d'arrivée. */
export type PageBand = NotePage & { top: number };

/** Où tombe chaque page, en proportion de la largeur. */
export function pageBands(pages: NotePage[]): PageBand[] {
  const bands: PageBand[] = [];
  let top = 0;
  for (const page of pages) {
    bands.push({ ...page, top });
    top += page.ratio + PAGE_GAP;
  }
  return bands;
}

/** Hauteur totale de la pile, sans le blanc qui suivrait la dernière page. */
export function surfaceRatio(pages: NotePage[]): number {
  if (pages.length === 0) return DEFAULT_RATIO;
  return pages.reduce((total, page) => total + page.ratio, 0) + PAGE_GAP * (pages.length - 1);
}

/**
 * La page où tombe une ordonnée.
 *
 * Dans le blanc entre deux pages, on rend la plus proche : un trait posé à
 * cheval appartient bien à l'une des deux, et il n'y a pas de troisième
 * réponse utile.
 */
export function pageAtY(bands: PageBand[], y: number): number {
  if (bands.length === 0) return -1;
  for (let i = 0; i < bands.length; i++) {
    if (y < bands[i].top + bands[i].ratio) return i;
  }
  return bands.length - 1;
}

/**
 * Insère une page, avec son fond, juste après la page `apres`.
 *
 * `apres` vaut -1 pour glisser la feuille **avant** la première page.
 *
 * Tout est là : les traits déjà posés plus bas doivent **descendre avec leur
 * page**. Les traits sont repérés d'un bout à l'autre de la pile — c'est ce qui
 * permet d'annoter à cheval sur deux pages — donc ajouter une feuille au milieu
 * d'un polycopié décalerait sinon toutes les annotations qui suivent d'une
 * hauteur de page, chacune tombant sur la page d'à côté.
 *
 * La page appartenance d'un trait se décide par son **milieu**, exactement
 * comme à l'export : c'est la seule façon de rendre la même réponse ici et sur
 * le papier.
 */
export function insertPage(
  content: DrawingContent,
  apres: number,
  paper: Paper,
): DrawingContent {
  /*
   * Une page manuscrite simple n'est pas encore une pile ; elle le devient,
   * exactement comme pour une photo ou un document.
   *
   * On rendait ici le contenu inchangé, au motif qu'« ajouter une feuille à une
   * page simple, c'est ajouter un bloc ». Ce n'est pas la même chose : un bloc
   * est une autre surface, avec sa propre palette, sans annotation à cheval et
   * sans numéro de page. Et comme la palette masquait le bouton dans ce cas, la
   * page sur laquelle s'ouvre **chaque note neuve** ne pouvait pas grandir.
   */
  const pile = enPile(content);
  const rang = Math.max(-1, Math.min(pile.pages.length - 1, Math.trunc(apres)));
  return insererPages(pile, rang, [{ paper, ratio: formatDeFeuille(pile.pages, rang) }]);
}

/**
 * Le format d'une feuille qu'on ajoute : celui du **papier** le plus proche.
 *
 * Une feuille glissée dans un polycopié A4 est une feuille A4, sinon la pile se
 * met à bégayer d'une page à l'autre. Mais une **photo** n'est pas un format à
 * imiter : une feuille ajoutée après un cliché en paysage sortait en paysage,
 * et l'on écrivait ses notes sur une bande deux fois plus large que haute. On
 * saute donc les images — en arrière d'abord, puisque c'est la voisine
 * immédiate qui compte, puis en avant — et à défaut de tout papier, on prend le
 * format par défaut d'une page.
 */
function formatDeFeuille(pages: NotePage[], rang: number): number {
  const depart = Math.max(0, rang);
  for (let i = depart; i >= 0; i--) {
    if (pages[i] && pageKind(pages[i]) !== "image") return pages[i].ratio;
  }
  for (let i = depart + 1; i < pages.length; i++) {
    if (pageKind(pages[i]) !== "image") return pages[i].ratio;
  }
  return DEFAULT_RATIO;
}

/**
 * Glisse une photo, devenue page, juste après la page `apres`.
 *
 * C'est `insertPage` pour une image : même place, et surtout mêmes annotations
 * qui descendent avec leur page. La photo garde **son** format — une photo en
 * paysage ne se déforme pas pour ressembler à sa voisine A4.
 *
 * Une page manuscrite simple n'a pas encore de pile. Elle en devient une : sa
 * surface forme la première page, avec son format, son fond et ses traits — qui
 * ne bougent pas, cette page commençant en haut — et la photo vient après.
 */
export function insertImagePage(
  content: DrawingContent,
  apres: number,
  image: string,
  ratio: number,
): DrawingContent {
  const format = Math.min(MAX_RATIO, Math.max(0.1, ratio));
  const pile = enPile(content);
  const rang = Math.max(-1, Math.min(pile.pages.length - 1, Math.trunc(apres)));
  return insererPages(pile, rang, [{ image, ratio: Number(format.toFixed(4)) }]);
}

/**
 * Glisse les pages d'un document importé juste après la page `apres`.
 *
 * On ajoute un document Word ou un PDF à une note déjà commencée : ses pages
 * prennent place après celle qu'on regarde, comme une photo, et tout ce qui
 * était écrit plus bas descend d'autant. Une page manuscrite simple devient une
 * pile, comme pour `insertImagePage`.
 *
 * Tout ou rien : un document qui ferait dépasser le nombre maximal de pages
 * n'est pas tronqué, il est refusé — le contenu revient inchangé.
 */
export function insertDocumentPages(
  content: DrawingContent,
  apres: number,
  file: string,
  ratios: number[],
): DrawingContent {
  if (ratios.length === 0) return content;
  const pile = enPile(content);
  const rang = Math.max(-1, Math.min(pile.pages.length - 1, Math.trunc(apres)));
  return insererPages(
    pile,
    rang,
    // Les mêmes bornes qu'à l'import d'un document en bloc séparé.
    ratios.map((ratio, index) => ({ file, page: index + 1, ratio: Math.min(MAX_RATIO, Math.max(0.2, ratio)) })),
  );
}

/** Une page manuscrite simple, devenue la première page d'une pile. */
function enPile(content: DrawingContent): DrawingContent {
  return content.pages.length > 0
    ? content
    : { ...content, pages: [{ paper: content.paper ?? "blank", ratio: content.ratio }] };
}

/** Le cœur des insertions : les pages prennent leur place, et ce qui suit descend. */
function insererPages(content: DrawingContent, rang: number, nouvelles: NotePage[]): DrawingContent {
  const pages = content.pages;
  if (pages.length + nouvelles.length > MAX_DOCUMENT_PAGES) return content;

  const bandes = pageBands(pages);
  const decalage = nouvelles.reduce((somme, page) => somme + page.ratio + PAGE_GAP, 0);
  const strokes = content.strokes.map((stroke) => {
    const boite = boundsOf(stroke.points);
    if (!boite) return stroke;
    const sur = pageAtY(bandes, (boite.minY + boite.maxY) / 2);
    if (sur <= rang) return stroke;
    return { ...stroke, points: translateStroke(stroke.points, 0, decalage) };
  });
  // Une image posée descend avec sa page, pour la même raison qu'un trait.
  const images = (content.images ?? []).map((image) =>
    pageAtY(bandes, centreImage(image).y) <= rang ? image : { ...image, y: arrondi(image.y + decalage) },
  );
  const textes = (content.textes ?? []).map((zone) =>
    pageAtY(bandes, centreTexte(zone).y) <= rang ? zone : { ...zone, y: arrondi(zone.y + decalage) },
  );

  const suivantes = [...pages.slice(0, rang + 1), ...nouvelles, ...pages.slice(rang + 1)];
  return { ...content, pages: suivantes, ratio: surfaceRatio(suivantes), strokes, images, textes };
}

/**
 * Retire une page de la pile, et ce qui était écrit dessus.
 *
 * Réservé aux pages **ajoutées** : retirer une page du document importé
 * laisserait la pile en désaccord avec le fichier, et l'export irait chercher
 * une page qui n'est plus là. Les traits des pages suivantes remontent, pour la
 * raison inverse de `insertPage`.
 */
export function removePage(content: DrawingContent, index: number): DrawingContent {
  const pages = content.pages;
  const cible = pages[index];
  // On ne laisse pas une pile vide : une surface sans page n'a plus de hauteur.
  // Une page du document, elle, ne se retire pas — la pile serait en désaccord
  // avec le fichier. Une photo, si : elle n'appartient qu'à cette note.
  if (!cible || pages.length < 2 || isBackdropPage(cible)) return content;

  const bandes = pageBands(pages);
  const decalage = cible.ratio + PAGE_GAP;
  const strokes: Stroke[] = [];
  for (const stroke of content.strokes) {
    const boite = boundsOf(stroke.points);
    if (!boite) continue;
    const sur = pageAtY(bandes, (boite.minY + boite.maxY) / 2);
    // Ce qui était sur la page part avec elle.
    if (sur === index) continue;
    strokes.push(
      sur < index ? stroke : { ...stroke, points: translateStroke(stroke.points, 0, -decalage) },
    );
  }

  const images: ImagePosee[] = [];
  for (const image of content.images ?? []) {
    const sur = pageAtY(bandes, centreImage(image).y);
    if (sur === index) continue;
    images.push(sur < index ? image : { ...image, y: arrondi(image.y - decalage) });
  }
  const textes: ZoneTexte[] = [];
  for (const zone of content.textes ?? []) {
    const sur = pageAtY(bandes, centreTexte(zone).y);
    if (sur === index) continue;
    textes.push(sur < index ? zone : { ...zone, y: arrondi(zone.y - decalage) });
  }

  const suivantes = pages.filter((_, i) => i !== index);
  return { ...content, pages: suivantes, ratio: surfaceRatio(suivantes), strokes, images, textes };
}

/**
 * Fichiers auxquels le contenu d'un bloc se réfère.
 *
 * Un document importé et une photo vivent sur le disque, pas dans la note : le
 * bloc n'en garde que le nom. Supprimer la note sans les effacer laisse des
 * fichiers que plus rien ne désigne — et une photothèque de cours en accumule
 * vite plusieurs centaines de mégaoctets.
 *
 * Fonction **pure**, pour être éprouvée sans disque ni base : c'est elle qui
 * décide de ce qui sera effacé, et une erreur ici efface ce qu'il ne fallait
 * pas.
 */
export function blockFiles(kind: string, content: string): string[] {
  if (kind === "image") {
    const { file } = parseImageBlock(content);
    return file ? [file] : [];
  }
  if (kind !== "drawing") return [];
  const noms = new Set<string>();
  const dessin = parseDrawing(content);
  for (const page of dessin.pages) {
    if (isBackdropPage(page)) noms.add(page.file);
    else if (isImagePage(page)) noms.add(page.image);
  }
  for (const image of dessin.images) noms.add(image.file);
  return [...noms];
}

/** Un polycopié de plus de deux cents pages n'est pas une note. */
export const MAX_DOCUMENT_PAGES = 200;
/*
 * Pas de plafond sur le nombre de traits : on annote autant qu'on veut.
 *
 * Il y en avait un — quatre mille, soit dix à vingt pages d'écriture dans un
 * polycopié, dont tous les traits vivent dans le même bloc —, et
 * `parseDrawing` taillait au-delà sans rien dire : les traits suivants
 * disparaissaient au rechargement. Ce qui borne un bloc, c'est son poids
 * (`MAX_BLOCK_BYTES`), et il est vérifié là où il faut : à l'enregistrement,
 * avec un refus qui se dit.
 */
export const MAX_POINTS_PER_STROKE = 30000;
/**
 * Hauteur du bloc, en proportion de sa largeur.
 *
 * La page s'allonge à mesure qu'on écrit près du bas, comme un cahier qu'on
 * déroule : le ratio peut donc monter bien au-delà d'un écran.
 */
export const DEFAULT_RATIO = 0.75;
export const MAX_RATIO = 12;

export function parseDrawing(raw: string): DrawingContent {
  const data = safeParse(raw);
  const strokes = Array.isArray(data?.strokes) ? data.strokes : [];
  const ratio =
    typeof data?.ratio === "number" && data.ratio > 0.1 && data.ratio <= MAX_RATIO ? data.ratio : DEFAULT_RATIO;
  const paper = (PAPERS as readonly unknown[]).includes(data?.paper) ? (data!.paper as Paper) : "blank";

  /*
   * Le fond, ramené à une liste de pages.
   *
   * Les premières notes rangeaient une page par bloc, sous la clef `backdrop`.
   * On les relit ici comme un document d'une seule page : le reste de
   * l'application n'a plus qu'une forme à connaître, et les anciennes notes
   * s'ouvrent sans conversion.
   */
  const page = (brut: unknown, secours: number): NotePage | null => {
    const b = brut as
      | (Partial<BackdropPage> & Partial<BlankPage> & Partial<ImagePage>)
      | null
      | undefined;
    if (!b) return null;
    const r = typeof b.ratio === "number" && b.ratio > 0.1 && b.ratio <= MAX_RATIO ? b.ratio : secours;
    // Une page de document se reconnaît à son fichier ; tout le reste est une
    // page ajoutée, et son fond vaut « uni » si l'on n'en reconnaît pas le nom.
    if (typeof b.file === "string" && Number.isInteger(b.page) && (b.page as number) >= 1) {
      return { file: b.file.slice(0, 128), page: b.page as number, ratio: r };
    }
    // Une photo : le nom est validé à l'affichage comme partout, mais on borne
    // ici pour qu'un contenu abîmé ne fasse pas grossir le bloc.
    if (typeof b.image === "string" && b.image.length > 0) {
      return { image: b.image.slice(0, 128), ratio: r };
    }
    if ((PAPERS as readonly unknown[]).includes(b.paper)) {
      return { paper: b.paper as Paper, ratio: r };
    }
    return null;
  };

  const pages: NotePage[] = Array.isArray(data?.pages)
    ? (data.pages as unknown[])
        .slice(0, MAX_DOCUMENT_PAGES)
        .map((p) => page(p, DEFAULT_RATIO))
        .filter((p): p is NotePage => p !== null)
    : [page(data?.backdrop, ratio)].filter((p): p is NotePage => p !== null);

  return {
    // La hauteur d'un document est celle de ses pages : elle ne se décide pas.
    ratio: pages.length > 0 ? surfaceRatio(pages) : ratio,
    paper,
    pages,
    strokes: strokes
      .map((stroke: unknown) => {
        const s = stroke as Partial<Stroke> | null;
        const points = Array.isArray(s?.points) ? s.points : [];
        return {
          color: typeof s?.color === "string" ? s.color.slice(0, 32) : "ink",
          size: typeof s?.size === "number" && s.size > 0 ? Math.min(s.size, 60) : 2,
          tool: (TOOLS as readonly unknown[]).includes(s?.tool) ? (s!.tool as Tool) : "pen",
          // Un multiple de trois : un point tronqué décalerait tout le trait.
          points: points
            .slice(0, MAX_POINTS_PER_STROKE)
            .filter((n: unknown): n is number => typeof n === "number" && Number.isFinite(n)),
        };
      })
      .map((stroke) => ({
        ...stroke,
        points: stroke.points.slice(0, stroke.points.length - (stroke.points.length % 3)),
      }))
      .filter((stroke) => stroke.points.length >= 3),
    /*
     * Après les traits, et pas avant : l'enregistrement n'envoie que ce qui a
     * changé entre le début et la fin du texte. Placée devant, cette clef neuve
     * faisait de tout le document « ce qui a changé » au premier trait écrit dans
     * une note d'avant — vingt mégaoctets pour un trait.
     */
    images: lireImagesPosees(data?.images),
    textes: lireZonesTexte(data?.textes),
  };
}

function lireZonesTexte(brut: unknown): ZoneTexte[] {
  if (!Array.isArray(brut)) return [];
  const zones: ZoneTexte[] = [];
  for (const entree of brut.slice(0, MAX_ZONES_TEXTE)) {
    const z = entree as Partial<ZoneTexte> | null;
    if (!z || typeof z.markup !== "string") continue;
    if (![z.x, z.y, z.w].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    zones.push({
      id: typeof z.id === "string" && z.id ? z.id.slice(0, 32) : nouvelIdImage(),
      x: z.x as number,
      y: z.y as number,
      w: Math.min(IMAGE_LARGEUR_MAX, Math.max(IMAGE_LARGEUR_MIN, z.w as number)),
      h: typeof z.h === "number" && z.h > 0 ? z.h : TAILLE_TEXTE_DEFAUT * MISE_EN_PAGE_TEXTE.interligne,
      taille:
        typeof z.taille === "number" && Number.isFinite(z.taille)
          ? Math.min(TAILLE_TEXTE_MAX, Math.max(TAILLE_TEXTE_MIN, z.taille))
          : TAILLE_TEXTE_DEFAUT,
      markup: z.markup.slice(0, MAX_TEXT_LENGTH),
      angle: typeof z.angle === "number" && Number.isFinite(z.angle) ? z.angle : 0,
    });
  }
  return zones;
}

/**
 * Relit les images posées, en écartant ce qui ne s'afficherait pas.
 *
 * Une image sans fichier ou sans largeur n'est pas réparable : on la laisse de
 * côté plutôt que de faire échouer la page qui la porte.
 */
function lireImagesPosees(brut: unknown): ImagePosee[] {
  if (!Array.isArray(brut)) return [];
  const images: ImagePosee[] = [];
  for (const entree of brut.slice(0, MAX_IMAGES_POSEES)) {
    const i = entree as Partial<ImagePosee> | null;
    if (!i || typeof i.file !== "string" || i.file.length === 0) continue;
    if (![i.x, i.y, i.w, i.ratio].every((n) => typeof n === "number" && Number.isFinite(n))) continue;
    images.push({
      id: typeof i.id === "string" && i.id ? i.id.slice(0, 32) : nouvelIdImage(),
      file: i.file.slice(0, 128),
      x: i.x as number,
      y: i.y as number,
      w: Math.min(IMAGE_LARGEUR_MAX, Math.max(IMAGE_LARGEUR_MIN, i.w as number)),
      ratio: Math.min(MAX_RATIO, Math.max(0.05, i.ratio as number)),
      angle: typeof i.angle === "number" && Number.isFinite(i.angle) ? i.angle : 0,
    });
  }
  return images;
}

// --- Image dans le fil de la note --------------------------------------------

/**
 * Une image au milieu du texte, à la largeur qu'on veut.
 *
 * C'est l'image d'un document : elle prend sa place dans le fil, le texte
 * reprend dessous. L'image **posée** (`ImagePosee`) est l'autre geste, celui du
 * schéma qu'on glisse sur une page manuscrite pour écrire dessus.
 *
 * `largeur` est une proportion de la colonne plutôt que des pixels : la même
 * note se relit sur un téléphone et un iPad, et l'image y garde sa place.
 */
export const IMAGE_ALIGNEMENTS = ["left", "center", "right"] as const;
export type ImageAlignement = (typeof IMAGE_ALIGNEMENTS)[number];

export type ImageBlockContent = {
  file: string;
  ratio: number;
  largeur: number;
  align: ImageAlignement;
  legende: string;
};

export const IMAGE_BLOC_LARGEUR_MIN = 0.15;
export const MAX_LEGENDE = 300;

export function parseImageBlock(raw: string): ImageBlockContent {
  const data = safeParse(raw);
  const largeur = data?.largeur;
  const ratio = data?.ratio;
  return {
    file: typeof data?.file === "string" ? data.file.slice(0, 128) : "",
    ratio: typeof ratio === "number" && ratio > 0.05 && ratio <= MAX_RATIO ? ratio : 1,
    largeur:
      typeof largeur === "number" && Number.isFinite(largeur)
        ? Math.min(1, Math.max(IMAGE_BLOC_LARGEUR_MIN, largeur))
        : 1,
    align: (IMAGE_ALIGNEMENTS as readonly unknown[]).includes(data?.align)
      ? (data!.align as ImageAlignement)
      : "center",
    legende: typeof data?.legende === "string" ? data.legende.slice(0, MAX_LEGENDE) : "",
  };
}

/**
 * Une image du fil de la note, redite comme une page manuscrite.
 *
 * L'export PDF et la sauvegarde ne savent produire que des pages manuscrites :
 * plutôt que d'y apprendre un genre de bloc de plus, l'image devient une page
 * blanche qui la porte à sa largeur et à sa place. Rend `null` pour un bloc qui
 * n'a pas (encore) d'image.
 */
export function imageEnDessin(raw: string): string | null {
  const image = parseImageBlock(raw);
  if (!image.file) return null;
  const marge = 0.05;
  const colonne = 1 - marge * 2;
  const w = colonne * image.largeur;
  const x =
    image.align === "left" ? marge : image.align === "right" ? 1 - marge - w : (1 - w) / 2;
  const ratio = Math.min(MAX_RATIO, w * image.ratio + marge * 2);
  return JSON.stringify({
    strokes: [],
    ratio,
    paper: "blank",
    pages: [{ paper: "blank", ratio }],
    images: [{ id: "bloc", file: image.file, x, y: marge, w, ratio: image.ratio, angle: 0 }],
    textes: [],
  } satisfies DrawingContent);
}

/** Les contenus d'une note qui font une page d'un PDF, dans l'ordre de la note. */
export function contenusImprimables(blocs: { kind: string; content: string }[]): string[] {
  const contenus: string[] = [];
  for (const bloc of blocs) {
    if (bloc.kind === "drawing") contenus.push(bloc.content);
    else if (bloc.kind === "image") {
      const page = imageEnDessin(bloc.content);
      if (page) contenus.push(page);
    }
  }
  return contenus;
}

// --- Commun -----------------------------------------------------------------

export function defaultContent(kind: BlockKind): string {
  if (kind === "text") return JSON.stringify({ style: "p", markup: "" } satisfies TextContent);
  if (kind === "table") return JSON.stringify(emptyTable());
  if (kind === "image") {
    return JSON.stringify({
      file: "",
      ratio: 1,
      largeur: 1,
      align: "center",
      legende: "",
    } satisfies ImageBlockContent);
  }
  return JSON.stringify({
    strokes: [],
    ratio: DEFAULT_RATIO,
    paper: "blank",
    pages: [],
    images: [],
    textes: [],
  } satisfies DrawingContent);
}

/**
 * Garde-fou sur le poids d'un bloc — pas une limite d'usage.
 *
 * Elle était de deux mégaoctets, pensée pour une page — or un document importé
 * est un seul bloc pour toutes ses pages. Un trait d'une seconde au Pencil
 * pèse environ cinq kilooctets (240 points) : deux mégaoctets, c'était quatre
 * cents traits, une à deux pages d'écriture. Au-delà, le serveur répondait 413,
 * la file cessait de réessayer, et l'on annotait pour rien.
 *
 * On doit pouvoir annoter autant qu'on veut. Cent vingt-huit mégaoctets, c'est
 * vingt-cinq mille secondes de Pencil : les deux cents pages qu'un document
 * peut compter (`MAX_DOCUMENT_PAGES`), écrites jusqu'au bord, n'y arrivent pas.
 * Ce qui reste, c'est la protection contre un client fautif qui enverrait un
 * gigaoctet. Ce n'est tenable que parce que l'enregistrement automatique
 * n'envoie plus que ce qui a changé (`lib/bloc-delta.ts`).
 */
export const MAX_BLOCK_BYTES = 128_000_000;

/** Titre affiché pour une note sans titre saisi. */
export const UNTITLED = "Note sans titre";

function safeParse(raw: string): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    // JSON tronqué ou corrompu : le bloc repart vide, la note reste lisible.
    return null;
  }
}

/**
 * Texte indexé d'une note : son titre et ce qu'on peut en lire.
 *
 * Les croquis n'y contribuent pas — on ne sait pas lire une écriture
 * manuscrite — et surtout ils ne sont **pas relus** pour construire l'index :
 * une page dense pèse des centaines de kilooctets, la recharger à chaque
 * enregistrement automatique coûterait plus que tout le reste.
 */
export function noteSearchText(
  title: string,
  blocks: { kind: string; content: string; plain?: string }[],
  toPlainText: (markup: string) => string,
): string {
  const morceaux = [title];
  for (const bloc of blocks) {
    if (bloc.kind === "text") morceaux.push(toPlainText(parseText(bloc.content).markup));
    else if (bloc.kind === "table") morceaux.push(parseTable(bloc.content).rows.flat().join(" "));
    else if (bloc.kind === "image") morceaux.push(parseImageBlock(bloc.content).legende);
    else if (bloc.kind === "drawing") morceaux.push(bloc.plain ?? "");
  }
  return morceaux.join(" ");
}

/**
 * Aperçu d'une note : de quoi dessiner une vignette sans relire ses blocs.
 *
 * Deux formes seulement. Un document importé se résume à son fichier et son
 * numéro de page — quelques octets, et pdf.js sait en tirer une image. Une page
 * manuscrite est réduite à un échantillon de traits : assez pour reconnaître sa
 * page d'un coup d'œil, pas assez pour peser.
 */
export type NotePreview =
  | { kind: "pdf"; file: string; page: number; ratio: number }
  | { kind: "image"; file: string; ratio: number }
  | { kind: "ink"; ratio: number; strokes: { color: string; points: number[] }[] }
  | { kind: "texte"; ratio: number; texte: string }
  | null;

/*
 * Traits retenus pour l'aperçu, et points par trait.
 *
 * Une vignette n'a qu'à être reconnaissable. Ces bornes tiennent l'aperçu sous
 * trois kilooctets : cent notes affichées pèsent alors à peine plus qu'une
 * seule page manuscrite chargée en entier.
 */
const PREVIEW_STROKES = 24;
const PREVIEW_POINTS = 12;

export function buildPreview(kind: string, content: string): NotePreview {
  if (kind === "image") {
    const image = parseImageBlock(content);
    return image.file ? { kind: "image", file: image.file, ratio: image.ratio } : null;
  }
  if (kind !== "drawing") return null;
  const page = parseDrawing(content);

  // L'aperçu d'un document, c'est sa première page — celle qu'on reconnaît.
  // Une page ajoutée n'a pas d'image : on retombe alors sur les traits.
  const premiere = page.pages[0];
  if (premiere && isBackdropPage(premiere)) {
    return { kind: "pdf", file: premiere.file, page: premiere.page, ratio: premiere.ratio };
  }
  if (premiere && isImagePage(premiere)) {
    return { kind: "image", file: premiere.image, ratio: premiere.ratio };
  }
  if (page.strokes.length === 0) {
    // Rien d'écrit, mais une photo ou un document plus bas dans la pile : c'est
    // la page vierge d'une note neuve, dans laquelle on a glissé une image
    // depuis la barre d'outils. La vignette montre l'image, pas le blanc.
    const illustree = page.pages.find((p) => isBackdropPage(p) || isImagePage(p));
    if (illustree && isBackdropPage(illustree)) {
      return { kind: "pdf", file: illustree.file, page: illustree.page, ratio: illustree.ratio };
    }
    if (illustree && isImagePage(illustree)) {
      return { kind: "image", file: illustree.image, ratio: illustree.ratio };
    }
    // Une image posée sur une page par ailleurs vide : même règle.
    const posee = page.images[0];
    if (posee) return { kind: "image", file: posee.file, ratio: posee.ratio };
    // Une page de texte tapé : les premiers mots, sans le balisage.
    const zone = page.textes[0];
    if (!zone) return null;
    return {
      kind: "texte",
      ratio: page.ratio,
      texte: zone.markup.replace(/[*_~`#]|\{c:[a-z]+\}|\{\/c\}/g, "").slice(0, 280),
    };
  }

  return {
    kind: "ink",
    ratio: page.ratio,
    // Échantillonné, pas tronqué : garder les soixante premiers traits ne
    // montrerait que le coin supérieur gauche d'une page bien remplie.
    strokes: echantillon(page.strokes, PREVIEW_STROKES).map((stroke) => ({
      color: stroke.color,
      points: reduirePoints(stroke.points, PREVIEW_POINTS),
    })),
  };
}

/**
 * L'aperçu d'une note : celui de sa première page manuscrite **qui montre
 * quelque chose**.
 *
 * C'était celui de la première page manuscrite, tout court. Tant qu'une note
 * neuve commençait par un paragraphe, cela revenait au même. Depuis qu'elle
 * s'ouvre sur une page manuscrite vierge, on y importe un polycopié ou une
 * photo — qui arrivent **après** cette page — et la vignette restait vide : la
 * première page n'a ni trait ni image, `buildPreview` rend `null`.
 *
 * Les pages sont **lues à la demande**, dans l'ordre de la note, et la lecture
 * s'arrête à la première qui donne un aperçu. Une page dense pèse jusqu'à deux
 * mégaoctets, et l'aperçu est recalculé à chaque enregistrement : tout relire
 * reviendrait à charger la note entière chaque seconde pendant qu'on écrit.
 *
 * `source` désigne la page retenue : si elle précède celle qu'on vient
 * d'enregistrer, l'aperçu n'a pas pu changer et il n'y a rien à réécrire.
 *
 * C'est la seule règle : les endroits qui recalculent l'aperçu passent tous par
 * ici, faute de quoi deux d'entre eux finiraient par désigner deux pages.
 */
export async function notePreview(
  ids: string[],
  lire: (id: string) => Promise<string | null> | string | null,
  genreDe: (id: string) => string = () => "drawing",
): Promise<{ apercu: NotePreview; source: string | null }> {
  for (const id of ids) {
    const contenu = await lire(id);
    if (contenu === null) continue;
    const apercu = buildPreview(genreDe(id), contenu);
    if (apercu) return { apercu, source: id };
  }
  return { apercu: null, source: null };
}

export function parsePreview(raw: string): NotePreview {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.kind === "pdf" && typeof data.file === "string" && Number.isInteger(data.page)) {
      return { kind: "pdf", file: data.file, page: data.page, ratio: ratioOf(data.ratio) };
    }
    if (data?.kind === "image" && typeof data.file === "string") {
      return { kind: "image", file: data.file, ratio: ratioOf(data.ratio) };
    }
    if (data?.kind === "texte" && typeof data.texte === "string") {
      return { kind: "texte", ratio: ratioOf(data.ratio), texte: data.texte };
    }
    if (data?.kind === "ink" && Array.isArray(data.strokes)) {
      return {
        kind: "ink",
        ratio: ratioOf(data.ratio),
        strokes: data.strokes
          .slice(0, PREVIEW_STROKES)
          .map((s: { color?: unknown; points?: unknown }) => ({
            color: typeof s?.color === "string" ? s.color : "default",
            points: Array.isArray(s?.points)
              ? s.points.filter((n: unknown): n is number => typeof n === "number")
              : [],
          }))
          .filter((s: { points: number[] }) => s.points.length >= 4),
      };
    }
  } catch {
    // Aperçu illisible : la note s'affiche sans vignette, rien de plus.
  }
  return null;
}

function ratioOf(value: unknown): number {
  return typeof value === "number" && value > 0.1 && value <= MAX_RATIO ? value : DEFAULT_RATIO;
}

/** Prend n éléments régulièrement répartis, plutôt que les n premiers. */
function echantillon<T>(items: T[], n: number): T[] {
  if (items.length <= n) return items;
  const pas = items.length / n;
  return Array.from({ length: n }, (_, i) => items[Math.floor(i * pas)]);
}

/**
 * Réduit un trait à n points, en ne gardant que x et y.
 *
 * Les coordonnées sont exprimées en **millièmes entiers** : « 123 » au lieu de
 * « 0.123 » divise par deux le poids de l'aperçu, pour une précision qui
 * dépasse déjà largement celle d'une vignette.
 */
function reduirePoints(flat: number[], n: number): number[] {
  const total = Math.floor(flat.length / 3);
  if (total === 0) return [];
  const garder = Math.min(total, n);
  const pas = total / garder;
  const sortie: number[] = [];
  for (let i = 0; i < garder; i++) {
    const index = Math.floor(i * pas) * 3;
    sortie.push(Math.round(flat[index] * 1000), Math.round(flat[index + 1] * 1000));
  }
  return sortie;
}
