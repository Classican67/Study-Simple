"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderInput, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { SelectionAction, SelectionBar, useSelection } from "@/components/selection";
import type { FolderOption } from "@/lib/folders";
import { MoveDialog } from "./move-dialog";
import { deleteDecks, moveDecks, type SelectionResult } from "./selection-actions";

/** Actions sur les paquets cochés : les ranger ailleurs, ou les supprimer. */
export function DeckSelectionBar({
  folderId,
  options,
}: {
  folderId: string | null;
  /** Tous les dossiers de paquets, y compris ceux du dossier ouvert. */
  options: FolderOption[];
}) {
  const router = useRouter();
  const selection = useSelection();
  const [dialogue, setDialogue] = React.useState<"deplacer" | "supprimer" | null>(null);
  const [erreur, setErreur] = React.useState<string | null>(null);
  // La profondeur limite les dossiers qu'on range, pas les paquets : tout
  // dossier peut en accueillir.
  const destinations = React.useMemo(() => options.map((o) => ({ ...o, disabled: false })), [options]);

  if (!selection) return null;
  const ids = selection.selected;
  const n = ids.length;
  const nom = `${n} paquet${n > 1 ? "s" : ""}`;

  async function executer(action: () => Promise<SelectionResult>) {
    setErreur(null);
    try {
      const result = await action();
      if (!result.ok) {
        setErreur(result.error ?? "Action impossible.");
        return;
      }
      selection!.exit();
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
      <SelectionBar noun={["paquet", "paquets"]} error={erreur}>
        <SelectionAction icon={FolderInput} label="Déplacer" onClick={() => setDialogue("deplacer")} />
        <SelectionAction
          icon={Trash2}
          label="Supprimer"
          destructive
          onClick={() => setDialogue("supprimer")}
        />
      </SelectionBar>

      {dialogue === "deplacer" ? (
        <MoveDialog
          open
          onOpenChange={(open) => (open ? null : setDialogue(null))}
          title={`Déplacer ${nom}`}
          currentParentId={folderId}
          options={destinations}
          action={(destination) => executer(() => moveDecks(ids, destination))}
        />
      ) : null}

      {dialogue === "supprimer" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? null : setDialogue(null))}
          title={`Supprimer ${nom} ?`}
          description={
            n > 1
              ? "Les paquets, leurs cartes et leur progression seront définitivement effacés."
              : "Le paquet, ses cartes et sa progression seront définitivement effacés."
          }
          confirmLabel="Supprimer"
          action={() => executer(() => deleteDecks(ids))}
        />
      ) : null}
    </>
  );
}
