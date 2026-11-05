"use client";

import * as React from "react";
import { Bold, Italic, List, ListOrdered, Palette, Sigma, Strikethrough } from "lucide-react";

import { TEXT_COLORS, markupInlineHtml, markupToHtml, type TextColor } from "@/components/rich-text";
import { serializeEditor } from "@/lib/balisage-dom";
import { blocsDuPressePapiers, tableEnLignes, type BlocColle } from "@/lib/collage";
import {
  GROUPES_MATHS,
  chercherSymboles,
  lireRecents,
  retenirRecent,
  type Symbole,
} from "@/lib/maths";
import { cn } from "@/lib/utils";

export { serializeEditor };

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
  onPasteImage,
  onPasteBlocs,
  flottant = false,
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
  /** Une image collée. Sans lui, seul le texte du presse-papiers est repris. */
  onPasteImage?: (image: File) => void;
  /** Ce qui ne tient pas dans ce champ : un tableau, un très long texte. */
  onPasteBlocs?: (blocs: BlocColle[]) => void;
  /**
   * Posé sur une page : sans cadre, le texte à sa taille de page, et la barre au-dessus
   * de lui plutôt qu'en tête — elle ne doit pas le faire descendre pendant qu'on écrit.
   */
  flottant?: boolean;
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
    /*
     * Tabulation dans une liste : un niveau de plus, ou de moins. Elle ne sort
     * du champ que hors d'une liste — et Maj+Tab au premier niveau doit laisser
     * la main, sans quoi on ne quitterait jamais le champ au clavier.
     */
    if (event.key === "Tab" && dansUneListe()) {
      event.preventDefault();
      document.execCommand(event.shiftKey ? "outdent" : "indent", false);
      emit();
      return;
    }
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

  /**
   * Coller en gardant la structure.
   *
   * Le HTML du presse-papiers n'atteint jamais le champ : il est traduit dans
   * notre balisage (`lib/collage.ts`), et c'est **ce balisage** qui est remis
   * en HTML pour être inséré. Rien de ce que Word ou une page web a posé —
   * styles, polices, classes — ne peut donc entrer, et ce qui entre se relit à
   * l'identique après enregistrement.
   */
  function dansUneListe(): boolean {
    const noeud = window.getSelection()?.anchorNode ?? null;
    const element = noeud?.nodeType === 1 ? (noeud as Element) : noeud?.parentElement;
    return Boolean(element?.closest("li") && ref.current?.contains(element));
  }

  function onPaste(event: React.ClipboardEvent) {
    event.preventDefault();
    const donnees = event.clipboardData;

    const image = Array.from(donnees.files).find((f) => f.type.startsWith("image/"));
    if (image && onPasteImage) {
      onPasteImage(image);
      return;
    }

    const blocs = blocsDuPressePapiers(
      donnees.getData("text/html"),
      donnees.getData("text/plain"),
    );
    if (blocs.length === 0) return;

    // Un tableau, ou un texte trop long pour un seul champ : ce qui suit la
    // première partie devient des blocs, juste après celui-ci.
    if (onPasteBlocs && (blocs.length > 1 || blocs[0].kind === "table" || blocs[0].markup.length > 8000)) {
      const [premier, ...suite] = blocs;
      if (premier.kind === "text" && premier.markup.length <= 8000) {
        inserer(premier.markup);
        onPasteBlocs(suite);
      } else {
        onPasteBlocs(blocs);
      }
      return;
    }

    // Une carte n'a pas de tableau : il devient des lignes, plutôt que rien.
    inserer(blocs.map(enBalisage).join("\n"));
  }

  function inserer(markup: string) {
    const lignes = markup.split("\n");
    const simple = lignes.length === 1 && !/^(#{1,3}\s|\s*[-*]\s|\s*\d+[.)]\s)/.test(markup);
    // Sur une ligne, le texte rejoint la ligne en cours ; sinon il apporte ses
    // propres lignes.
    document.execCommand("insertHTML", false, simple ? markupInlineHtml(markup) : markupToHtml(markup));
    emit();
  }

  return (
    <div
      className={cn(
        "group",
        flottant
          ? "relative"
          : "rounded-xl border border-outline-variant bg-surface-container focus-within:border-primary focus-within:ring-2 focus-within:ring-primary",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex-wrap items-center gap-0.5 px-1.5 py-1",
          flottant
            ? "absolute bottom-full left-0 z-20 mb-2 flex w-max max-w-[min(90vw,28rem)] rounded-full bg-surface-high text-[1rem] elevation-2"
            : "border-b border-outline-variant bg-surface-high",
          flottant ? null : compact ? "hidden group-focus-within:flex" : "flex",
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
                  <div className="verre absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-xl p-1.5">
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
            flottant
              ? "w-full select-text outline-none [line-height:1.35] [&_li]:m-0 [&_ol]:pl-[1.2em] [&_ul]:pl-[1.2em]"
              : "w-full px-3 py-2 text-sm leading-relaxed text-on-surface outline-none",
            // Les listes du contenteditable n'héritent pas des styles de base.
            "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
            "[&_ul_ul]:list-[circle] [&_ul_ul_ul]:list-[square]",
            flottant
              ? "[&_h1]:text-[1.35em] [&_h1]:font-bold [&_h2]:text-[1.15em] [&_h2]:font-bold [&_h3]:text-[1.05em] [&_h3]:font-bold"
              : "[&_h1]:mt-2 [&_h1]:text-lg [&_h1]:font-semibold [&_h2]:mt-2 [&_h2]:text-base [&_h2]:font-semibold [&_h3]:mt-1 [&_h3]:font-semibold",
            "[&_code]:rounded [&_code]:bg-surface-high [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono",
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
      className="verre absolute left-1.5 right-1.5 top-full z-20 mt-1 max-h-72 overflow-y-auto rounded-xl p-2"
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

function enBalisage(bloc: BlocColle): string {
  return bloc.kind === "text" ? bloc.markup : tableEnLignes(bloc.rows);
}
