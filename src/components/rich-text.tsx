import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Moteur de texte enrichi : gras, italique, barré, code, couleur, titres et
 * listes.
 *
 * Le contenu est stocké sous forme de **balisage texte** (une variante de
 * Markdown), jamais de HTML. Conséquence : rien de ce qui est saisi ne peut
 * devenir une balise, donc aucune surface d'injection et aucune bibliothèque
 * de nettoyage nécessaire.
 *
 * L'analyse produit un arbre, dont deux rendus dérivent :
 *   - `RichText`      → des nœuds React, pour l'affichage ;
 *   - `markupToHtml`  → une chaîne HTML, pour amorcer l'éditeur visuel.
 * Les deux partagent donc exactement les mêmes règles.
 */

// Couleurs autorisées. Le balisage ne stocke qu'un nom : une couleur
// arbitraire ne peut pas être injectée dans une feuille de style.
export const TEXT_COLORS = {
  rose: { label: "Rose", css: "oklch(55% 0.21 15)", dark: "oklch(75% 0.17 15)" },
  amber: { label: "Ambre", css: "oklch(52% 0.14 70)", dark: "oklch(78% 0.15 75)" },
  emerald: { label: "Vert", css: "oklch(48% 0.14 160)", dark: "oklch(76% 0.16 160)" },
  blue: { label: "Bleu", css: "oklch(50% 0.17 250)", dark: "oklch(75% 0.14 250)" },
  violet: { label: "Violet", css: "oklch(50% 0.21 292)", dark: "oklch(76% 0.15 292)" },
} as const;

export type TextColor = keyof typeof TEXT_COLORS;

export function isTextColor(value: string): value is TextColor {
  return Object.hasOwn(TEXT_COLORS, value);
}

// --- Arbre ------------------------------------------------------------------

export type Inline =
  | { kind: "text"; value: string }
  | { kind: "strong" | "em" | "del" | "code"; children: Inline[] }
  | { kind: "color"; color: TextColor; children: Inline[] };

export type Block =
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "heading"; level: number; children: Inline[] }
  // Deux membres distincts et non « bullets | numbers » : sans cela
  // TypeScript ne sait pas éliminer l'un en testant l'autre.
  | { kind: "bullets"; items: Inline[][] }
  | { kind: "numbers"; items: Inline[][] };

type Rule = {
  pattern: RegExp;
  build: (match: RegExpExecArray, children: Inline[]) => Inline;
  recurse: boolean;
};

const INLINE_RULES: Rule[] = [
  {
    // Le contenu du code littéral n'est pas réinterprété : `**x**` entre
    // accents graves reste `**x**`.
    pattern: /`([^`]+)`/,
    recurse: false,
    build: (_m, children) => ({ kind: "code", children }),
  },
  {
    // Couleur : la syntaxe n'est jamais vue par l'utilisateur, l'éditeur
    // étant visuel. Le nom est validé à l'analyse.
    pattern: /\{c:([a-z]+)\}([\s\S]*?)\{\/c\}/,
    recurse: true,
    build: (match, children) => ({
      kind: "color",
      color: isTextColor(match[1]) ? match[1] : "violet",
      children,
    }),
  },
  {
    // Paresseux plutôt que « tout sauf une étoile » : le gras doit pouvoir
    // contenir de l'italique (**a *b* c**).
    pattern: /\*\*(?=\S)([\s\S]*?\S)\*\*/,
    recurse: true,
    build: (_m, children) => ({ kind: "strong", children }),
  },
  {
    pattern: /~~(?=\S)([\s\S]*?\S)~~/,
    recurse: true,
    build: (_m, children) => ({ kind: "del", children }),
  },
  {
    // Le dernier caractère doit être non-espace ET non-marqueur : avec un
    // simple \S, « **** » se lisait comme une italique contenant une étoile.
    pattern: /\*(?=[^\s*])([^*]*?[^\s*])\*/,
    recurse: true,
    build: (_m, children) => ({ kind: "em", children }),
  },
  {
    pattern: /_(?=[^\s_])([^_]*?[^\s_])_/,
    recurse: true,
    build: (_m, children) => ({ kind: "em", children }),
  },
];

// Le groupe capturant du contenu est le dernier de chaque motif.
function contentOf(match: RegExpExecArray): string {
  return match[match.length - 1] ?? "";
}

// Découpe une ligne selon la règle qui apparaît le plus tôt. À position égale,
// la correspondance la plus longue gagne, pour que ** batte *.
function parseInline(text: string): Inline[] {
  let best: { index: number; length: number; rule: Rule; match: RegExpExecArray } | null = null;

  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    if (
      !best ||
      match.index < best.index ||
      (match.index === best.index && match[0].length > best.length)
    ) {
      best = { index: match.index, length: match[0].length, rule, match };
    }
  }

  if (!best) return text ? [{ kind: "text", value: text }] : [];

  const before = text.slice(0, best.index);
  const after = text.slice(best.index + best.length);
  const inner = contentOf(best.match);
  const children: Inline[] = best.rule.recurse
    ? parseInline(inner)
    : inner
      ? [{ kind: "text", value: inner }]
      : [];

  return [
    // `before` ne peut contenir aucune correspondance : `best` était la plus
    // précoce.
    ...(before ? [{ kind: "text", value: before } as Inline] : []),
    best.rule.build(best.match, children),
    ...parseInline(after),
  ];
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

export function parseMarkup(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    const previous = blocks.at(-1);

    if (line.trim() === "") {
      // Ferme le bloc courant : deux textes séparés par une ligne vide
      // deviennent deux paragraphes.
      if (previous?.kind === "paragraph") blocks.push({ kind: "paragraph", lines: [] });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, children: parseInline(heading[2]) });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (previous?.kind === "bullets") previous.items.push(parseInline(bullet[1]));
      else blocks.push({ kind: "bullets", items: [parseInline(bullet[1])] });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      if (previous?.kind === "numbers") previous.items.push(parseInline(numbered[1]));
      else blocks.push({ kind: "numbers", items: [parseInline(numbered[1])] });
      continue;
    }

    if (previous?.kind === "paragraph") previous.lines.push(parseInline(line));
    else blocks.push({ kind: "paragraph", lines: [parseInline(line)] });
  }

  return blocks.filter((block) => block.kind !== "paragraph" || block.lines.length > 0);
}

// --- Rendu React ------------------------------------------------------------

const CODE_CLASS =
  "rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[0.9em] text-fg";

function renderInline(nodes: Inline[], keyPrefix: string): React.ReactNode[] {
  return nodes.map((node, index) => {
    const key = `${keyPrefix}-${index}`;
    switch (node.kind) {
      case "text":
        return <React.Fragment key={key}>{node.value}</React.Fragment>;
      case "strong":
        return (
          <strong key={key} className="font-semibold">
            {renderInline(node.children, key)}
          </strong>
        );
      case "em":
        return <em key={key}>{renderInline(node.children, key)}</em>;
      case "del":
        return (
          <del key={key} className="opacity-70">
            {renderInline(node.children, key)}
          </del>
        );
      case "code":
        return (
          <code key={key} className={CODE_CLASS}>
            {renderInline(node.children, key)}
          </code>
        );
      case "color":
        return (
          // La classe `text-c-*` est définie dans globals.css et bascule seule
          // vers la variante claire en thème sombre.
          <span key={key} className={`text-c-${node.color}`}>
            {renderInline(node.children, key)}
          </span>
        );
    }
  });
}

export function RichText({ children, className }: { children: string; className?: string }) {
  const blocks = React.useMemo(() => parseMarkup(children), [children]);

  return (
    // `space-y` plutôt qu'une marge par élément : l'espacement reste correct
    // quel que soit l'ordre des blocs.
    <div className={cn("space-y-3 break-words leading-relaxed", className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`;

        if (block.kind === "heading") {
          const sizes = [
            "text-lg font-semibold",
            "text-base font-semibold",
            "text-sm font-semibold",
          ];
          return (
            <p key={key} className={sizes[block.level - 1]}>
              {renderInline(block.children, key)}
            </p>
          );
        }

        if (block.kind === "bullets") {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5 text-left marker:text-fg-muted">
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }

        if (block.kind === "numbers") {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5 text-left marker:text-fg-muted">
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`}>{renderInline(item, `${key}-${i}`)}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={key}>
            {block.lines.map((line, i) => (
              <React.Fragment key={`${key}-${i}`}>
                {/* Un simple retour à la ligne reste un retour à la ligne. */}
                {i > 0 ? <br /> : null}
                {renderInline(line, `${key}-${i}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}

// --- Rendu HTML (amorçage de l'éditeur visuel) ------------------------------

// Tout texte est échappé : le balisage stocké ne peut pas produire de balise
// autre que celles générées ici.
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function inlineToHtml(nodes: Inline[]): string {
  return nodes
    .map((node) => {
      switch (node.kind) {
        case "text":
          return escapeHtml(node.value);
        case "strong":
          return `<strong>${inlineToHtml(node.children)}</strong>`;
        case "em":
          return `<em>${inlineToHtml(node.children)}</em>`;
        case "del":
          return `<s>${inlineToHtml(node.children)}</s>`;
        case "code":
          return `<code>${inlineToHtml(node.children)}</code>`;
        case "color":
          return `<span data-c="${node.color}" class="text-c-${node.color}">${inlineToHtml(node.children)}</span>`;
      }
    })
    .join("");
}

/** Convertit le balisage stocké en HTML, pour le contenu initial de l'éditeur. */
export function markupToHtml(source: string): string {
  const blocks = parseMarkup(source);
  if (blocks.length === 0) return "";

  return blocks
    .map((block) => {
      if (block.kind === "heading") {
        return `<div><strong>${inlineToHtml(block.children)}</strong></div>`;
      }
      if (block.kind === "bullets") {
        return `<ul>${block.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join("")}</ul>`;
      }
      if (block.kind === "numbers") {
        return `<ol>${block.items.map((i) => `<li>${inlineToHtml(i)}</li>`).join("")}</ol>`;
      }
      // Un <div> par ligne : c'est la structure que produit naturellement un
      // contenteditable quand on appuie sur Entrée.
      return block.lines.map((line) => `<div>${inlineToHtml(line) || "<br>"}</div>`).join("");
    })
    .join("");
}

// --- Texte nu ---------------------------------------------------------------

// Retire les marqueurs pour obtenir du texte lisible. Sert aux aperçus
// tronqués et aux titres de modale, où `line-clamp` ne sait couper qu'un
// bloc de texte simple.
export function toPlainText(source: string): string {
  return source
    .replace(/\{c:[a-z]+\}([\s\S]*?)\{\/c\}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^\s*#{1,3}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*(\d+)[.)]\s+/gm, "$1. ");
}
