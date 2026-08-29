"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { ImagePlus, TriangleAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { RichTextarea } from "@/components/rich-textarea";
import { DialogClose } from "@/components/ui/dialog";
import type { CardFormState } from "./actions";

const MAX_BYTES = 8 * 1024 * 1024;

// Aperçu local avant envoi : l'utilisateur voit tout de suite ce qu'il attache,
// et l'URL blob est révoquée pour ne pas fuir de mémoire au fil des essais.
function ImageField({ existingPath }: { existingPath?: string | null }) {
  const [preview, setPreview] = React.useState<string | null>(
    existingPath ? `/api/uploads/${existingPath}` : null,
  );
  const [removed, setRemoved] = React.useState(false);
  const [tooBig, setTooBig] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);
  const blobRef = React.useRef<string | null>(null);

  React.useEffect(() => {
    return () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, []);

  function onPick(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);

    if (!file) {
      blobRef.current = null;
      setPreview(existingPath && !removed ? `/api/uploads/${existingPath}` : null);
      return;
    }

    // Contrôle côté client pour un retour immédiat ; le serveur revérifie,
    // parce qu'un formulaire peut toujours être envoyé sans passer par ici.
    if (file.size > MAX_BYTES) {
      setTooBig(true);
      event.target.value = "";
      return;
    }

    setTooBig(false);
    setRemoved(false);
    const url = URL.createObjectURL(file);
    blobRef.current = url;
    setPreview(url);
  }

  function clear() {
    if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    blobRef.current = null;
    if (inputRef.current) inputRef.current.value = "";
    setPreview(null);
    setRemoved(true);
    setTooBig(false);
  }

  return (
    <div className="space-y-1.5">
      <span className="text-sm font-medium text-fg">Image</span>
      <p className="text-xs text-fg-muted">
        Optionnelle, affichée à côté de la réponse. JPEG, PNG, WebP, GIF ou AVIF, 8 Mo max.
      </p>

      {/* Signale au serveur qu'il faut détacher l'image existante. */}
      {removed ? <input type="hidden" name="remove-image" value="1" /> : null}

      <input
        ref={inputRef}
        id="card-image"
        type="file"
        name="image"
        accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
        onChange={onPick}
        className="sr-only"
      />

      {preview ? (
        <div className="relative w-fit overflow-hidden rounded-xl border border-border">
          {/* <img> et non next/image : la source vient d'une route dynamique
              protégée dont on ne connaît pas les dimensions à l'avance. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={preview} alt="Aperçu de l'image de la carte" className="max-h-40 w-auto" />
          <button
            type="button"
            onClick={clear}
            aria-label="Retirer l'image"
            className="absolute right-1.5 top-1.5 rounded-lg bg-black/70 p-1.5 text-white transition-colors hover:bg-black"
          >
            <X className="size-3.5" />
          </button>
        </div>
      ) : (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => inputRef.current?.click()}
        >
          <ImagePlus />
          Ajouter une image
        </Button>
      )}

      {tooBig ? (
        <p role="alert" className="text-xs font-medium text-danger">
          Image trop lourde (8 Mo maximum).
        </p>
      ) : null}
    </div>
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

export function CardForm({
  action,
  submitLabel,
  onSaved,
  defaults,
}: {
  action: (prev: CardFormState, formData: FormData) => Promise<CardFormState>;
  submitLabel: string;
  onSaved?: () => void;
  defaults?: { term: string; definition: string; imagePath: string | null };
}) {
  const [state, formAction] = useActionState<CardFormState, FormData>(action, {});
  const formRef = React.useRef<HTMLFormElement>(null);

  React.useEffect(() => {
    if (!state.ok) return;
    onSaved?.();
    // En création, on vide le formulaire pour enchaîner la carte suivante
    // sans rouvrir la modale à chaque fois.
    if (!defaults) formRef.current?.reset();
  }, [state, onSaved, defaults]);

  return (
    <form ref={formRef} action={formAction} className="space-y-4">
      <Field label="Question (recto)" htmlFor="card-term">
        <RichTextarea
          name="term"
          required
          rows={2}
          maxLength={2000}
          autoFocus
          defaultValue={defaults?.term}
          placeholder="Qu'est-ce que la mitose ?"
        />
      </Field>

      <Field label="Réponse (verso)" htmlFor="card-definition">
        <RichTextarea
          name="definition"
          required
          rows={6}
          maxLength={10000}
          defaultValue={defaults?.definition}
          placeholder="Division cellulaire produisant deux cellules filles identiques…"
          hint="**gras** · *italique* · ~~barré~~ · `code` · « - » pour une puce · « 1. » pour une liste numérotée"
        />
      </Field>

      <ImageField existingPath={defaults?.imagePath} />

      {state.error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0" />
          {state.error}
        </p>
      ) : null}

      <div className="flex justify-end gap-2 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="secondary">
            Fermer
          </Button>
        </DialogClose>
        <Submit label={submitLabel} />
      </div>
    </form>
  );
}
