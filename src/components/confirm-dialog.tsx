"use client";

import * as React from "react";
import { useFormStatus } from "react-dom";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogTrigger } from "@/components/ui/dialog";

function ConfirmSubmit({ label, variant }: { label: string; variant: ButtonProps["variant"] }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant={variant} disabled={pending}>
      {pending ? "En cours…" : label}
    </Button>
  );
}

// Toute action destructrice passe par ici : la confirmation est une vraie
// modale focalisée, pas un window.confirm() que le navigateur peut bloquer.
export function ConfirmDialog({
  trigger,
  title,
  description,
  confirmLabel,
  action,
  variant = "error",
}: {
  trigger: React.ReactNode;
  title: string;
  description: string;
  confirmLabel: string;
  action: () => Promise<void>;
  variant?: ButtonProps["variant"];
}) {
  return (
    <Dialog>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description} className="max-w-md">
        <form action={action} className="flex justify-end gap-2">
          <DialogClose asChild>
            <Button type="button" variant="outlined">
              Annuler
            </Button>
          </DialogClose>
          <ConfirmSubmit label={confirmLabel} variant={variant} />
        </form>
      </DialogContent>
    </Dialog>
  );
}
