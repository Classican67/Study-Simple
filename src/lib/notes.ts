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

export type DrawingContent = {
  strokes: Stroke[];
  ratio: number;
  paper: Paper;
  backdrop?: Backdrop | null;
};

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

  // Le fond n'est retenu que s'il est complet : un nom de fichier sans numéro
  // de page, ou l'inverse, ne mène nulle part.
  const brut = data?.backdrop as Partial<Backdrop> | null | undefined;
  const backdrop: Backdrop | null =
    brut && typeof brut.file === "string" && Number.isInteger(brut.page) && (brut.page as number) >= 1
      ? { file: brut.file.slice(0, 128), page: brut.page as number }
      : null;

  return {
    ratio,
    paper,
    backdrop,
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
  return JSON.stringify({ strokes: [], ratio: DEFAULT_RATIO, paper: "blank" } satisfies DrawingContent);
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
