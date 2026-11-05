/**
 * Transcription d'un DOM dans le balisage stocké.
 *
 * Sortie de l'éditeur parce qu'elle sert désormais à deux choses : relire un
 * `contenteditable`, et relire ce qu'on colle depuis Word ou une page web.
 * Deux transcriptions finiraient par ne pas écrire la même chose — et ce qui est
 * collé doit pouvoir se relire exactement comme ce qui est tapé.
 *
 * Module neutre, sans `"use client"` : `lib/collage.ts` s'en sert, et il est
 * éprouvé sans navigateur.
 */

import { escapeMarkup, isTextColor, type TextColor } from "@/components/rich-text";

/*
 * Le DOM d'un contenteditable ne se transcrit pas balise par balise. Le
 * navigateur imbrique, découpe et recouvre ses éléments à sa guise, et une
 * traduction récursive écrivait des balisages que l'analyseur relisait de
 * travers — des `**` et des `{c:…}` visibles à la réouverture :
 *   - `**mot **` quand la sélection emportait l'espace (double-tap sur iPad) ;
 *   - `**a *b***` quand l'italique finit avec le gras : trois étoiles, que
 *     l'analyseur ferme au mauvais endroit ;
 *   - `{c:rose}a {c:blue}b{/c} c{/c}` quand on recolore un texte coloré ;
 *   - `**un\ndeux**` quand le gras enjambe un retour à la ligne, alors que
 *     l'analyse se fait ligne par ligne ;
 *   - `5*3*2` tapé au clavier, relu comme une italique.
 * Le DOM est donc d'abord **aplati** en lignes de segments, chacun portant
 * l'ensemble de ses mises en forme, puis réécrit : chaque ligne porte ses
 * propres marqueurs, les espaces restent hors des marqueurs, l'italique
 * s'écrit `_` pour ne jamais toucher l'étoile du gras, la couleur la plus
 * intérieure l'emporte sans imbrication, et le texte tapé est échappé.
 */

type Format = {
  strong: boolean;
  em: boolean;
  del: boolean;
  code: boolean;
  color: TextColor | null;
};

type Segment = { text: string; format: Format };
type Line = { prefix: string; segments: Segment[] };

const PLAIN: Format = { strong: false, em: false, del: false, code: false, color: null };

/**
 * Couleur portée par un span, lue sur `data-c` uniquement. `none` est posé
 * par « Retirer la couleur » à l'intérieur d'un texte coloré, et annule la
 * couleur héritée.
 *
 * On ne tente pas de rattraper une couleur posée en style inline : les
 * navigateurs normalisent la valeur à la sérialisation (`oklch(55% …)` devient
 * `oklch(0.55 …)`), donc toute comparaison de chaînes échouerait. Le cas ne se
 * présente d'ailleurs pas : la couleur est toujours posée par applyColor, qui
 * écrit `data-c`, et le collage traduit les siennes de la même façon.
 */
function colorOf(element: HTMLElement, inherited: TextColor | null): TextColor | null {
  const attribute = element.dataset.c;
  if (attribute === "none") return null;
  return attribute && isTextColor(attribute) ? attribute : inherited;
}

/**
 * Mise en forme qu'un élément ajoute — ou retire — à celle qu'il hérite.
 * WebKit ne défait pas toujours un gras en retirant la balise : dans un
 * `<strong>`, il pose un `<span style="font-weight: normal">`. Sans lire ce
 * style, le gras retiré revenait à la réouverture.
 */
function formatOf(element: HTMLElement, parent: Format): Format {
  const tag = element.tagName.toLowerCase();
  const next = { ...parent };

  if (tag === "b" || tag === "strong") next.strong = true;
  if (tag === "i" || tag === "em") next.em = true;
  if (tag === "s" || tag === "strike" || tag === "del") next.del = true;
  if (tag === "code") next.code = true;

  const style = element.style;
  if (style) {
    const weight = style.fontWeight;
    if (weight === "bold" || weight === "bolder" || Number(weight) >= 600) next.strong = true;
    else if (weight === "normal" || (weight && Number(weight) < 600)) next.strong = false;
    if (style.fontStyle === "italic") next.em = true;
    else if (style.fontStyle === "normal") next.em = false;
  }

  if (tag === "span") next.color = colorOf(element, parent.color);
  return next;
}

const BLOCK_TAGS = new Set(["div", "p", "li", "h1", "h2", "h3", "h4", "blockquote", "pre"]);

/** Un titre garde son rang : c'est lui qui structure ce qu'on relit. */
const TITRES: Record<string, string> = { h1: "# ", h2: "## ", h3: "### ", h4: "### " };

/** Indentation d'un niveau de liste : deux espaces, comme en Markdown. */
const RETRAIT = "  ";

/** Aplatit l'éditeur en lignes de segments mis en forme. */
function flatten(root: HTMLElement): Line[] {
  const lines: Line[] = [];
  let current: Line | null = null;

  const open = (prefix = "") => {
    // Un bloc ouvert juste après un autre, vide, le réutilise : sans cela
    // `<div><div>x</div></div>` laisserait une ligne vide devant.
    if (current && current.segments.length === 0 && !current.prefix) current.prefix = prefix;
    else {
      current = { prefix, segments: [] };
      lines.push(current);
    }
  };

  let profondeur = 0;

  const walk = (node: Node, format: Format, listItem?: () => string) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent ?? "";
      if (!text) return;
      if (!current) open();
      current!.segments.push({ text, format });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === "br") {
      if (!current) open();
      current = null;
      return;
    }

    if (tag === "ul" || tag === "ol") {
      let index = 0;
      const retrait = RETRAIT.repeat(profondeur);
      const prefix = () => retrait + (tag === "ul" ? "- " : `${++index}. `);
      profondeur += 1;
      for (const child of Array.from(element.childNodes)) walk(child, format, prefix);
      profondeur -= 1;
      current = null;
      return;
    }

    const next = formatOf(element, format);

    if (BLOCK_TAGS.has(tag)) {
      open(tag === "li" && listItem ? listItem() : (TITRES[tag] ?? ""));
      for (const child of Array.from(element.childNodes)) walk(child, next);
      current = null;
      return;
    }

    for (const child of Array.from(element.childNodes)) walk(child, next, listItem);
  };

  for (const child of Array.from(root.childNodes)) walk(child, PLAIN);
  return lines;
}

// Ordre d'imbrication : la couleur à l'extérieur, le code au plus près du
// texte. Un ordre fixe fait que deux segments voisins partagent leurs
// marqueurs extérieurs au lieu de les fermer et rouvrir.
const LAYERS: {
  key: keyof Format;
  wrap: (inner: string, format: Format) => string;
}[] = [
  { key: "color", wrap: (inner, f) => `{c:${f.color}}${inner}{/c}` },
  { key: "strong", wrap: (inner) => `**${inner}**` },
  { key: "del", wrap: (inner) => `~~${inner}~~` },
  { key: "em", wrap: (inner) => `_${inner}_` },
  { key: "code", wrap: (inner) => `\`${inner}\`` },
];

function emit(segments: Segment[], depth = 0): string {
  if (depth === LAYERS.length) return segments.map((s) => escapeMarkup(s.text)).join("");

  const layer = LAYERS[depth];
  let out = "";
  let start = 0;
  while (start < segments.length) {
    const value = segments[start].format[layer.key];
    let end = start + 1;
    while (end < segments.length && segments[end].format[layer.key] === value) end++;

    const inner = emit(segments.slice(start, end), depth + 1);
    if (!value) out += inner;
    else {
      // Les espaces restent hors des marqueurs : `**mot **` ne se relit pas.
      // Les couches intérieures les ont déjà repoussés au bord.
      const [, lead, core, trail] = /^(\s*)([\s\S]*?)(\s*)$/.exec(inner)!;
      out += core ? lead + layer.wrap(core, segments[start].format) + trail : inner;
    }
    start = end;
  }
  return out;
}

/** Transcrit le contenu d'un contenteditable dans le balisage stocké. */
export function serializeEditor(root: HTMLElement): string {
  return flatten(root)
    .map((line) => {
      const text = emit(line.segments);
      // Une puce vide ne vaut pas d'être gardée.
      if (line.prefix) return text.trim() ? line.prefix + text.trim() : null;
      return text;
    })
    .filter((line): line is string => line !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
