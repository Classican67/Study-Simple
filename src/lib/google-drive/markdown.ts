/**
 * Le texte d'une note, en Markdown — pour qu'il se lise dans le Drive.
 *
 * Le PDF ne porte que les pages manuscrites ; les paragraphes et les tableaux
 * d'une note n'y figurent pas. Ils vont donc dans un `.md` à côté, que Drive
 * affiche tel quel et que n'importe quel éditeur rouvre.
 *
 * Le balisage de l'app est déjà du Markdown à peu de chose près — `**gras**`,
 * `_italique_`, `~~barré~~`, `` `code` `` et les mêmes échappements. Seule la
 * couleur (`{c:rouge}…{/c}`) n'y a pas d'équivalent : on la retire, le texte
 * reste.
 */

import { parseTable, parseText, type TextStyle } from "@/lib/notes";
import { evaluateSheet } from "@/lib/sheet";

const PREFIXES: Record<TextStyle, string> = {
  h1: "# ",
  h2: "## ",
  p: "",
  quote: "> ",
  bullet: "- ",
};

export function sansCouleur(markup: string): string {
  return markup.replace(/\{c:[a-z]+\}|\{\/c\}/g, "");
}

/** Une cellule de tableau Markdown : ni barre verticale, ni saut de ligne. */
function cellule(texte: string): string {
  return texte.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim();
}

/**
 * Un tableau, **calculé** : la formule `=SOMME(A1:A3)` n'apprend rien à qui
 * relit sa sauvegarde, la valeur si. La première rangée sert d'en-tête —
 * Markdown n'a pas de tableau sans en-tête.
 */
function tableau(rows: string[][]): string {
  if (rows.length === 0) return "";
  const valeurs = evaluateSheet(rows).map((r) => r.map((c) => cellule(c.text)));
  const largeur = Math.max(...valeurs.map((r) => r.length), 1);
  const rangee = (r: string[]) =>
    `| ${Array.from({ length: largeur }, (_, i) => r[i] ?? "").join(" | ")} |`;
  return [
    rangee(valeurs[0]),
    `| ${Array.from({ length: largeur }, () => "---").join(" | ")} |`,
    ...valeurs.slice(1).map(rangee),
  ].join("\n");
}

/**
 * Le Markdown d'une note, ou `null` si elle n'a ni texte ni tableau.
 *
 * Les blocs manuscrits sont sautés : ils vont dans le PDF.
 */
export function noteMarkdown(
  titre: string,
  blocs: { kind: string; content: string }[],
): string | null {
  const morceaux: string[] = [];
  for (const bloc of blocs) {
    if (bloc.kind === "text") {
      const { style, markup } = parseText(bloc.content);
      const texte = sansCouleur(markup).trim();
      if (!texte) continue;
      const prefixe = PREFIXES[style];
      // Un paragraphe sur plusieurs lignes garde son préfixe à chaque ligne :
      // une citation qui s'interromprait à la deuxième ligne n'en serait plus une.
      morceaux.push(
        prefixe && style !== "h1" && style !== "h2"
          ? texte.split("\n").map((l) => prefixe + l).join("\n")
          : prefixe + texte.replace(/\n+/g, " "),
      );
    } else if (bloc.kind === "table") {
      const md = tableau(parseTable(bloc.content).rows);
      if (md) morceaux.push(md);
    }
  }
  if (morceaux.length === 0) return null;
  const entete = titre.trim() ? `# ${titre.trim()}\n\n` : "";
  return `${entete}${morceaux.join("\n\n")}\n`;
}
