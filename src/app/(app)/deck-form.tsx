"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";
import { DialogClose } from "@/components/ui/dialog";
import { ColorPicker } from "@/components/ui/color-picker";
import type { FormState } from "./actions";

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
        <p role="alert" className="flex items-center gap-2 text-sm text-error">
          <TriangleAlert className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="outlined">
            Annuler
          </Button>
        </DialogClose>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}
