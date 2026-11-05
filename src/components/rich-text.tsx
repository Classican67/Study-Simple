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
  | { kind: "bullets"; items: Inline[][]; meta?: MetaListe[] }
  | { kind: "numbers"; items: Inline[][]; meta?: MetaListe[] };

/**
 * Niveau et genre de chaque élément d'une liste imbriquée.
 *
 * Absent d'une liste plate : c'est la grande majorité des cartes, et elles n'ont
 * aucune raison de changer de forme. Une liste peut mêler les genres — une liste
 * numérotée dont un élément porte des puces — d'où le genre par élément.
 */
export type MetaListe = { niveau: number; ordonnee: boolean };

/** Une liste, remise en arbre pour être rendue. */
export type NoeudListe = { ordonnee: boolean; items: { contenu: Inline[]; enfants: NoeudListe[] }[] };

type ListeBloc = Extract<Block, { kind: "bullets" | "numbers" }>;

export function arbreListe(bloc: ListeBloc): NoeudListe {
  const racine: NoeudListe = { ordonnee: bloc.kind === "numbers", items: [] };
  // La pile des listes ouvertes : son sommet reçoit le prochain élément.
  const pile: NoeudListe[] = [racine];
  bloc.items.forEach((contenu, index) => {
    const meta = bloc.meta?.[index] ?? { niveau: 0, ordonnee: bloc.kind === "numbers" };
    pile.length = Math.min(pile.length, meta.niveau + 1);
    while (pile.length < meta.niveau + 1) {
      const parent = pile[pile.length - 1];
      const dernier = parent.items.at(-1);
      // Un niveau sans parent ne vient que d'un balisage abîmé : on y reste.
      if (!dernier) break;
      const enfant: NoeudListe = { ordonnee: meta.ordonnee, items: [] };
      dernier.enfants.push(enfant);
      pile.push(enfant);
    }
    const sommet = pile[pile.length - 1];
    // Même niveau, autre genre : une nouvelle liste à côté, sous le même parent.
    if (pile.length > 1 && sommet.ordonnee !== meta.ordonnee) {
      const parent = pile[pile.length - 2].items.at(-1)!;
      const voisine: NoeudListe = { ordonnee: meta.ordonnee, items: [] };
      parent.enfants.push(voisine);
      pile[pile.length - 1] = voisine;
    }
    pile[pile.length - 1].items.push({ contenu, enfants: [] });
  });
  return racine;
}

type Found = { index: number; length: number; content: string; arg?: string };

type Rule = {
  find: (text: string) => Found | null;
  build: (found: Found, children: Inline[]) => Inline;
  recurse: boolean;
};

/** Règle tirée d'un motif dont le groupe de contenu est le dernier. */
function byPattern(pattern: RegExp): Rule["find"] {
  return (text) => {
    const match = pattern.exec(text);
    if (!match) return null;
    return {
      index: match.index,
      length: match[0].length,
      content: match[match.length - 1] ?? "",
      arg: match.length > 2 ? match[1] : undefined,
    };
  };
}

/**
 * Couleur, balancée à la main : une couleur posée sur un texte déjà coloré
 * s'est longtemps stockée imbriquée (`{c:rose}a {c:blue}b{/c} c{/c}`), et un
 * motif paresseux fermait la première couleur sur le `{/c}` de la seconde.
 */
function findColor(text: string): Found | null {
  const open = /\{c:([a-z]+)\}/g;
  const first = open.exec(text);
  if (!first) return null;

  const token = /\{c:[a-z]+\}|\{\/c\}/g;
  token.lastIndex = first.index + first[0].length;
  let depth = 1;
  for (let t = token.exec(text); t; t = token.exec(text)) {
    depth += t[0] === "{/c}" ? -1 : 1;
    if (depth === 0) {
      const start = first.index + first[0].length;
      return {
        index: first.index,
        length: t.index + t[0].length - first.index,
        content: text.slice(start, t.index),
        arg: first[1],
      };
    }
  }
  // Ouverture jamais refermée : on cherche une couleur plus loin.
  const rest = findColor(text.slice(first.index + first[0].length));
  if (!rest) return null;
  return { ...rest, index: rest.index + first.index + first[0].length };
}

const INLINE_RULES: Rule[] = [
  {
    // Le contenu du code littéral n'est pas réinterprété : `**x**` entre
    // accents graves reste `**x**`.
    find: byPattern(/`([^`]+)`/),
    recurse: false,
    build: (_f, children) => ({ kind: "code", children }),
  },
  {
    // Couleur : la syntaxe n'est jamais vue par l'utilisateur, l'éditeur
    // étant visuel. Le nom est validé à l'analyse.
    find: findColor,
    recurse: true,
    build: (found, children) => ({
      kind: "color",
      color: found.arg && isTextColor(found.arg) ? found.arg : "violet",
      children,
    }),
  },
  {
    // Paresseux plutôt que « tout sauf une étoile » : le gras doit pouvoir
    // contenir de l'italique (**a *b* c**).
    //
    // Tolérances pour ce que l'ancien éditeur a stocké :
    //   - un espace collé à l'intérieur d'un marqueur (`**mot **`,
    //     `un** mot**`), qui venait avec la sélection d'un mot au double-tap —
    //     mais pas des deux côtés à la fois, sans quoi `x ** 2 + y ** 2`
    //     deviendrait gras ;
    //   - un marqueur fermant suivi d'une étoile seule (`**a *b***`) : c'est
    //     l'italique intérieur qui se ferme d'abord. Deux étoiles derrière,
    //     en revanche, ouvrent un gras voisin (`**a****b**`).
    find: byPattern(/\*\*(\S[\s\S]*?|\s+[\s\S]*?\S)\*\*(?!\*(?!\*))/),
    recurse: true,
    build: (_f, children) => ({ kind: "strong", children }),
  },
  {
    find: byPattern(/~~(\S[\s\S]*?|\s+[\s\S]*?\S)~~/),
    recurse: true,
    build: (_f, children) => ({ kind: "del", children }),
  },
  {
    // L'italique peut contenir un gras entier (`*a **b***`), jamais une
    // étoile seule. Le premier caractère doit être non-espace ET
    // non-marqueur : avec un simple \S, « **** » se lisait comme une
    // italique contenant une étoile.
    find: byPattern(/\*(?=[^\s*])((?:[^*]|\*\*[^*]+\*\*)+?)\*(?!\*(?!\*))/),
    recurse: true,
    build: (_f, children) => ({ kind: "em", children }),
  },
  {
    // C'est la forme qu'écrit l'éditeur : `_` ne se confond jamais avec
    // l'étoile du gras, là où `**a *b***` était ambigu.
    find: byPattern(/_(?=[^\s_])([^_]*?[^\s_])_/),
    recurse: true,
    build: (_f, children) => ({ kind: "em", children }),
  },
];

// --- Échappement ------------------------------------------------------------

// Un marqueur tapé pour de vrai (« 5*3*2 ») est précédé d'une barre oblique
// inverse à l'écriture. À la lecture, il est remplacé par un caractère de la
// zone d'usage privé, qu'aucun motif ne reconnaît, puis rendu tel quel.
const ESCAPABLE = "\\*_~`{}";
const PRIVATE_BASE = 0xe000;

function protect(source: string): string {
  return source.replace(/\\([\\*_~`{}])/g, (_m, char: string) =>
    String.fromCharCode(PRIVATE_BASE + ESCAPABLE.indexOf(char)),
  );
}

function restore(value: string): string {
  return value.replace(/[\ue000-\ue006]/g, (char) => ESCAPABLE[char.charCodeAt(0) - PRIVATE_BASE]);
}

/** Échappe un texte littéral pour qu'aucun de ses caractères ne devienne un marqueur. */
export function escapeMarkup(text: string): string {
  return text.replace(/[\\*_~`{}]/g, "\\$&");
}

// Découpe une ligne selon la règle qui apparaît le plus tôt. À position égale,
// la correspondance la plus longue gagne, pour que ** batte *.
function parseInline(text: string): Inline[] {
  let best: { found: Found; rule: Rule } | null = null;

  for (const rule of INLINE_RULES) {
    const found = rule.find(text);
    if (!found) continue;
    if (
      !best ||
      found.index < best.found.index ||
      (found.index === best.found.index && found.length > best.found.length)
    ) {
      best = { found, rule };
    }
  }

  const textNode = (value: string): Inline => ({ kind: "text", value: restore(value) });

  if (!best) return text ? [textNode(text)] : [];

  const { found, rule } = best;
  const before = text.slice(0, found.index);
  const after = text.slice(found.index + found.length);
  const children: Inline[] = rule.recurse
    ? parseInline(found.content)
    : found.content
      ? [textNode(found.content)]
      : [];
  const node = rule.build(found, children);

  return [
    // `before` ne peut contenir aucune correspondance : `best` était la plus
    // précoce.
    ...(before ? [textNode(before)] : []),
    node,
    ...parseInline(after),
  ];
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const BULLET = /^(\s*)[-*]\s+(.*)$/;
const NUMBERED = /^(\s*)\d+[.)]\s+(.*)$/;
/** Niveaux d'imbrication : au-delà, un écran de téléphone n'a plus de largeur. */
const NIVEAU_MAX = 5;

/** Ajoute un élément à une liste, en la faisant passer à la forme imbriquée s'il le faut. */
function ajouterElement(liste: ListeBloc, contenu: Inline[], niveau: number, ordonnee: boolean) {
  if (niveau > 0 && !liste.meta) {
    liste.meta = liste.items.map(() => ({ niveau: 0, ordonnee: liste.kind === "numbers" }));
  }
  liste.items.push(contenu);
  liste.meta?.push({ niveau, ordonnee });
}

export function parseMarkup(source: string): Block[] {
  const blocks: Block[] = [];
  const lines = protect(source.replace(/\r\n/g, "\n")).split("\n");

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

    const puce = BULLET.exec(line);
    const numero = puce ? null : NUMBERED.exec(line);
    const element = puce ?? numero;
    if (element) {
      const ordonnee = numero !== null;
      const contenu = parseInline(element[2]);
      const genre = ordonnee ? "numbers" : "bullets";
      const liste = previous?.kind === "bullets" || previous?.kind === "numbers" ? previous : null;
      const retrait = element[1].replace(/\t/g, "  ").length;
      // Un retrait compte comme un niveau de plus sous l'élément d'avant, jamais
      // deux : un document mal indenté ne doit pas faire sauter un niveau.
      const avant = liste?.meta?.at(-1)?.niveau ?? 0;
      const niveau = liste ? Math.min(Math.floor(retrait / 2), avant + 1, NIVEAU_MAX) : 0;
      if (liste && (niveau > 0 || liste.kind === genre)) ajouterElement(liste, contenu, niveau, ordonnee);
      else blocks.push({ kind: genre, items: [contenu] });
      continue;
    }

    if (previous?.kind === "paragraph") previous.lines.push(parseInline(line));
    else blocks.push({ kind: "paragraph", lines: [parseInline(line)] });
  }

  return blocks.filter((block) => block.kind !== "paragraph" || block.lines.length > 0);
}

// --- Rendu React ------------------------------------------------------------

const CODE_CLASS =
  "rounded bg-surface-high px-1.5 py-0.5 font-mono text-[0.9em] text-on-surface";

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

function ListeRendue({ noeud, cle, relatif = false }: { noeud: NoeudListe; cle: string; relatif?: boolean }) {
  const Balise = noeud.ordonnee ? "ol" : "ul";
  return (
    <Balise
      className={cn(
        noeud.ordonnee ? "list-decimal" : "list-disc",
        relatif
          ? "pl-[1.2em] text-left"
          : "space-y-1 pl-5 text-left marker:text-on-surface-variant",
      )}
    >
      {noeud.items.map((item, i) => (
        <li key={`${cle}-${i}`}>
          {renderInline(item.contenu, `${cle}-${i}`)}
          {item.enfants.map((enfant, j) => (
            <ListeRendue key={j} noeud={enfant} cle={`${cle}-${i}-${j}`} relatif={relatif} />
          ))}
        </li>
      ))}
    </Balise>
  );
}

export function RichText({
  children,
  className,
  relatif = false,
}: {
  children: string;
  className?: string;
  /**
   * Tout en multiples du corps, et rien en tailles fixes : sur une page manuscrite,
   * le texte suit le zoom, et sa mise en page doit coïncider avec celle du PDF.
   */
  relatif?: boolean;
}) {
  const blocks = React.useMemo(() => parseMarkup(children), [children]);

  return (
    // `space-y` plutôt qu'une marge par élément : l'espacement reste correct
    // quel que soit l'ordre des blocs.
    <div className={cn(relatif ? "space-y-[0.4em] break-words" : "space-y-3 break-words leading-relaxed", className)}>
      {blocks.map((block, index) => {
        const key = `b${index}`;

        if (block.kind === "heading") {
          const sizes = relatif
            ? ["text-[1.35em] font-bold", "text-[1.15em] font-bold", "text-[1.05em] font-bold"]
            : ["text-lg font-semibold", "text-base font-semibold", "text-sm font-semibold"];
          return (
            <p key={key} className={sizes[block.level - 1]}>
              {renderInline(block.children, key)}
            </p>
          );
        }

        if (block.kind === "bullets" || block.kind === "numbers") {
          return <ListeRendue key={key} noeud={arbreListe(block)} cle={key} relatif={relatif} />;
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

function listeHtml(noeud: NoeudListe): string {
  const balise = noeud.ordonnee ? "ol" : "ul";
  const items = noeud.items
    .map((item) => `<li>${inlineToHtml(item.contenu)}${item.enfants.map(listeHtml).join("")}</li>`)
    .join("");
  return `<${balise}>${items}</${balise}>`;
}

/** Une seule ligne, sans bloc autour : elle rejoint la ligne où est le curseur. */
export function markupInlineHtml(ligne: string): string {
  return inlineToHtml(parseInline(protect(ligne)));
}

/** Convertit le balisage stocké en HTML, pour le contenu initial de l'éditeur. */
export function markupToHtml(source: string): string {
  const blocks = parseMarkup(source);
  if (blocks.length === 0) return "";

  return blocks
    .map((block) => {
      if (block.kind === "heading") {
        // Un vrai titre, et non du gras : le gras se relisait comme tel, et un
        // titre rouvert dans l'éditeur perdait son rang à l'enregistrement.
        return `<h${block.level}>${inlineToHtml(block.children)}</h${block.level}>`;
      }
      if (block.kind === "bullets" || block.kind === "numbers") {
        return listeHtml(arbreListe(block));
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
  const plain = protect(source)
    .replace(/\{c:[a-z]+\}|\{\/c\}/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/~~([^~]+)~~/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/^\s*#{1,3}\s+/gm, "")
    .replace(/^\s*[-*]\s+/gm, "• ")
    .replace(/^\s*(\d+)[.)]\s+/gm, "$1. ");
  return restore(plain);
}
