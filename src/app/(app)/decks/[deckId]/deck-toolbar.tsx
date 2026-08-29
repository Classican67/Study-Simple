"use client";

import * as React from "react";
import { Plus, RotateCcw, Settings2, Trash2 } from "lucide-react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeckForm } from "../../deck-form";
import { deleteDeck, updateDeck } from "../../actions";
import { resetDeckProgress } from "./study/actions";
import { CardForm } from "./card-form";
import { createCard } from "./actions";

export function AddCardButton({
  deckId,
  variant = "primary",
}: {
  deckId: string;
  variant?: ButtonProps["variant"];
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={variant} size="lg" className="flex-1 sm:flex-none">
          <Plus />
          <span className="sm:hidden">Carte</span>
          <span className="hidden sm:inline">Ajouter une carte</span>
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Nouvelle carte"
        description="Le formulaire se vide après l'enregistrement pour enchaîner la suivante."
      >
        {/* Pas de onSaved : la modale reste ouverte pour saisir en rafale. */}
        <CardForm action={createCard.bind(null, deckId)} submitLabel="Ajouter" />
      </DialogContent>
    </Dialog>
  );
}

export function DeckSettings({
  deck,
  hasProgress,
}: {
  deck: { id: string; title: string; description: string; color: string };
  hasProgress: boolean;
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" aria-label="Modifier le paquet">
            <Settings2 />
          </Button>
        </DialogTrigger>
        <DialogContent title="Modifier le paquet">
          <DeckForm
            action={updateDeck.bind(null, deck.id)}
            submitLabel="Enregistrer"
            defaults={deck}
          />
        </DialogContent>
      </Dialog>

      {hasProgress ? (
        <ConfirmDialog
          trigger={
            <Button variant="ghost" size="icon" aria-label="Réinitialiser ma progression">
              <RotateCcw />
            </Button>
          }
          title="Réinitialiser ta progression ?"
          description="Toutes les cartes de ce paquet redeviennent « à revoir ». Les cartes elles-mêmes ne sont pas touchées, et la progression des autres comptes non plus."
          confirmLabel="Réinitialiser"
          variant="secondary"
          action={resetDeckProgress.bind(null, deck.id)}
        />
      ) : null}

      <ConfirmDialog
        trigger={
          <Button variant="ghost" size="icon" aria-label="Supprimer le paquet" className="hover:text-danger">
            <Trash2 />
          </Button>
        }
        title={`Supprimer « ${deck.title} » ?`}
        description="Le paquet, toutes ses cartes et leurs images seront définitivement effacés."
        confirmLabel="Supprimer le paquet"
        action={deleteDeck.bind(null, deck.id)}
      />
    </div>
  );
}
