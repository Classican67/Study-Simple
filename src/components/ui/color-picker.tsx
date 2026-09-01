"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Doit rester aligné sur DECK_COLORS dans src/lib/decks.ts et sur l'énumération
// de validation : ces trois listes décrivent la même palette.
export const PICKER_COLORS = [
  { value: "violet", css: "oklch(54% 0.21 292)", label: "Violet" },
  { value: "blue", css: "oklch(56% 0.17 250)", label: "Bleu" },
  { value: "emerald", css: "oklch(58% 0.14 160)", label: "Vert" },
  { value: "amber", css: "oklch(70% 0.16 70)", label: "Ambre" },
  { value: "rose", css: "oklch(60% 0.19 15)", label: "Rose" },
  { value: "slate", css: "oklch(55% 0.02 285)", label: "Gris" },
] as const;

export function ColorPicker({
  name = "color",
  defaultValue,
  legend = "Couleur",
}: {
  name?: string;
  defaultValue: string;
  legend?: string;
}) {
  const [value, setValue] = React.useState(defaultValue);

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-on-surface">{legend}</legend>
      <input type="hidden" name={name} value={value} />
      <div className="flex flex-wrap gap-2">
        {PICKER_COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            onClick={() => setValue(color.value)}
            // aria-pressed plutôt qu'un simple style : sans lui, la sélection
            // n'est perceptible qu'à l'œil.
            aria-pressed={value === color.value}
            aria-label={color.label}
            title={color.label}
            // 44 px : cible tactile minimale.
            className={cn(
              "size-11 rounded-full transition-transform hover:scale-110",
              value === color.value && "ring-2 ring-on-surface ring-offset-2 ring-offset-surface-container",
            )}
            style={{ backgroundColor: color.css }}
          />
        ))}
      </div>
    </fieldset>
  );
}
