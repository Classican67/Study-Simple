/**
 * Copier un bloc pour le coller ailleurs : un traitement de texte, une feuille de
 * calcul, une autre note.
 *
 * Du HTML pour ce qui sait le lire, du texte pour le reste. Le HTML vient de
 * notre propre balisage : recollé dans l'app, il repasse par `lib/collage.ts` et
 * redonne les mêmes titres, les mêmes listes et le même tableau.
 */

import { markupToHtml, toPlainText } from "@/components/rich-text";
import { parseTable, parseText } from "@/lib/notes";

function echapper(texte: string): string {
  return texte.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function blocPourPresse(kind: string, content: string): { html: string; texte: string } | null {
  if (kind === "text") {
    const { markup, style } = parseText(content);
    if (!markup.trim()) return null;
    const html = markupToHtml(markup);
    const enveloppe = style === "h1" ? "h1" : style === "h2" ? "h2" : style === "quote" ? "blockquote" : null;
    return {
      html: enveloppe ? `<${enveloppe}>${html}</${enveloppe}>` : html,
      texte: toPlainText(markup),
    };
  }
  if (kind === "table") {
    const { rows } = parseTable(content);
    const lignes = rows
      .map((row, i) => {
        const cellule = i === 0 ? "th" : "td";
        return `<tr>${row.map((c) => `<${cellule}>${echapper(c)}</${cellule}>`).join("")}</tr>`;
      })
      .join("");
    return {
      html: `<table>${lignes}</table>`,
      texte: rows.map((row) => row.join("\t")).join("\n"),
    };
  }
  return null;
}

export async function copierDansLePresse(contenu: { html: string; texte: string }): Promise<boolean> {
  try {
    if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([contenu.html], { type: "text/html" }),
          "text/plain": new Blob([contenu.texte], { type: "text/plain" }),
        }),
      ]);
      return true;
    }
    await navigator.clipboard.writeText(contenu.texte);
    return true;
  } catch {
    return false;
  }
}
