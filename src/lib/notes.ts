/**
 * Blocs de note — formes, valeurs par défaut et bornes. Sans base ni DOM.
 *
 * Le contenu d'un bloc est stocké en JSON dans une colonne de texte : sa forme
 * dépend du type, et c'est ici qu'elle est décrite. Toutes les lectures sont
 * **tolérantes** — un JSON tronqué, un champ manquant ou d'un autre type
 * renvoie un bloc vide plutôt qu'une exception. Une note ne doit pas devenir
 * illisible en entier parce qu'un bloc l'est.
 */

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
 * Page de document servant de fond, pour l'annoter.
 *
 * `file` est le PDF stocké — tout import est converti en PDF — et `page` le
 * numéro de page, à partir de 1. Le fond n'est pas recopié dans le bloc : un
 * même document sert de fond à toutes ses pages, une par bloc.
 */
export type Backdrop = { file: string; page: number };

/** Une page du document, avec son format à elle. */
export type BackdropPage = Backdrop & { ratio: number };

export type DrawingContent = {
  strokes: Stroke[];
  ratio: number;
  paper: Paper;
  /**
   * Les pages du document importé, dans l'ordre, empilées sur cette surface.
   *
   * Un document est **une** surface, pas une page par bloc : on fait défiler
   * un polycopié d'un geste, on annote une figure à cheval sur deux pages, et
   * la palette reste la même du début à la fin. Vide pour une page blanche.
   */
  pages: BackdropPage[];
};

/**
 * Espace entre deux pages, en proportion de la largeur.
 *
 * Assez pour qu'on voie où finit une page, assez peu pour qu'on continue de
 * lire — c'est le blanc du massicot, pas une séparation.
 */
export const PAGE_GAP = 0.02;

/** Une page du document, placée sur la surface. */
export type PageBand = BackdropPage & { top: number };

/** Où tombe chaque page du document, en proportion de la largeur. */
export function pageBands(pages: BackdropPage[]): PageBand[] {
  const bands: PageBand[] = [];
  let top = 0;
  for (const page of pages) {
    bands.push({ ...page, top });
    top += page.ratio + PAGE_GAP;
  }
  return bands;
}

/** Hauteur totale du document, sans le blanc qui suivrait la dernière page. */
export function documentRatio(pages: BackdropPage[]): number {
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
  const page = (brut: unknown, secours: number): BackdropPage | null => {
    const b = brut as Partial<BackdropPage> | null | undefined;
    if (!b || typeof b.file !== "string" || !Number.isInteger(b.page) || (b.page as number) < 1) {
      return null;
    }
    const r = typeof b.ratio === "number" && b.ratio > 0.1 && b.ratio <= MAX_RATIO ? b.ratio : secours;
    return { file: b.file.slice(0, 128), page: b.page as number, ratio: r };
  };

  const pages: BackdropPage[] = Array.isArray(data?.pages)
    ? (data.pages as unknown[])
        .slice(0, MAX_DOCUMENT_PAGES)
        .map((p) => page(p, DEFAULT_RATIO))
        .filter((p): p is BackdropPage => p !== null)
    : [page(data?.backdrop, ratio)].filter((p): p is BackdropPage => p !== null);

  return {
    // La hauteur d'un document est celle de ses pages : elle ne se décide pas.
    ratio: pages.length > 0 ? documentRatio(pages) : ratio,
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
  const premiere = page.pages[0];
  if (premiere) {
    return { kind: "pdf", file: premiere.file, page: premiere.page, ratio: premiere.ratio };
  }
  if (page.strokes.length === 0) return null;

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

export function parsePreview(raw: string): NotePreview {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw);
    if (data?.kind === "pdf" && typeof data.file === "string" && Number.isInteger(data.page)) {
      return { kind: "pdf", file: data.file, page: data.page, ratio: ratioOf(data.ratio) };
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
