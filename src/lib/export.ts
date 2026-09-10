/**
 * Export des cartes — mise en forme pure, sans base ni requête.
 *
 * Trois formats, parce qu'ils ne servent pas la même chose :
 *
 * - `json` : sauvegarde fidèle. Conserve le balisage de mise en forme, les
 *   dossiers, les couleurs — de quoi reconstruire l'installation à l'identique.
 * - `csv`  : pour un tableur. Le balisage est retiré, il n'y a rien à en faire
 *   dans une cellule.
 * - `txt`  : terme et définition séparés par une tabulation, une carte par
 *   ligne. C'est exactement ce que l'import de l'app sait relire, et aussi ce
 *   que Quizlet attend — l'export est donc réversible.
 */

export type ExportCard = {
  term: string;
  definition: string;
  imagePath: string | null;
};

export type ExportDeck = {
  title: string;
  description: string;
  color: string;
  /** Chemin complet du dossier, « Sciences / Biologie ». Vide à la racine. */
  folder: string;
  cards: ExportCard[];
};

export type Backup = {
  exportedAt: string;
  app: "fiches";
  version: 1;
  decks: ExportDeck[];
};

export const EXPORT_FORMATS = ["json", "csv", "txt"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

export function isExportFormat(value: unknown): value is ExportFormat {
  return typeof value === "string" && (EXPORT_FORMATS as readonly string[]).includes(value);
}

/**
 * Échappement CSV, au sens du RFC 4180.
 *
 * Un champ n'est mis entre guillemets que s'il en a besoin — séparateur, saut
 * de ligne ou guillemet à l'intérieur — et les guillemets internes sont
 * doublés. Entourer systématiquement fonctionnerait aussi, mais rendrait le
 * fichier illisible à l'œil pour rien.
 */
export function csvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

export function toCsv(rows: string[][]): string {
  // CRLF : c'est ce qu'attendent Excel et Numbers.
  return rows.map((row) => row.map(csvField).join(",")).join("\r\n");
}

/**
 * Nettoie un champ destiné à un format tabulé.
 *
 * Une tabulation ou un saut de ligne dans un terme casserait la structure —
 * une carte deviendrait deux colonnes de trop, ou deux cartes. On les remplace
 * par une espace plutôt que de produire un fichier invalide.
 */
export function tsvField(value: string): string {
  return value.replace(/[\t\r\n]+/g, " ").trim();
}

export function toTsv(cards: { term: string; definition: string }[]): string {
  return cards.map((c) => `${tsvField(c.term)}\t${tsvField(c.definition)}`).join("\n");
}

/**
 * Nom de fichier proposé au navigateur.
 * Daté, pour que deux exports successifs ne se remplacent pas dans le dossier
 * des téléchargements.
 */
export function exportFilename(format: ExportFormat, now: Date = new Date()): string {
  const jour = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
  return `fiches-${jour}.${format}`;
}

export const EXPORT_MIME: Record<ExportFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  txt: "text/plain; charset=utf-8",
};

/**
 * Excel sous Windows lit un CSV en encodage local tant qu'il n'y a pas de
 * marque d'ordre d'octets : sans elle, « Élève » s'affiche « Ã‰lÃ¨ve ». Les
 * autres formats n'en ont pas besoin, et elle les polluerait.
 */
export const UTF8_BOM = "﻿";
