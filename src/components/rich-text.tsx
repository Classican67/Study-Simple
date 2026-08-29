import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Rendu d'un sous-ensemble de Markdown : **gras**, *italique*, `code`,
 * ~~barré~~, titres, listes à puces et listes numérotées.
 *
 * Le texte est transformé en NŒUDS REACT, jamais en chaîne HTML. Il n'y a donc
 * aucun `dangerouslySetInnerHTML`, donc aucune surface d'injection, donc aucun
 * besoin d'une bibliothèque de nettoyage. Ce qui n'est pas reconnu par les
 * règles ci-dessous s'affiche tel quel, en texte brut.
 */

type InlineRule = {
  pattern: RegExp;
  render: (children: React.ReactNode, key: string) => React.ReactNode;
  // Le contenu du code littéral ne doit pas être réinterprété : `**x**` entre
  // accents graves reste `**x**`.
  recurse: boolean;
};

const INLINE_RULES: InlineRule[] = [
  {
    pattern: /`([^`]+)`/,
    recurse: false,
    render: (children, key) => (
      <code
        key={key}
        className="rounded bg-surface-raised px-1.5 py-0.5 font-mono text-[0.9em] text-fg"
      >
        {children}
      </code>
    ),
  },
  {
    // Paresseux, et non « tout sauf une étoile » : le contenu du gras doit
    // pouvoir contenir de l'italique (**a *b* c**). Le lookahead et le \S
    // final interdisent « ** ** » et les marqueurs collés à une espace.
    pattern: /\*\*(?=\S)([\s\S]*?\S)\*\*/,
    recurse: true,
    render: (children, key) => (
      <strong key={key} className="font-semibold">
        {children}
      </strong>
    ),
  },
  {
    pattern: /~~(?=\S)([\s\S]*?\S)~~/,
    recurse: true,
    render: (children, key) => (
      <del key={key} className="opacity-70">
        {children}
      </del>
    ),
  },
  {
    pattern: /\*(?=\S)([^*]*?\S)\*/,
    recurse: true,
    render: (children, key) => <em key={key}>{children}</em>,
  },
  {
    // Souligné accepté aussi pour l'italique, par habitude Markdown.
    pattern: /_(?=\S)([^_]*?\S)_/,
    recurse: true,
    render: (children, key) => <em key={key}>{children}</em>,
  },
];

// Découpe récursivement une ligne selon la règle qui apparaît le plus tôt.
// À position égale, la correspondance la plus longue gagne, pour que ** batte *.
function parseInline(text: string, keyPrefix: string): React.ReactNode[] {
  let best: { index: number; length: number; rule: InlineRule; content: string } | null = null;

  for (const rule of INLINE_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const candidate = { index: match.index, length: match[0].length, rule, content: match[1] };
    if (
      !best ||
      candidate.index < best.index ||
      (candidate.index === best.index && candidate.length > best.length)
    ) {
      best = candidate;
    }
  }

  if (!best) return [text];

  const before = text.slice(0, best.index);
  const after = text.slice(best.index + best.length);
  const inner = best.rule.recurse
    ? parseInline(best.content, `${keyPrefix}i`)
    : best.content;

  return [
    // `before` ne peut contenir aucune correspondance : `best` était la plus
    // précoce. Inutile de le réanalyser.
    ...(before ? [before] : []),
    best.rule.render(inner, `${keyPrefix}m`),
    ...(after ? parseInline(after, `${keyPrefix}a`) : []),
  ];
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullets"; items: string[] }
  | { kind: "numbers"; items: string[] }
  | { kind: "paragraph"; lines: string[] };

// Regroupe les lignes en blocs. Les puces consécutives forment une seule liste,
// et une ligne vide sépare deux paragraphes.
function parseBlocks(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    const previous = blocks.at(-1);

    if (line.trim() === "") {
      // Ferme le bloc courant sans rien produire : deux blocs de texte séparés
      // par une ligne vide deviennent deux paragraphes.
      if (previous?.kind === "paragraph") blocks.push({ kind: "paragraph", lines: [] });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }

    const bullet = BULLET.exec(line);
    if (bullet) {
      if (previous?.kind === "bullets") previous.items.push(bullet[1]);
      else blocks.push({ kind: "bullets", items: [bullet[1]] });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered) {
      if (previous?.kind === "numbers") previous.items.push(numbered[1]);
      else blocks.push({ kind: "numbers", items: [numbered[1]] });
      continue;
    }

    if (previous?.kind === "paragraph") previous.lines.push(line);
    else blocks.push({ kind: "paragraph", lines: [line] });
  }

  return blocks.filter((block) => block.kind !== "paragraph" || block.lines.length > 0);
}

// Retire les marqueurs de mise en forme pour obtenir du texte nu.
// Sert aux aperçus tronqués : `line-clamp` ne sait couper proprement qu'un
// bloc de texte simple, pas une suite de paragraphes et de listes.
export function toPlainText(source: string): string {
  return source
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^\s*#{1,3}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*(\d+)[.)]\s+/gm, "$1. ");
}

export function RichText({ children, className }: { children: string; className?: string }) {
  const blocks = React.useMemo(() => parseBlocks(children), [children]);

  return (
    // `space-y` plutôt qu'une marge par élément : l'espacement reste correct
    // quel que soit l'ordre des blocs.
    <div className={cn("space-y-3 break-words leading-relaxed", className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`;

        if (block.kind === "heading") {
          const sizes = ["text-lg font-semibold", "text-base font-semibold", "text-sm font-semibold"];
          return (
            <p key={key} className={sizes[block.level - 1]}>
              {parseInline(block.text, key)}
            </p>
          );
        }

        if (block.kind === "bullets") {
          return (
            <ul key={key} className="list-disc space-y-1 pl-5 marker:text-fg-muted">
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`}>{parseInline(item, `${key}-${i}`)}</li>
              ))}
            </ul>
          );
        }

        if (block.kind === "numbers") {
          return (
            <ol key={key} className="list-decimal space-y-1 pl-5 marker:text-fg-muted">
              {block.items.map((item, i) => (
                <li key={`${key}-${i}`}>{parseInline(item, `${key}-${i}`)}</li>
              ))}
            </ol>
          );
        }

        return (
          <p key={key}>
            {block.lines.map((line, i) => (
              <React.Fragment key={`${key}-${i}`}>
                {/* Un simple retour à la ligne dans le textarea reste un retour
                    à la ligne à l'écran : c'est ce que l'utilisateur attend. */}
                {i > 0 ? <br /> : null}
                {parseInline(line, `${key}-${i}`)}
              </React.Fragment>
            ))}
          </p>
        );
      })}
    </div>
  );
}
