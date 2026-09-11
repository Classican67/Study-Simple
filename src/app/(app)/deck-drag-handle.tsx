"use client";

import { useRouter } from "next/navigation";

import { DragHandle } from "@/components/drag-move";
import { moveDeck } from "./folder-actions";

/**
 * Poignée de déplacement d'un paquet vers un dossier.
 *
 * Le glissement reste un raccourci : la boîte « Déplacer » des réglages du
 * paquet fait le même travail au clavier et reste le chemin accessible.
 */
export function DeckDragHandle({ deckId, title }: { deckId: string; title: string }) {
  const router = useRouter();

  return (
    <DragHandle
      label={title}
      onDrop={async (folderId) => {
        await moveDeck(deckId, folderId);
        router.refresh();
      }}
    />
  );
}
