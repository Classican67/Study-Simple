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

/** Une page de la surface : celle du document, ou celle qu'on a ajoutée. */
export type NotePage = BackdropPage | BlankPage;

/** Cette page vient-elle du document importé ? */
export function isBackdropPage(page: NotePage): page is BackdropPage {
  return "file" in page;
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
  const pages = content.pages;
  if (pages.length === 0 || pages.length >= MAX_DOCUMENT_PAGES) return content;

  const rang = Math.max(-1, Math.min(pages.length - 1, Math.trunc(apres)));
  // Le format de la voisine : une feuille glissée dans un polycopié A4 est une
  // feuille A4, sinon la pile se met à bégayer d'une page à l'autre.
  const voisine = pages[rang] ?? pages[0];
  const nouvelle: BlankPage = { paper, ratio: voisine.ratio };

  const bandes = pageBands(pages);
  const decalage = nouvelle.ratio + PAGE_GAP;
  const strokes = content.strokes.map((stroke) => {
    const boite = boundsOf(stroke.points);
    if (!boite) return stroke;
    const sur = pageAtY(bandes, (boite.minY + boite.maxY) / 2);
    if (sur <= rang) return stroke;
    return { ...stroke, points: translateStroke(stroke.points, 0, decalage) };
  });

  const suivantes = [...pages.slice(0, rang + 1), nouvelle, ...pages.slice(rang + 1)];
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
    const b = brut as (Partial<BackdropPage> & Partial<BlankPage>) | null | undefined;
    if (!b) return null;
    const r = typeof b.ratio === "number" && b.ratio > 0.1 && b.ratio <= MAX_RATIO ? b.ratio : secours;
    // Une page de document se reconnaît à son fichier ; tout le reste est une
    // page ajoutée, et son fond vaut « uni » si l'on n'en reconnaît pas le nom.
    if (typeof b.file === "string" && Number.isInteger(b.page) && (b.page as number) >= 1) {
      return { file: b.file.slice(0, 128), page: b.page as number, ratio: r };
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
