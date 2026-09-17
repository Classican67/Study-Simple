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
import { boundsOf, translateStroke } from "@/lib/ink";

export const BLOCK_KINDS = ["text", "table", "drawing"] as const;
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

export const MAX_TEXT_LENGTH = 20000;

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
export const TOOLS = ["pen", "highlighter"] as const;
export type Tool = (typeof TOOLS)[number];

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

  const suivantes = [...pages.slice(0, rang + 1), ...nouvelles, ...pages.slice(rang + 1)];
  return { ...content, pages: suivantes, ratio: surfaceRatio(suivantes), strokes };
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

  const suivantes = pages.filter((_, i) => i !== index);
  return { ...content, pages: suivantes, ratio: surfaceRatio(suivantes), strokes };
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
  if (kind !== "drawing") return [];
  const noms = new Set<string>();
  for (const page of parseDrawing(content).pages) {
    if (isBackdropPage(page)) noms.add(page.file);
    else if (isImagePage(page)) noms.add(page.image);
  }
  return [...noms];
}

/** Un polycopié de plus de deux cents pages n'est pas une note. */
export const MAX_DOCUMENT_PAGES = 200;
export const MAX_STROKES = 4000;
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
      .slice(0, MAX_STROKES)
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
  };
}

// --- Commun -----------------------------------------------------------------

export function defaultContent(kind: BlockKind): string {
  if (kind === "text") return JSON.stringify({ style: "p", markup: "" } satisfies TextContent);
  if (kind === "table") return JSON.stringify(emptyTable());
  return JSON.stringify({
    strokes: [],
    ratio: DEFAULT_RATIO,
    paper: "blank",
    pages: [],
  } satisfies DrawingContent);
}

/**
 * Taille maximale d'un bloc enregistré. Une page dense au stylet approche les
 * 300 Ko ; la borne laisse de la marge sans permettre qu'une note fasse tomber
 * la base.
 */
export const MAX_BLOCK_BYTES = 2_000_000;

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
  blocks: { kind: string; content: string }[],
  toPlainText: (markup: string) => string,
): string {
  const morceaux = [title];
  for (const bloc of blocks) {
    if (bloc.kind === "text") morceaux.push(toPlainText(parseText(bloc.content).markup));
    else if (bloc.kind === "table") morceaux.push(parseTable(bloc.content).rows.flat().join(" "));
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
    return null;
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
): Promise<{ apercu: NotePreview; source: string | null }> {
  for (const id of ids) {
    const contenu = await lire(id);
    if (contenu === null) continue;
    const apercu = buildPreview("drawing", contenu);
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
