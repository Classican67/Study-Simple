"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { TriangleAlert } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ColorPicker } from "@/components/ui/color-picker";
import { DialogClose } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import type { FolderState } from "./folder-actions";

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Enregistrement…" : label}
    </Button>
  );
}

export function FolderForm({
  action,
  submitLabel,
  defaults,
  onSaved,
}: {
  action: (prev: FolderState, formData: FormData) => Promise<FolderState>;
  submitLabel: string;
  defaults?: { name: string; color: string };
  onSaved?: () => void;
}) {
  const [state, formAction] = useActionState<FolderState, FormData>(async (prev, data) => {
    const result = await action(prev, data);
    // Pas d'erreur : l'opération a abouti, la modale peut se refermer.
    if (!result.error) onSaved?.();
    return result;
  }, {});

  return (
    <form action={formAction} className="space-y-4">
      <Field label="Nom du dossier" htmlFor="folder-name">
        <Input
          name="name"
          required
          maxLength={80}
          autoFocus
          defaultValue={defaults?.name}
          placeholder="Session automne 2026"
        />
      </Field>

      <ColorPicker defaultValue={defaults?.color ?? "slate"} />

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
