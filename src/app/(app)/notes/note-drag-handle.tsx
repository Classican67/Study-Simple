"use client";

import { useRouter } from "next/navigation";

import { DragHandle } from "@/components/drag-move";
import { moveNote } from "./actions";

/**
 * Poignée de déplacement d'une note vers un dossier.
 *
 * Le glissement reste un raccourci : la boîte « Ranger » de l'éditeur fait le
 * même travail au clavier et reste le chemin accessible.
 */
export function NoteDragHandle({ noteId, title }: { noteId: string; title: string }) {
  const router = useRouter();

  return (
    <DragHandle
      label={title}
      onDrop={async (folderId) => {
        await moveNote(noteId, folderId);
        router.refresh();
      }}
    />
  );
}
