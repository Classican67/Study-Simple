"use client";

import * as React from "react";
import {
  Bold,
  Code,
  Eye,
  Heading,
  Italic,
  List,
  ListOrdered,
  PenLine,
  Strikethrough,
} from "lucide-react";

import { RichText } from "@/components/rich-text";
import { cn } from "@/lib/utils";

/**
 * Champ de saisie avec mise en forme. Le contenu reste du TEXTE : la mise en
 * forme est notée en Markdown (**gras**, *italique*…) et rendue par RichText.
 *
 * Ce choix évite un éditeur WYSIWYG, qui stockerait du HTML en base et
 * imposerait de le nettoyer à chaque affichage. Ici, ce qui est stocké est
 * inoffensif par construction.
 */

// Remplace la sélection en passant par execCommand quand c'est possible :
// c'est le seul moyen de conserver la pile d'annulation native du navigateur.
// Sans cela, un clic sur « gras » rendrait le Ctrl+Z suivant inopérant.
function replaceSelection(textarea: HTMLTextAreaElement, replacement: string) {
  textarea.focus();

  const inserted =
    typeof document.execCommand === "function" &&
    document.execCommand("insertText", false, replacement);

  if (!inserted) {
    // Chemin de repli (navigateurs ayant retiré execCommand) : l'annulation
    // native est perdue, mais la saisie reste correcte.
    const { selectionStart, selectionEnd } = textarea;
    textarea.setRangeText(replacement, selectionStart, selectionEnd, "end");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }
}

// Étend la sélection aux lignes entières : préfixer des puces n'a de sens
// qu'en partant du début de ligne.
function expandToLines(textarea: HTMLTextAreaElement) {
  const { value, selectionStart, selectionEnd } = textarea;
  const start = value.lastIndexOf("\n", selectionStart - 1) + 1;
  const newlineAfter = value.indexOf("\n", selectionEnd);
  const end = newlineAfter === -1 ? value.length : newlineAfter;
  textarea.setSelectionRange(start, end);
  return value.slice(start, end);
}

// Les actions sont décrites en données, hors du composant, et non par des
// fonctions créées à chaque rendu. Une fermeture construite pendant le rendu
// et capturant une ref est précisément ce que le compilateur React refuse.
type ToolAction =
  | { type: "wrap"; marker: string; placeholder: string }
  | { type: "prefix"; style: "heading" | "bullet" | "number" };

const TOOLS: { icon: React.ElementType; label: string; shortcut?: string; action: ToolAction }[] = [
  { icon: Bold, label: "Gras", shortcut: "Ctrl+B", action: { type: "wrap", marker: "**", placeholder: "texte" } },
  { icon: Italic, label: "Italique", shortcut: "Ctrl+I", action: { type: "wrap", marker: "*", placeholder: "texte" } },
  { icon: Strikethrough, label: "Barré", action: { type: "wrap", marker: "~~", placeholder: "texte" } },
  { icon: Code, label: "Code", action: { type: "wrap", marker: "`", placeholder: "code" } },
  { icon: Heading, label: "Titre", action: { type: "prefix", style: "heading" } },
  { icon: List, label: "Liste à puces", action: { type: "prefix", style: "bullet" } },
  { icon: ListOrdered, label: "Liste numérotée", action: { type: "prefix", style: "number" } },
];

const PREFIX_RULES = {
  heading: { build: (line: string) => `## ${line}`, strip: /^\s*#{1,3}\s+/ },
  bullet: { build: (line: string) => `- ${line}`, strip: /^\s*[-*]\s+/ },
  number: { build: (line: string, index: number) => `${index + 1}. ${line}`, strip: /^\s*\d+[.)]\s+/ },
} as const;

export type RichTextareaProps = Omit<React.ComponentProps<"textarea">, "onChange"> & {
  /** Texte d'aide affiché sous la barre d'outils quand l'aperçu est masqué. */
  hint?: string;
};

export function RichTextarea({ className, defaultValue, hint, ...props }: RichTextareaProps) {
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const [text, setText] = React.useState(String(defaultValue ?? ""));
  const [preview, setPreview] = React.useState(false);

  // CardForm vide le formulaire après une création pour enchaîner la carte
  // suivante. Le textarea n'étant pas contrôlé, l'état d'aperçu doit suivre
  // cette remise à zéro, sinon l'aperçu garde le texte précédent.
  React.useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const onReset = () => setText(String(defaultValue ?? ""));
    form.addEventListener("reset", onReset);
    return () => form.removeEventListener("reset", onReset);
  }, [defaultValue]);

  const wrap = React.useCallback((marker: string, placeholder: string) => {
    const textarea = ref.current;
    if (!textarea) return;

    const { value, selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    const width = marker.length;

    // Déjà mis en forme : le même bouton retire la mise en forme.
    if (
      selected.length >= width * 2 &&
      selected.startsWith(marker) &&
      selected.endsWith(marker)
    ) {
      replaceSelection(textarea, selected.slice(width, -width));
      setText(textarea.value);
      return;
    }

    // Les marqueurs encadrent la sélection sans être sélectionnés : on les
    // englobe avant de retirer, sinon « **mot** » deviendrait « ****mot **** ».
    if (
      value.slice(selectionStart - width, selectionStart) === marker &&
      value.slice(selectionEnd, selectionEnd + width) === marker
    ) {
      textarea.setSelectionRange(selectionStart - width, selectionEnd + width);
      replaceSelection(textarea, selected);
      setText(textarea.value);
      return;
    }

    const body = selected || placeholder;
    replaceSelection(textarea, `${marker}${body}${marker}`);

    // Sans sélection, on place le curseur entre les marqueurs pour pouvoir
    // taper directement ; avec sélection, on la restaure mise en forme.
    const caret = textarea.selectionEnd;
    textarea.setSelectionRange(caret - width - body.length, caret - width);
    setText(textarea.value);
  }, []);

  const prefixLines = React.useCallback((build: (line: string, index: number) => string, strip: RegExp) => {
    const textarea = ref.current;
    if (!textarea) return;

    const block = expandToLines(textarea);
    const lines = block.split("\n");
    const allPrefixed = lines.every((line) => line.trim() === "" || strip.test(line));

    const next = lines
      .map((line, index) => {
        if (line.trim() === "") return line;
        return allPrefixed ? line.replace(strip, "") : build(line, index);
      })
      .join("\n");

    replaceSelection(textarea, next);
    setText(textarea.value);
  }, []);

  const run = React.useCallback(
    (action: ToolAction) => {
      if (action.type === "wrap") {
        wrap(action.marker, action.placeholder);
        return;
      }
      const rule = PREFIX_RULES[action.style];
      prefixLines(rule.build, rule.strip);
    },
    [wrap, prefixLines],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!event.metaKey && !event.ctrlKey) return;
    const key = event.key.toLowerCase();
    if (key === "b") {
      event.preventDefault();
      wrap("**", "texte");
    } else if (key === "i") {
      event.preventDefault();
      wrap("*", "texte");
    }
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-surface",
        "focus-within:border-accent focus-within:ring-2 focus-within:ring-ring",
      )}
    >
      <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-surface-raised px-1.5 py-1">
        {TOOLS.map((tool) => (
          <button
            key={tool.label}
            type="button"
            title={tool.shortcut ? `${tool.label} (${tool.shortcut})` : tool.label}
            aria-label={tool.label}
            // onMouseDown plutôt que onClick : sans cela le textarea perd le
            // focus avant l'action, et la sélection à mettre en forme disparaît.
            onMouseDown={(event) => {
              event.preventDefault();
              run(tool.action);
            }}
            disabled={preview}
            className="rounded-lg p-1.5 text-fg-muted transition-colors hover:bg-border/60 hover:text-fg disabled:opacity-40"
          >
            <tool.icon className="size-4" />
          </button>
        ))}

        <button
          type="button"
          onClick={() => {
            // L'aperçu lit la valeur réelle du champ : elle a pu changer sans
            // passer par onChange (autocomplétion, glisser-déposer de texte).
            if (ref.current) setText(ref.current.value);
            setPreview((p) => !p);
          }}
          aria-pressed={preview}
          className={cn(
            "ml-auto flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors",
            preview ? "bg-accent text-accent-fg" : "text-fg-muted hover:bg-border/60 hover:text-fg",
          )}
        >
          {preview ? <PenLine className="size-3.5" /> : <Eye className="size-3.5" />}
          {preview ? "Écrire" : "Aperçu"}
        </button>
      </div>

      {/* Le textarea reste monté sous l'aperçu : le démonter perdrait sa valeur
          et le champ ne serait plus envoyé avec le formulaire. */}
      <div className={preview ? "hidden" : undefined}>
        <textarea
          ref={ref}
          defaultValue={defaultValue}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={onKeyDown}
          className={cn(
            "w-full resize-y bg-transparent px-3 py-2 text-sm leading-relaxed text-fg",
            "placeholder:text-fg-muted/70 focus:outline-none",
            className,
          )}
          {...props}
        />
        {hint ? <p className="px-3 pb-2 text-xs text-fg-muted">{hint}</p> : null}
      </div>

      {preview ? (
        <div className="min-h-24 px-3 py-2 text-sm">
          {text.trim() ? (
            <RichText>{text}</RichText>
          ) : (
            <p className="text-fg-muted">Rien à prévisualiser.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
