"use client";

import * as React from "react";
import { Plus } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createDeck } from "./actions";
import { DeckForm } from "./deck-form";

export function NewDeckButton({
  folderId,
  variant = "filled",
  className,
}: {
  folderId: string | null;
  variant?: ButtonProps["variant"];
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const action = React.useMemo(() => createDeck.bind(null, folderId), [folderId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="lg" className={className}>
          <Plus />
          {/* « Nouveau paquet » et « Dossier » côte à côte débordent d'une
              ligne de téléphone. */}
          <span className="sm:hidden">Paquet</span>
          <span className="hidden sm:inline">Nouveau paquet</span>
        </Button>
      </DialogTrigger>
      <DialogContent title="Nouveau paquet" description="Un paquet regroupe les cartes d'un cours.">
        {/* createDeck redirige vers le nouveau paquet : pas besoin de refermer
            la modale à la main, la navigation démonte tout. */}
        <DeckForm action={action} submitLabel="Créer le paquet" />
      </DialogContent>
    </Dialog>
  );
}
