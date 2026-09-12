"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderPlus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createFolder } from "../folder-actions";
import { FolderForm } from "../folder-form";

/**
 * Crée un dossier depuis la section Notes.
 *
 * Les notes ont leur propre classement, distinct de celui des paquets : ranger
 * ses notes par thème ne doit pas encombrer la liste des paquets.
 */
export function NewNoteFolderButton({ parentId }: { parentId: string | null }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const action = React.useMemo(() => createFolder.bind(null, parentId, "note"), [parentId]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outlined" size="lg">
          <FolderPlus />
          Dossier
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Nouveau dossier"
        description="Regroupe tes notes par thème, par cours ou comme tu veux."
      >
        <FolderForm
          action={action}
          submitLabel="Créer"
          onSaved={() => {
            setOpen(false);
            // Le dossier n'apparaît dans la section Notes qu'une fois qu'il
            // contient quelque chose ; on rafraîchit pour le voir tout de suite
            // si une note y est déposée dans la foulée.
            router.refresh();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
