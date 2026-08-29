"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createDeck } from "./actions";
import { DeckForm } from "./deck-form";

export function NewDeckButton({ variant = "primary" }: { variant?: ButtonProps["variant"] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant}>
          <Plus />
          Nouveau paquet
        </Button>
      </DialogTrigger>
      <DialogContent title="Nouveau paquet" description="Un paquet regroupe les cartes d'un cours.">
        {/* createDeck redirige vers le nouveau paquet : pas besoin de refermer
            la modale à la main, la navigation démonte tout. */}
        <DeckForm action={createDeck} submitLabel="Créer le paquet" />
      </DialogContent>
    </Dialog>
  );
}
