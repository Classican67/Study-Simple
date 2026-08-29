"use client";

import * as React from "react";
import { Bold, Italic, List, ListOrdered, Palette, Strikethrough } from "lucide-react";

import { TEXT_COLORS, isTextColor, markupToHtml, type TextColor } from "@/components/rich-text";
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

/**
 * Couleur portée par un span, lue sur `data-c` uniquement.
 *
 * On ne tente pas de rattraper une couleur posée en style inline : les
 * navigateurs normalisent la valeur à la sérialisation (`oklch(55% …)` devient
 * `oklch(0.55 …)`), donc toute comparaison de chaînes échouerait. Le cas ne se
 * présente d'ailleurs pas : la couleur est toujours posée par applyColor, qui
 * écrit `data-c`, et le collage est réduit en texte brut.
 */
function colorOf(element: HTMLElement): TextColor | null {
  const attribute = element.dataset.c;
  return attribute && isTextColor(attribute) ? attribute : null;
}

function serializeNode(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
  if (node.nodeType !== Node.ELEMENT_NODE) return "";

  const element = node as HTMLElement;
  const tag = element.tagName.toLowerCase();
  const inner = serializeChildren(element);

  // Un marqueur autour d'un contenu vide produirait du balisage bancal
  // (« **** »), que l'analyseur laisserait tel quel à l'écran.
  const wrap = (open: string, close = open) => (inner.trim() ? `${open}${inner}${close}` : inner);

  switch (tag) {
    case "br":
      return "\n";
    case "b":
    case "strong":
      return wrap("**");
    case "i":
    case "em":
      return wrap("*");
    case "s":
    case "strike":
    case "del":
      return wrap("~~");
    case "code":
      return wrap("`");
    case "ul":
    case "ol": {
      const items = Array.from(element.children).filter((c) => c.tagName === "LI");
      return items
        .map((item, index) => {
          const text = serializeChildren(item as HTMLElement).trim();
          return text ? `${tag === "ul" ? "-" : `${index + 1}.`} ${text}` : "";
        })
        .filter(Boolean)
        .join("\n");
    }
    case "li":
      return serializeChildren(element);
    case "div":
    case "p":
      // Le contenteditable crée un <div> par ligne : chacun devient une ligne.
      return inner;
    case "span": {
      const color = colorOf(element);
      return color && inner.trim() ? `{c:${color}}${inner}{/c}` : inner;
    }
    default:
      // Balise non gérée (collage depuis une page web) : on garde le texte.
      return inner;
  }
}

function serializeChildren(element: HTMLElement): string {
  return Array.from(element.childNodes).map(serializeNode).join("");
}

/** Transcrit le contenu d'un contenteditable dans le balisage stocké. */
export function serializeEditor(root: HTMLElement): string {
  const parts: string[] = [];

  for (const child of Array.from(root.childNodes)) {
    const isBlock =
      child.nodeType === Node.ELEMENT_NODE &&
      ["DIV", "P", "UL", "OL"].includes((child as HTMLElement).tagName);
    const text = serializeNode(child);
    if (isBlock) parts.push(text);
    else if (parts.length === 0) parts.push(text);
    // Texte nu à la racine : il appartient à la ligne en cours.
    else parts[parts.length - 1] += text;
  }

  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

// --- Commandes --------------------------------------------------------------

type Tool =
  | { kind: "command"; command: string; icon: React.ElementType; label: string; shortcut?: string }
  | { kind: "color"; icon: React.ElementType; label: string };

const TOOLS: Tool[] = [
  { kind: "command", command: "bold", icon: Bold, label: "Gras", shortcut: "Ctrl+B" },
  { kind: "command", command: "italic", icon: Italic, label: "Italique", shortcut: "Ctrl+I" },
  { kind: "command", command: "strikeThrough", icon: Strikethrough, label: "Barré" },
  { kind: "color", icon: Palette, label: "Couleur" },
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

    if (color === null) {
      // Retirer la couleur : on remplace la sélection par son texte nu.
      const text = range.toString();
      range.deleteContents();
      range.insertNode(document.createTextNode(text));
    } else {
      const span = document.createElement("span");
      span.dataset.c = color;
      span.className = `text-c-${color}`;
      // extractContents plutôt que surroundContents : ce dernier échoue dès
      // que la sélection traverse une frontière de balise.
      span.appendChild(range.extractContents());
      range.insertNode(span);
    }

    selection.removeAllRanges();
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
        "group rounded-xl border border-border bg-surface",
        "focus-within:border-accent focus-within:ring-2 focus-within:ring-ring",
        className,
      )}
    >
      <div
        className={cn(
          "relative flex-wrap items-center gap-0.5 border-b border-border bg-surface-raised px-1.5 py-1",
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
                  onRun={() => setColorOpen((open) => !open)}
                  pressed={colorOpen}
                />
                {colorOpen ? (
                  <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-lift">
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
                        className="size-7 rounded-full transition-transform hover:scale-110"
                        style={{ backgroundColor: TEXT_COLORS[name].css }}
                      />
                    ))}
                    <button
                      type="button"
                      aria-label="Retirer la couleur"
                      title="Retirer la couleur"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        applyColor(null);
                      }}
                      className="grid size-7 place-items-center rounded-full border border-border text-xs text-fg-muted transition-colors hover:text-fg"
                    >
                      ✕
                    </button>
                  </div>
                ) : null}
              </div>
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
      </div>

      <div className="relative">
        {empty && placeholder ? (
          <span className="pointer-events-none absolute left-3 top-2 select-none text-sm text-fg-subtle">
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
          onInput={emit}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          style={{ minHeight }}
          className={cn(
            "w-full px-3 py-2 text-sm leading-relaxed text-fg outline-none",
            // Les listes du contenteditable n'héritent pas des styles de base.
            "[&_ol]:list-decimal [&_ol]:pl-5 [&_ul]:list-disc [&_ul]:pl-5",
            "[&_code]:rounded [&_code]:bg-surface-raised [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono",
          )}
        />
      </div>
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
      className={cn(
        "rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-border/60 hover:text-fg",
        pressed && "bg-border/60 text-fg",
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
