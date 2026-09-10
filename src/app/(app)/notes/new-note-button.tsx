"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { createNote } from "./actions";

/**
 * Crée une note et l'ouvre aussitôt.
 *
 * Pas de boîte de dialogue demandant un titre : on ne sait pas encore de quoi
 * parlera la note au moment où l'on décide de la prendre. Le titre se saisit
 * dans la page, où le curseur attend déjà.
 */
export function NewNoteButton() {
  const router = useRouter();
  const [pending, setPending] = React.useState(false);

  return (
    <Button
      size="lg"
      disabled={pending}
      onClick={async () => {
        setPending(true);
        const id = await createNote();
        if (id) router.push(`/notes/${id}`);
        else setPending(false);
      }}
    >
      {pending ? <Loader2 className="animate-spin" /> : <Plus />}
      Nouvelle note
    </Button>
  );
}
