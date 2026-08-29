"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { DialogClose } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { FormState } from "./actions";

const COLORS = [
  { value: "violet", css: "oklch(54% 0.21 292)", label: "Violet" },
  { value: "blue", css: "oklch(56% 0.17 250)", label: "Bleu" },
  { value: "emerald", css: "oklch(58% 0.14 160)", label: "Vert" },
  { value: "amber", css: "oklch(70% 0.16 70)", label: "Ambre" },
  { value: "rose", css: "oklch(60% 0.19 15)", label: "Rose" },
  { value: "slate", css: "oklch(55% 0.02 285)", label: "Gris" },
] as const;

function ColorPicker({ defaultValue }: { defaultValue: string }) {
  const [value, setValue] = React.useState(defaultValue);

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-sm font-medium text-fg">Couleur</legend>
      <input type="hidden" name="color" value={value} />
      <div className="flex flex-wrap gap-2">
        {COLORS.map((color) => (
          <button
            key={color.value}
            type="button"
            onClick={() => setValue(color.value)}
            // aria-pressed plutôt qu'un simple style : sans lui, la sélection
            // n'est perceptible qu'à l'œil.
            aria-pressed={value === color.value}
            aria-label={color.label}
            title={color.label}
            // 44 px : cible tactile minimale. La pastille visible reste plus
            // petite, dessinée par la bordure intérieure.
            className={cn(
              "grid size-11 place-items-center rounded-full transition-transform hover:scale-110",
              value === color.value && "ring-2 ring-fg ring-offset-2 ring-offset-surface",
            )}
            style={{ backgroundColor: color.css }}
          />
        ))}
      </div>
    </fieldset>
  );
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Enregistrement…" : label}
    </Button>
  );
}

export function DeckForm({
  action,
  submitLabel,
  defaults,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  submitLabel: string;
  defaults?: { title: string; description: string; color: string };
}) {
  const [state, formAction] = useActionState<FormState, FormData>(action, {});

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Titre" htmlFor="deck-title">
        <Input
          name="title"
          required
          maxLength={120}
          autoFocus
          defaultValue={defaults?.title}
          placeholder="Biologie cellulaire — chapitre 3"
        />
      </Field>

      <Field label="Description" htmlFor="deck-description" hint="Optionnel">
        <Textarea
          name="description"
          maxLength={500}
          rows={2}
          defaultValue={defaults?.description}
          placeholder="Mitose, méiose, cycle cellulaire"
        />
      </Field>

      <ColorPicker defaultValue={defaults?.color ?? "violet"} />

      {state.error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Annuler
          </Button>
        </DialogClose>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}
