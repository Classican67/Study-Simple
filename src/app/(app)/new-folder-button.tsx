"use client";

import * as React from "react";
import { FolderPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createFolder } from "./folder-actions";
import { FolderForm } from "./folder-form";

export function NewFolderButton({
  parentId,
  className,
}: {
  parentId: string | null;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const action = React.useMemo(() => createFolder.bind(null, parentId), [parentId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outlined" size="lg" className={className}>
          <FolderPlus />
          Dossier
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Nouveau dossier"
        description="Les dossiers regroupent les paquets par matière, par session ou comme tu veux."
      >
        <FolderForm action={action} submitLabel="Créer" onSaved={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}
