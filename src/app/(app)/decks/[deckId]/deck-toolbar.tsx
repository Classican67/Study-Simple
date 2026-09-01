"use client";

import * as React from "react";
import { FolderInput, RotateCcw, Settings2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { DeckForm } from "../../deck-form";
import { deleteDeck, updateDeck } from "../../actions";
import { moveDeck } from "../../folder-actions";
import { MoveDialog } from "../../move-dialog";
import type { FolderOption } from "@/lib/folders";
import { resetDeckProgress } from "./study/actions";

export function DeckSettings({
  deck,
  hasProgress,
  folderOptions,
}: {
  deck: { id: string; title: string; description: string; color: string; folderId: string | null };
  hasProgress: boolean;
  folderOptions: FolderOption[];
}) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="flex items-center gap-1">
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger asChild>
          <Button variant="text" size="icon" aria-label="Modifier le paquet">
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

      <MoveDialog
        trigger={
          <Button variant="text" size="icon" aria-label="Déplacer le paquet">
            <FolderInput />
          </Button>
        }
        title={`Déplacer « ${deck.title} »`}
        currentParentId={deck.folderId}
        options={folderOptions}
        action={moveDeck.bind(null, deck.id)}
      />

      {hasProgress ? (
        <ConfirmDialog
          trigger={
            <Button variant="text" size="icon" aria-label="Réinitialiser ma progression">
              <RotateCcw />
            </Button>
          }
          title="Réinitialiser ta progression ?"
          description="Toutes les cartes de ce paquet redeviennent « à revoir ». Les cartes elles-mêmes ne sont pas touchées, et la progression des autres comptes non plus."
          confirmLabel="Réinitialiser"
          variant="outlined"
          action={resetDeckProgress.bind(null, deck.id)}
        />
      ) : null}

      <ConfirmDialog
        trigger={
          <Button variant="text" size="icon" aria-label="Supprimer le paquet" className="hover:text-error">
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
