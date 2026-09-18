"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, FolderInput, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { SelectionAction, SelectionBar, useSelection } from "@/components/selection";
import { folderOptions, type FolderNode } from "@/lib/folder-tree";
import { MoveDialog } from "../move-dialog";
import {
  deleteNotes,
  moveNotes,
  setNotesMastered,
  type SelectionResult,
} from "../selection-actions";

/** Actions sur les notes cochées : ranger, marquer maîtrisées, supprimer. */
export function NoteSelectionBar({
  folderId,
  tree,
  mastered,
}: {
  folderId: string | null;
  tree: FolderNode[];
  /** Les notes affichées déjà marquées « maîtrisées ». */
  mastered: string[];
}) {
  const router = useRouter();
  const selection = useSelection();
  const [dialogue, setDialogue] = React.useState<"ranger" | "supprimer" | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const destinations = React.useMemo(
    () => folderOptions(tree).map((o) => ({ ...o, disabled: false })),
    [tree],
  );

  if (!selection) return null;
  const ids = selection.selected;
  const n = ids.length;
  const nom = `${n} note${n > 1 ? "s" : ""}`;
  // Comme le menu d'une note : si toutes le sont déjà, le geste les démarque.
  const toutesMaitrisees = n > 0 && ids.every((id) => mastered.includes(id));

  async function executer(action: () => Promise<SelectionResult>, quitter = true) {
    setErreur(null);
    try {
      const result = await action();
      if (!result.ok) {
        setErreur(result.error ?? "Action impossible.");
        return;
      }
      if (quitter) selection!.exit();
      router.refresh();
    } catch {
      // Une action serveur rejetée doit rendre la main (cf. AGENTS.md).
      setErreur("Action impossible — vérifie ta connexion.");
    } finally {
      setDialogue(null);
    }
  }

  return (
    <>
      <SelectionBar noun={["note", "notes"]} error={erreur}>
        <SelectionAction
          icon={CircleCheck}
          label={toutesMaitrisees ? "Démarquer" : "Maîtrisée"}
          // La sélection reste : on marque souvent, puis on range.
          onClick={() => void executer(() => setNotesMastered(ids, !toutesMaitrisees), false)}
        />
        <SelectionAction icon={FolderInput} label="Ranger" onClick={() => setDialogue("ranger")} />
        <SelectionAction
          icon={Trash2}
          label="Supprimer"
          destructive
          onClick={() => setDialogue("supprimer")}
        />
      </SelectionBar>

      {dialogue === "ranger" ? (
        <MoveDialog
          open
          onOpenChange={(open) => (open ? null : setDialogue(null))}
          title={`Ranger ${nom}`}
          currentParentId={folderId}
          options={destinations}
          rootLabel="Notes (aucun dossier)"
          action={(destination) => executer(() => moveNotes(ids, destination))}
        />
      ) : null}

      {dialogue === "supprimer" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? null : setDialogue(null))}
          title={`Supprimer ${nom} ?`}
          description={
            n > 1
              ? "Les notes et tous leurs blocs seront définitivement effacés."
              : "La note et tous ses blocs seront définitivement effacés."
          }
          confirmLabel="Supprimer"
          action={() => executer(() => deleteNotes(ids))}
        />
      ) : null}
    </>
  );
}
