/**
 * Analyse d'un collage de cartes venu d'un autre outil.
 *
 * Quizlet exporte du texte avec deux séparateurs au choix de l'utilisateur :
 * un entre le terme et la définition (tabulation par défaut), un autre entre
 * les cartes (retour à la ligne par défaut). D'autres outils suivent la même
 * idée avec d'autres caractères. Plutôt que de coder en dur un format, on
 * détecte le plus probable et on laisse la main à l'utilisateur.
 *
 * Ce module est volontairement sans dépendance ni accès réseau ou base : il
 * s'exécute aussi bien dans le navigateur (aperçu en direct) que sur le
 * serveur (revalidation avant écriture).
 */

export const TERM_SEPARATORS = {
  tab: { label: "Tabulation", value: "\t", hint: "Défaut de Quizlet" },
  comma: { label: "Virgule", value: "," },
  semicolon: { label: "Point-virgule", value: ";" },
  dash: { label: "Tiret", value: " - " },
  colon: { label: "Deux-points", value: " : " },
} as const;

export const CARD_SEPARATORS = {
  newline: { label: "Retour à la ligne", value: "\n", hint: "Défaut de Quizlet" },
  blankline: { label: "Ligne vide", value: "\n\n", hint: "Pour les réponses sur plusieurs lignes" },
  semicolon: { label: "Point-virgule", value: ";" },
} as const;

export type TermSeparatorKey = keyof typeof TERM_SEPARATORS | "custom";
export type CardSeparatorKey = keyof typeof CARD_SEPARATORS | "custom";

export type ImportOptions = {
  termSeparator: TermSeparatorKey;
  cardSeparator: CardSeparatorKey;
  customTerm?: string;
  customCard?: string;
};

export type ParsedCard = { term: string; definition: string };

export type ParseResult = {
  cards: ParsedCard[];
  /** Blocs ignorés faute de séparateur exploitable. */
  skipped: string[];
  /** Séparateurs retenus, pour les afficher quand ils ont été devinés. */
  used: { term: string; card: string };
};

// Au-delà, l'import est refusé : c'est bien au-dessus d'un chapitre de cours,
// et cela borne le travail fait en une seule requête.
export const MAX_IMPORT_CARDS = 1000;

export function resolveSeparators(options: ImportOptions): { term: string; card: string } {
  const term =
    options.termSeparator === "custom"
      ? (options.customTerm ?? "")
      : TERM_SEPARATORS[options.termSeparator].value;
  const card =
    options.cardSeparator === "custom"
      ? (options.customCard ?? "")
      : CARD_SEPARATORS[options.cardSeparator].value;
  return { term, card };
}

// Découpe une ligne sur la première occurrence du séparateur seulement : une
// définition contenant elle-même une virgule ne doit pas être tronquée.
function splitOnce(text: string, separator: string): [string, string] | null {
  const index = text.indexOf(separator);
  if (index === -1) return null;
  return [text.slice(0, index), text.slice(index + separator.length)];
}

// Certains outils exportent en CSV avec guillemets dès qu'un champ contient le
// séparateur. On les retire, en rétablissant les guillemets doublés.
function unquote(field: string): string {
  const trimmed = field.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/""/g, '"');
  }
  return trimmed;
}

// Découpe un texte CSV en respectant les guillemets, pour les cas où le
// séparateur apparaît aussi à l'intérieur d'un champ.
function splitCsvOnce(line: string, separator: string): [string, string] | null {
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      // Un guillemet doublé à l'intérieur d'un champ est un guillemet littéral.
      if (inQuotes && line[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && line.startsWith(separator, i)) {
      return [line.slice(0, i), line.slice(i + separator.length)];
    }
  }
  return null;
}

export function parseImport(raw: string, options: ImportOptions): ParseResult {
  const { term: termSep, card: cardSep } = resolveSeparators(options);
  const cards: ParsedCard[] = [];
  const skipped: string[] = [];

  if (!raw.trim() || !termSep || !cardSep) {
    return { cards, skipped, used: { term: termSep, card: cardSep } };
  }

  // Les collages venus de Windows ou d'un tableur portent des CRLF.
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // Avec la ligne vide comme séparateur, plusieurs sauts consécutifs ne doivent
  // pas produire de blocs vides.
  const blocks =
    cardSep === "\n\n" ? text.split(/\n\s*\n+/) : text.split(cardSep);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    const parts =
      termSep === "," || termSep === ";"
        ? (splitCsvOnce(trimmed, termSep) ?? splitOnce(trimmed, termSep))
        : splitOnce(trimmed, termSep);

    if (!parts) {
      skipped.push(trimmed.slice(0, 80));
      continue;
    }

    const term = unquote(parts[0]);
    const definition = unquote(parts[1]);
    if (!term || !definition) {
      skipped.push(trimmed.slice(0, 80));
      continue;
    }

    cards.push({ term, definition });
  }

  return { cards, skipped, used: { term: termSep, card: cardSep } };
}

// Ordre de préférence : la tabulation d'abord, parce que c'est le défaut de
// Quizlet et qu'elle n'apparaît quasiment jamais à l'intérieur d'un texte.
// La virgule en dernier, parce qu'elle y apparaît tout le temps.
const DETECTION_ORDER: Exclude<TermSeparatorKey, "custom">[] = [
  "tab",
  "semicolon",
  "dash",
  "colon",
  "comma",
];

/**
 * Devine les séparateurs d'un collage.
 *
 * On essaie chaque combinaison et on retient celle qui découpe le plus de
 * blocs en deux parties non vides. Un séparateur qui n'expliquerait qu'une
 * partie du collage est écarté : mieux vaut ne rien deviner que de couper
 * les cartes au mauvais endroit.
 */
export function detectSeparators(raw: string): ImportOptions | null {
  if (!raw.trim()) return null;

  const text = raw.replace(/\r\n/g, "\n");
  // La ligne vide n'est envisagée que si le texte en contient réellement.
  const cardCandidates: Exclude<CardSeparatorKey, "custom">[] = /\n\s*\n/.test(text)
    ? ["blankline", "newline"]
    : ["newline"];

  let best: { options: ImportOptions; score: number; count: number } | null = null;

  for (const cardKey of cardCandidates) {
    for (const termKey of DETECTION_ORDER) {
      const options: ImportOptions = { termSeparator: termKey, cardSeparator: cardKey };
      const { cards, skipped } = parseImport(text, options);
      const total = cards.length + skipped.length;
      if (total === 0 || cards.length === 0) continue;

      // Proportion de blocs réellement exploités.
      const score = cards.length / total;
      // À score égal, on préfère la combinaison qui produit le plus de cartes :
      // « retour à la ligne » découpe plus finement que « ligne vide ».
      const better =
        !best || score > best.score + 0.001 || (Math.abs(score - best.score) <= 0.001 && cards.length > best.count);
      if (better) best = { options, score, count: cards.length };
    }
  }

  // En dessous de 80 % de blocs exploités, le format n'est pas celui-là.
  if (!best || best.score < 0.8) return null;
  return best.options;
}
