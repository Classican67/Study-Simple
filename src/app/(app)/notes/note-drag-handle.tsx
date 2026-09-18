"use client";

import { useRouter } from "next/navigation";

import { DragHandle } from "@/components/drag-move";
import { useSelection } from "@/components/selection";
import { moveNote } from "./actions";
import { moveNotes } from "../selection-actions";

/**
 * Poignée de déplacement d'une note vers un dossier.
 *
 * Le glissement reste un raccourci : la boîte « Ranger » de l'éditeur fait le
 * même travail au clavier et reste le chemin accessible.
 *
 * Saisir une note cochée emporte toute la sélection, comme dans Fichiers.
 */
export function NoteDragHandle({ noteId, title }: { noteId: string; title: string }) {
  const router = useRouter();
  const selection = useSelection();
  const groupe =
    selection?.active && selection.has(noteId) && selection.selected.length > 1
      ? selection.selected
      : null;

  return (
    <DragHandle
      label={groupe ? `${groupe.length} notes` : title}
      onDrop={async (folderId) => {
        if (groupe) {
          await moveNotes(groupe, folderId);
          selection?.exit();
        } else await moveNote(noteId, folderId);
        router.refresh();
      }}
    />
  );
}
