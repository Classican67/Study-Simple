"use client";

import * as React from "react";
import { FolderInput, Settings2, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import type { FolderNode, FolderOption } from "@/lib/folders";
import { deleteFolder, moveFolder, updateFolder } from "./folder-actions";
import { FolderForm } from "./folder-form";
import { MoveDialog } from "./move-dialog";

export function FolderSettings({
  folder,
  options,
}: {
  folder: FolderNode;
  options: FolderOption[];
}) {
  const [editing, setEditing] = React.useState(false);
  const action = React.useMemo(() => updateFolder.bind(null, folder.id), [folder.id]);
  const move = React.useMemo(() => moveFolder.bind(null, folder.id), [folder.id]);

  return (
    <div className="flex items-center gap-1">
      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogTrigger asChild>
          <Button variant="text" size="icon" aria-label="Renommer le dossier">
            <Settings2 />
          </Button>
        </DialogTrigger>
        <DialogContent title="Modifier le dossier">
          <FolderForm
            action={action}
            submitLabel="Enregistrer"
            defaults={folder}
            onSaved={() => setEditing(false)}
          />
        </DialogContent>
      </Dialog>

      <MoveDialog
        trigger={
          <Button variant="text" size="icon" aria-label="Déplacer le dossier">
            <FolderInput />
          </Button>
        }
        title={`Déplacer « ${folder.name} »`}
        currentParentId={folder.parentId}
        options={options}
        action={move}
      />

      <ConfirmDialog
        trigger={
          <Button
            variant="text"
            size="icon"
            aria-label="Supprimer le dossier"
            className="hover:text-error"
          >
            <Trash2 />
          </Button>
        }
        title={`Supprimer « ${folder.name} » ?`}
        description="Les sous-dossiers seront supprimés avec lui. Les paquets qu'ils contiennent ne sont pas effacés : ils remontent à l'accueil."
        confirmLabel="Supprimer le dossier"
        action={deleteFolder.bind(null, folder.id)}
      />
    </div>
  );
}
