"use client";

import * as React from "react";
import { Expand, Pencil, Trash2 } from "lucide-react";

import { AnswerView } from "@/components/answer-view";
import { ImageLightbox } from "@/components/image-lightbox";
import { RichText, toPlainText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { CardForm } from "./card-form";
import { deleteCard, updateCard } from "./actions";

export type CardRowData = {
  id: string;
  term: string;
  definition: string;
  imagePath: string | null;
};

// Au-delà de ce seuil la réponse est repliée dans la liste et l'agrandissement
// devient le seul moyen confortable de la lire en entier.
const LONG_ANSWER = 220;

export function CardRow({ card, index }: { card: CardRowData; index: number }) {
  const [editing, setEditing] = React.useState(false);
  const isLong = card.definition.length > LONG_ANSWER;

  const boundUpdate = updateCard.bind(null, card.id);

  return (
    <li className="group rounded-card border border-border bg-surface p-4 transition-colors hover:border-accent/30">
      <div className="flex items-start gap-4">
        <span className="mt-0.5 w-6 shrink-0 text-sm tabular-nums text-fg-muted">{index + 1}</span>

        <div className="min-w-0 flex-1 space-y-2">
          <RichText className="font-medium leading-snug">{card.term}</RichText>

          <div className="text-sm text-fg-muted">
            {isLong ? (
              <>
                {/* Aperçu en texte nu : `line-clamp` ne coupe proprement qu'un
                    bloc simple, pas une suite de paragraphes et de listes. */}
                <p className="line-clamp-2 break-words">{toPlainText(card.definition)}</p>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="ghost" size="sm" className="mt-1 -ml-3">
                      <Expand />
                      Voir la réponse en entier
                    </Button>
                  </DialogTrigger>
                  {/* Le titre de la modale est une chaîne : on lui retire les
                      marqueurs, sinon « **mitose** » s'y afficherait tel quel. */}
                  <DialogContent title={toPlainText(card.term)}>
                    <AnswerView definition={card.definition} imagePath={card.imagePath} />
                  </DialogContent>
                </Dialog>
              </>
            ) : (
              <AnswerView definition={card.definition} imagePath={card.imagePath} compact />
            )}
          </div>

          {/* Réponse repliée : la vignette est sortie de la modale pour rester
              cliquable — et donc agrandissable — directement depuis la liste. */}
          {isLong && card.imagePath ? (
            <ImageLightbox
              src={`/api/uploads/${card.imagePath}`}
              alt="Illustration de la réponse"
              thumbnailClassName="max-h-20 w-auto"
            />
          ) : null}
        </div>

        {/* Toujours dans le DOM et focalisables au clavier : n'apparaître qu'au
            survol les rendrait inatteignables sans souris. */}
        <div className="flex shrink-0 gap-1 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <Dialog open={editing} onOpenChange={setEditing}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Modifier la carte ${index + 1}`}>
                <Pencil />
              </Button>
            </DialogTrigger>
            <DialogContent title="Modifier la carte">
              <CardForm
                action={boundUpdate}
                submitLabel="Enregistrer"
                onSaved={() => setEditing(false)}
                defaults={card}
              />
            </DialogContent>
          </Dialog>

          <ConfirmDialog
            trigger={
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Supprimer la carte ${index + 1}`}
                className="hover:text-danger"
              >
                <Trash2 />
              </Button>
            }
            title="Supprimer cette carte ?"
            description="La carte et son image seront définitivement effacées."
            confirmLabel="Supprimer"
            action={deleteCard.bind(null, card.id)}
          />
        </div>
      </div>
    </li>
  );
}
