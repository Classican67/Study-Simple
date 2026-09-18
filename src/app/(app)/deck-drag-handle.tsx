"use client";

import { useRouter } from "next/navigation";

import { DragHandle } from "@/components/drag-move";
import { useSelection } from "@/components/selection";
import { moveDeck } from "./folder-actions";
import { moveDecks } from "./selection-actions";

/**
 * Poignée de déplacement d'un paquet vers un dossier.
 *
 * Le glissement reste un raccourci : la boîte « Déplacer » des réglages du
 * paquet fait le même travail au clavier et reste le chemin accessible.
 *
 * Saisir un paquet coché emporte toute la sélection, comme dans Fichiers.
 */
export function DeckDragHandle({ deckId, title }: { deckId: string; title: string }) {
  const router = useRouter();
  const selection = useSelection();
  const groupe =
    selection?.active && selection.has(deckId) && selection.selected.length > 1
      ? selection.selected
      : null;

  return (
    <DragHandle
      label={groupe ? `${groupe.length} paquets` : title}
      onDrop={async (folderId) => {
        if (groupe) {
          await moveDecks(groupe, folderId);
          selection?.exit();
        } else await moveDeck(deckId, folderId);
        router.refresh();
      }}
    />
  );
}
