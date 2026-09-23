"use client";

import * as React from "react";
import { Bold, Italic, List, ListOrdered, Palette, Sigma, Strikethrough } from "lucide-react";

import {
  TEXT_COLORS,
  escapeMarkup,
  isTextColor,
  markupToHtml,
  type TextColor,
} from "@/components/rich-text";
import {
  GROUPES_MATHS,
  chercherSymboles,
  lireRecents,
  retenirRecent,
  type Symbole,
} from "@/lib/maths";
import { cn } from "@/lib/utils";

/**
 * Éditeur visuel : le gras s'affiche en gras, jamais sous forme de `**`.
 *
 * La saisie se fait dans un `contenteditable`, mais le HTML du navigateur
 * n'est **jamais** stocké : à chaque modification, l'arbre DOM est reparcouru
 * et retranscrit dans le balisage texte du projet. Ce qui part au serveur est
 * donc toujours une chaîne que notre propre analyseur sait relire, et rien de
 * ce que le navigateur pourrait produire (styles collés, balises exotiques)
 * n'atteint la base.
 */

// --- DOM → balisage ---------------------------------------------------------

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
 * écrit `data-c`, et le collage est réduit en texte brut.
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
      const prefix = () => (tag === "ul" ? "- " : `${++index}. `);
      for (const child of Array.from(element.childNodes)) walk(child, format, prefix);
      current = null;
      return;
    }

    const next = formatOf(element, format);

    if (BLOCK_TAGS.has(tag)) {
      open(tag === "li" && listItem ? listItem() : "");
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

// --- Commandes --------------------------------------------------------------

type Tool =
  | { kind: "command"; command: string; icon: React.ElementType; label: string; shortcut?: string }
  | { kind: "color"; icon: React.ElementType; label: string }
  | { kind: "maths"; icon: React.ElementType; label: string };

const TOOLS: Tool[] = [
  { kind: "command", command: "bold", icon: Bold, label: "Gras", shortcut: "Ctrl+B" },
  { kind: "command", command: "italic", icon: Italic, label: "Italique", shortcut: "Ctrl+I" },
  { kind: "command", command: "strikeThrough", icon: Strikethrough, label: "Barré" },
  { kind: "color", icon: Palette, label: "Couleur" },
  { kind: "maths", icon: Sigma, label: "Caractères mathématiques" },
  { kind: "command", command: "insertUnorderedList", icon: List, label: "Liste à puces" },
  { kind: "command", command: "insertOrderedList", icon: ListOrdered, label: "Liste numérotée" },
];

export function RichEditor({
  value,
  onChange,
  onBlur,
  placeholder,
  ariaLabel,
  className,
  compact = false,
  minHeight = "3.5rem",
}: {
  value: string;
  onChange: (markup: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  ariaLabel: string;
  className?: string;
  /** Masque la barre d'outils tant que le champ n'a pas le focus. */
  compact?: boolean;
  minHeight?: string;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [empty, setEmpty] = React.useState(!value.trim());
  const [colorOpen, setColorOpen] = React.useState(false);
  const [mathsOpen, setMathsOpen] = React.useState(false);

  // Le contenu initial n'est posé qu'au montage. Le réécrire à chaque rendu
  // replacerait le curseur au début à chaque frappe.
  React.useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.innerHTML = markupToHtml(value);
    setEmpty(!node.textContent?.trim());
    // Volontairement sans dépendance sur `value` : c'est l'éditeur qui fait
    // foi une fois monté.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = React.useCallback(() => {
    const node = ref.current;
    if (!node) return;
    setEmpty(!node.textContent?.trim());
    onChange(serializeEditor(node));
  }, [onChange]);

  function run(command: string) {
    const node = ref.current;
    if (!node) return;
    node.focus();
    // execCommand est déprécié mais reste le seul moyen, sans bibliothèque
    // d'édition complète, d'appliquer une mise en forme en conservant la pile
    // d'annulation native du navigateur.
    document.execCommand(command, false);
    emit();
  }

  function applyColor(color: TextColor | null) {
    const node = ref.current;
    if (!node) return;
    node.focus();
    setColorOpen(false);

    const selection = window.getSelection();
    if (!selection || selection.isCollapsed) return;

    const range = selection.getRangeAt(0);
    if (!node.contains(range.commonAncestorContainer)) return;

    // extractContents plutôt que surroundContents : ce dernier échoue dès
    // que la sélection traverse une frontière de balise.
    const fragment = range.extractContents();
    // Les couleurs intérieures sont retirées : sans cela un mot recoloré
    // garderait l'ancienne teinte, la plus intérieure l'emportant.
    fragment.querySelectorAll<HTMLElement>("span[data-c]").forEach((inner) => {
      inner.replaceWith(...Array.from(inner.childNodes));
    });

    const span = document.createElement("span");
    // Retirer la couleur garde le gras et l'italique. Au sein d'un texte
    // coloré, il faut aussi annuler la teinte héritée : c'est `none`, que la
    // transcription lit comme « pas de couleur ».
    span.dataset.c = color ?? "none";
    span.className = color ? `text-c-${color}` : "text-on-surface";
    span.appendChild(fragment);
    range.insertNode(span);

    selection.removeAllRanges();
    emit();
  }

  /*
   * Où en était le curseur.
   *
   * Le champ de recherche de la palette prend le focus, et le
   * `contenteditable` perd alors sa sélection : le symbole choisi atterrirait
   * au début du texte, ou nulle part. Les boutons, eux, ne la perdent pas
   * (`onMouseDown` + `preventDefault`), mais un seul chemin pour les deux vaut
   * mieux que deux chemins dont un seul est éprouvé.
   */
  const memoire = React.useRef<Range | null>(null);

  const memoriser = React.useCallback(() => {
    const node = ref.current;
    const selection = window.getSelection();
    if (!node || !selection || selection.rangeCount === 0) return;
    const range = selection.getRangeAt(0);
    if (node.contains(range.commonAncestorContainer)) memoire.current = range.cloneRange();
  }, []);

  function restaurer() {
    const node = ref.current;
    if (!node) return;
    node.focus();
    const range = memoire.current;
    if (!range || !node.contains(range.commonAncestorContainer)) return;
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
  }

  /**
   * Pose un caractère mathématique là où est le curseur.
   *
   * `insertText` et non une manipulation du DOM : c'est ce qui place le
   * caractère dans la mise en forme courante — un « π » tapé au milieu d'un mot
   * en gras reste en gras — et ce qui garde la pile d'annulation du navigateur.
   * Le symbole n'est **rien d'autre que du texte** : la transcription
   * l'échappera comme le reste s'il le faut, et il n'y a pas une ligne à
   * changer ailleurs pour qu'il survive à l'enregistrement.
   */
  function insertSymbol(symbole: Symbole) {
    const node = ref.current;
    if (!node) return;
    restaurer();
    document.execCommand("insertText", false, symbole.c);
    memoriser();
    emit();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (!event.metaKey && !event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      run("bold");
    } else if (key === "i") {
      event.preventDefault();
      run("italic");
    }
  }

  function onPaste(event: React.ClipboardEvent) {
    // Le HTML collé depuis une page web amène des styles et des balises qui
    // n'ont pas de traduction dans notre balisage : on n'en garde que le texte.
    event.preventDefault();
    const text = event.clipboardData.getData("text/plain");
    document.execCommand("insertText", false, text);
    emit();
  }

  return (
    <div
      className={cn(
        "group rounded-xl border border-outline-variant bg-surface-container",
        "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex-wrap items-center gap-0.5 border-b border-outline-variant bg-surface-container-high px-1.5 py-1",
          compact ? "hidden group-focus-within:flex" : "flex",
        )}
      >
        {TOOLS.map((tool) => {
          if (tool.kind === "color") {
            return (
              <div key={tool.label} className="relative">
                <ToolButton
                  icon={tool.icon}
                  label={tool.label}
                  onRun={() => {
                    setMathsOpen(false);
                    setColorOpen((open) => !open);
                  }}
                  pressed={colorOpen}
                />
                {colorOpen ? (
                  <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-xl border border-outline-variant bg-surface-container p-1.5 elevation-2">
                    {(Object.keys(TEXT_COLORS) as TextColor[]).map((name) => (
                      <button
                        key={name}
                        type="button"
                        aria-label={TEXT_COLORS[name].label}
                        title={TEXT_COLORS[name].label}
                        onMouseDown={(event) => {
                          event.preventDefault();
                          applyColor(name);
                        }}
                        className="grid size-11 place-items-center rounded-full"
                      >
                        <span
                          className="block size-6 rounded-full transition-transform group-hover:scale-110"
                          style={{ backgroundColor: TEXT_COLORS[name].css }}
                        />
                      </button>
                    ))}
                    <button
                      type="button"
                      aria-label="Retirer la couleur"
                      title="Retirer la couleur"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyColor(null);
                      }}
                      className="grid size-11 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface"
                    >
                      <span className="grid size-6 place-items-center rounded-full border border-outline-variant m3-body-small">
                        ✕
                      </span>
                    </button>
                  </div>
                ) : null}
              </div>
            );
          }

          if (tool.kind === "maths") {
            return (
              <span key={tool.label} data-maths-toggle>
                <ToolButton
                  icon={tool.icon}
                  label={tool.label}
                  pressed={mathsOpen}
                  onRun={() => {
                    setColorOpen(false);
                    setMathsOpen((open) => !open);
                  }}
                />
              </span>
            );
          }

          return (
            <ToolButton
              key={tool.label}
              icon={tool.icon}
              label={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
              onRun={() => run(tool.command)}
            />
          );
        })}

        {/*
          La palette se pose sur **toute la largeur de la barre**, et non sous
          son bouton : sur un téléphone, ce bouton est au milieu de la rangée,
          et un panneau ancré là déborderait l'écran par la droite.
        */}
        {mathsOpen ? (
          <PaletteMaths onChoisir={insertSymbol} onFermer={() => setMathsOpen(false)} />
        ) : null}
      </div>

      <div className="relative">
        {empty && placeholder ? (
          <span className="pointer-events-none absolute left-3 top-2 select-none m3-body-medium text-on-surface-variant">
            {placeholder}
          </span>
        ) : null}
        <div
          ref={ref}
          role="textbox"
          aria-multiline="true"
          aria-label={ariaLabel}
          contentEditable
          suppressContentEditableWarning
          onInput={() => {
            emit();
            memoriser();
          }}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onKeyUp={memoriser}
          onMouseUp={memoriser}
          onTouchEnd={memoriser}
          onPaste={onPaste}
          style={{ minHeight }}
          className={cn(
            "w-full px-3 py-2 text-sm leading-relaxed text-on-surface outline-none",
            // Les listes du contenteditable n'héritent pas des styles de base.
            "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
            "[&_code]:rounded [&_code]:bg-surface-container-high [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono",
          )}
        />
      </div>
    </div>
  );
}

/**
 * La palette de caractères mathématiques.
 *
 * Six familles et une recherche. La recherche n'est pas un ornement : personne
 * ne parcourt trente lettres grecques pour trouver λ, et personne ne sait dire
 * « U+03BB » — on tape « lambda ». Les accents ne comptent pas, « beta »
 * trouve « bêta ».
 *
 * Le panneau prend la largeur de la barre et défile : sur un téléphone, une
 * grille ancrée sous son bouton sortirait de l'écran par la droite, et une
 * liste de cent symboles sortirait par le bas.
 */
function PaletteMaths({
  onChoisir,
  onFermer,
}: {
  onChoisir: (symbole: Symbole) => void;
  onFermer: () => void;
}) {
  const [requete, setRequete] = React.useState("");
  /*
   * Les récents sont lus **une fois**, à l'ouverture.
   *
   * Les rafraîchir à chaque symbole posé ferait bouger la première rangée sous
   * le doigt entre deux appuis, ce qui est exactement ce qu'on ne veut pas
   * d'une palette. La liste se met à jour à la prochaine ouverture. Ce composant
   * ne paraît qu'après un clic, donc jamais au rendu serveur : lire le stockage
   * dès l'initialisation de l'état est ici sans danger.
   */
  const [recents] = React.useState<string[]>(lireRecents);
  const panneau = React.useRef<HTMLDivElement>(null);

  /*
   * Le panneau se retourne quand il n'y a pas la place dessous.
   *
   * La barre d'outils d'une carte peut se trouver n'importe où dans une longue
   * liste, et en bas de l'écran l'attendent encore la barre de navigation du
   * téléphone et le bouton « Réviser ». Déplié vers le bas, le panneau y
   * disparaissait : la capture ne montrait qu'une rangée de symboles, le reste
   * sous la barre. Aucune mesure ne le disait — il ne débordait ni en largeur,
   * ni la page.
   *
   * Le placement est posé **sur l'élément**, dans un effet de mise en page : un
   * état React rendrait le panneau deux fois, et on le verrait sauter.
   */
  React.useLayoutEffect(() => {
    const el = panneau.current;
    if (!el) return;
    const marge = 16;
    const r = el.getBoundingClientRect();
    const placeDessous = window.innerHeight - r.top - marge;
    const placeDessus = r.top - r.height - marge;
    if (r.bottom > window.innerHeight - marge && placeDessus > 0) {
      el.style.top = "auto";
      el.style.bottom = "100%";
      el.style.marginTop = "0";
      el.style.marginBottom = "0.25rem";
      el.style.maxHeight = `${Math.max(160, Math.min(r.height, r.top - marge))}px`;
    } else {
      el.style.maxHeight = `${Math.max(160, Math.min(r.height, placeDessous))}px`;
    }
    el.scrollIntoView({ block: "nearest" });
  }, []);

  // Échap ferme, comme tout panneau qui se superpose. Et un clic à côté aussi :
  // un panneau qu'on ne sait fermer qu'en retrouvant son bouton est un piège.
  React.useEffect(() => {
    const clavier = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        onFermer();
      }
    };
    const dehors = (event: PointerEvent) => {
      const cible = event.target;
      if (!(cible instanceof Element)) return;
      // Le bouton qui ouvre n'est pas « dehors » : fermer ici puis laisser son
      // bascule s'exécuter rouvrirait le panneau, et il deviendrait impossible
      // de le refermer par où on l'a ouvert.
      if (cible.closest("[data-maths-toggle]")) return;
      if (!panneau.current?.contains(cible)) onFermer();
    };
    document.addEventListener("keydown", clavier);
    // En phase de capture : le `preventDefault` des boutons de la barre
    // empêcherait sinon l'événement de nous parvenir.
    document.addEventListener("pointerdown", dehors, true);
    return () => {
      document.removeEventListener("keydown", clavier);
      document.removeEventListener("pointerdown", dehors, true);
    };
  }, [onFermer]);

  const trouves = requete.trim() ? chercherSymboles(requete) : null;
  const connus = new Map(
    GROUPES_MATHS.flatMap((g) => g.symboles).map((s) => [s.c, s] as const),
  );
  const groupes: { titre: string; symboles: Symbole[] }[] = trouves
    ? [{ titre: trouves.length > 0 ? "Résultats" : "Aucun symbole de ce nom", symboles: trouves }]
    : [
        ...(recents.length > 0
          ? [
              {
                titre: "Récents",
                symboles: recents
                  .map((c) => connus.get(c))
                  .filter((s): s is Symbole => s !== undefined),
              },
            ]
          : []),
        ...GROUPES_MATHS,
      ];

  return (
    <div
      ref={panneau}
      data-testid="palette-maths"
      className="absolute left-1.5 right-1.5 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl border border-outline-variant bg-surface-container p-2 elevation-2"
    >
      <input
        type="text"
        value={requete}
        /*
         * Pas de `autoFocus` : sur un téléphone, prendre le focus fait monter
         * le clavier logiciel, qui recouvre précisément la grille qu'on vient
         * d'ouvrir. La recherche se touche quand on en veut ; au clavier, elle
         * vient juste après le bouton dans l'ordre de tabulation.
         */
        onChange={(event) => setRequete(event.target.value)}
        placeholder="Chercher : racine, lambda…"
        aria-label="Chercher un caractère mathématique"
        className="mb-2 w-full rounded-lg border border-outline-variant bg-surface px-3 py-2 m3-body-small text-on-surface outline-none placeholder:text-on-surface-variant focus:border-primary"
      />
      {groupes.map((groupe) => (
        <div key={groupe.titre} className="mb-1 last:mb-0">
          <p className="px-1 pb-0.5 m3-label-medium text-on-surface-variant">{groupe.titre}</p>
          <div className="grid grid-cols-[repeat(auto-fill,minmax(2.75rem,1fr))]">
            {groupe.symboles.map((symbole) => (
              <button
                key={symbole.c}
                type="button"
                title={symbole.nom}
                aria-label={symbole.nom}
                // Comme les boutons de la barre : sans `preventDefault`, le
                // champ perd le focus avant l'insertion, et le curseur avec.
                onMouseDown={(event) => {
                  event.preventDefault();
                  onChoisir(symbole);
                  retenirRecent(symbole.c);
                }}
                className="group/sym grid size-11 place-items-center rounded-lg"
              >
                <span className="grid size-9 place-items-center rounded-lg text-lg leading-none text-on-surface transition-colors group-hover/sym:bg-outline-variant/60">
                  {symbole.c}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ToolButton({
  icon: Icon,
  label,
  onRun,
  pressed,
}: {
  icon: React.ElementType;
  label: string;
  onRun: () => void;
  pressed?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={pressed}
      // onMouseDown avec preventDefault : sans cela le champ perd le focus
      // avant l'action, et la sélection à mettre en forme disparaît.
      onMouseDown={(event) => {
        event.preventDefault();
        onRun();
      }}
      // La zone d'appui fait 44 px, l'aplat visible 28 : la cible tactile est
      // atteinte sans transformer la barre en rangée de gros boutons.
      className="group/tool grid size-11 place-items-center rounded-lg"
    >
      <span
        className={cn(
          "grid size-7 place-items-center rounded-lg text-on-surface-variant transition-colors",
          "group-hover/tool:bg-outline-variant/60 group-hover/tool:text-on-surface",
          pressed && "bg-outline-variant/60 text-on-surface",
        )}
      >
        <Icon className="size-4" />
      </span>
    </button>
  );
}
