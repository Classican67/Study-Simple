"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { FolderInput } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { moveNote } from "../actions";

/**
 * Range la note dans un dossier.
 *
 * Les dossiers sont ceux des notes, séparés de ceux des paquets. Le chemin
 * complet est affiché, sinon deux dossiers homonymes seraient impossibles à
 * distinguer.
 */
export function MoveNote({
  noteId,
  folderId,
  folders,
  open: ouvertDehors,
  onOpenChange,
}: {
  noteId: string;
  folderId: string | null;
  folders: { id: string; path: string }[];
  /** Ouverte d'ailleurs — le menu d'une note : aucun déclencheur n'est rendu. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const router = useRouter();
  const [ouvert, setOuvert] = React.useState(false);
  const pilotee = ouvertDehors !== undefined;
  const open = pilotee ? ouvertDehors : ouvert;
  const setOpen = (next: boolean) => (pilotee ? onOpenChange?.(next) : setOuvert(next));
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function choisir(next: string | null) {
    setPending(true);
    const result = await moveNote(noteId, next);
    setPending(false);
    if (!result.ok) {
      setError(result.error ?? "Déplacement impossible.");
      return;
    }
    setOpen(false);
    router.refresh();
  }

  const actuel = folders.find((f) => f.id === folderId);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {pilotee ? null : (
        <DialogTrigger asChild>
          <Button
            variant="text"
            size="icon"
            aria-label={actuel ? `Ranger la note — actuellement dans ${actuel.path}` : "Ranger la note"}
            title={actuel ? `Dans « ${actuel.path} »` : "Ranger dans un dossier"}
          >
            <FolderInput />
          </Button>
        </DialogTrigger>
      )}

      <DialogContent
        title="Ranger la note"
        description={actuel ? `Actuellement dans « ${actuel.path} ».` : "Actuellement hors de tout dossier."}
      >
        {error ? (
          <p role="alert" className="mb-3 m3-body-medium text-error">
            {error}
          </p>
        ) : null}

        <ul className="scroll-slim max-h-80 space-y-1 overflow-y-auto">
          <li>
            <Choix
              label="Aucun dossier"
              active={folderId === null}
              disabled={pending}
              onSelect={() => choisir(null)}
            />
          </li>
          {folders.map((folder) => (
            <li key={folder.id}>
              <Choix
                label={folder.path}
                active={folderId === folder.id}
                disabled={pending}
                onSelect={() => choisir(folder.id)}
              />
            </li>
          ))}
        </ul>

        {folders.length === 0 ? (
          <p className="mt-2 m3-body-small text-on-surface-variant">
            Aucun dossier pour l&apos;instant. Crée-en un depuis la liste des notes.
          </p>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function Choix({
  label,
  active,
  disabled,
  onSelect,
}: {
  label: string;
  active: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled}
      aria-pressed={active}
      className={
        "state-layer flex min-h-12 w-full items-center rounded-xl px-4 text-left m3-body-large transition-colors disabled:opacity-60 " +
        (active ? "bg-primary-container text-on-primary-container" : "text-on-surface hover:bg-surface-container")
      }
    >
      {label}
    </button>
  );
}
