"use client";

import { Heading1, Heading2, List, Pilcrow, Quote } from "lucide-react";

import { RichEditor } from "@/components/rich-editor";
import { TEXT_STYLES, type TextContent, type TextStyle } from "@/lib/notes";
import { cn } from "@/lib/utils";

/**
 * Bloc de texte, façon traitement de texte.
 *
 * Le gras, l'italique et la couleur viennent de l'éditeur enrichi déjà utilisé
 * par les cartes — un seul moteur de balisage dans l'app, donc un seul endroit
 * où un défaut peut se loger. La **structure** (titre, paragraphe, citation,
 * puce) est en revanche portée par le bloc : c'est ce qui permet de la changer
 * d'un geste sans retoucher le texte, et de la rendre avec la vraie échelle
 * typographique de Material 3.
 */

const STYLES: Record<TextStyle, { label: string; icon: React.ElementType; className: string }> = {
  h1: { label: "Titre", icon: Heading1, className: "m3-headline-medium" },
  h2: { label: "Sous-titre", icon: Heading2, className: "m3-title-large" },
  p: { label: "Paragraphe", icon: Pilcrow, className: "m3-body-large" },
  quote: {
    label: "Citation",
    icon: Quote,
    className: "m3-body-large italic border-l-4 border-primary/40 pl-4",
  },
  bullet: { label: "Puce", icon: List, className: "m3-body-large" },
};

export function TextBlock({
  content,
  onChange,
  onBlur,
  readOnly = false,
}: {
  content: TextContent;
  onChange: (next: TextContent) => void;
  onBlur?: () => void;
  readOnly?: boolean;
}) {
  const style = STYLES[content.style] ?? STYLES.p;

  return (
    <div className="space-y-2">
      {!readOnly ? (
        <div role="group" aria-label="Style du bloc" className="flex flex-wrap items-center gap-0.5">
          {TEXT_STYLES.map((name) => {
            const entry = STYLES[name];
            const active = content.style === name;
            return (
              <button
                key={name}
                type="button"
                onClick={() => onChange({ ...content, style: name })}
                aria-pressed={active}
                aria-label={entry.label}
                title={entry.label}
                className={cn(
                  "grid size-11 place-items-center rounded-full transition-colors",
                  active
                    ? "bg-primary-container text-on-primary-container"
                    : "text-on-surface-variant hover:text-on-surface",
                )}
              >
                <entry.icon className="size-5" />
              </button>
            );
          })}
        </div>
      ) : null}

      <div className={cn("flex gap-2", content.style === "bullet" && "items-start")}>
        {content.style === "bullet" ? (
          // Une puce dessinée plutôt qu'une vraie liste : chaque bloc est
          // indépendant, une `<ul>` par bloc ne regrouperait rien.
          <span aria-hidden className="mt-3 size-1.5 shrink-0 rounded-full bg-on-surface-variant" />
        ) : null}
        <div className="min-w-0 flex-1">
          <RichEditor
            value={content.markup}
            onChange={(markup) => onChange({ ...content, markup })}
            onBlur={onBlur}
            ariaLabel={entryLabel(content.style)}
            placeholder={placeholderOf(content.style)}
            className={style.className}
          />
        </div>
      </div>
    </div>
  );
}

function entryLabel(style: TextStyle): string {
  return `Bloc ${STYLES[style]?.label.toLowerCase() ?? "texte"}`;
}

function placeholderOf(style: TextStyle): string {
  switch (style) {
    case "h1":
      return "Titre de la section";
    case "h2":
      return "Sous-titre";
    case "quote":
      return "Citation…";
    case "bullet":
      return "Point de la liste";
    default:
      return "Écris ici…";
  }
}
