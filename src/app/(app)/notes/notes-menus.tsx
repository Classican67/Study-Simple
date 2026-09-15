"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Circle,
  CircleCheck,
  Copy,
  FilePlus2,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Pencil,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ContextMenu, MoreButton, type MenuAction } from "@/components/context-menu";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import {
  MAX_FOLDER_DEPTH,
  depthOf,
  folderOptions,
  folderPaths,
  type FolderNode,
} from "@/lib/folder-tree";
import { UNTITLED } from "@/lib/notes";
import { cn } from "@/lib/utils";
import { createFolder, deleteFolder, moveFolder, updateFolder } from "../folder-actions";
import { FolderForm } from "../folder-form";
import { MoveDialog } from "../move-dialog";
import { createNote, deleteNote, duplicateNote, renameNote, setNoteMastered } from "./actions";
import { MoveNote } from "./[noteId]/move-note";
import { NoteDragHandle } from "./note-drag-handle";

/**
 * Menus des notes et des dossiers de la liste : ouvrir, créer, renommer,
 * dupliquer, ranger, supprimer — sans ouvrir l'élément pour le faire.
 *
 * L'arborescence n'est transmise qu'une fois, par le fournisseur : la passer à
 * chaque carte la répéterait deux cents fois dans la page, et la liste doit
 * rester légère (cf. `verify/vignettes-e2e.mjs`).
 */

const Arbre = React.createContext<FolderNode[]>([]);

export function NotesMenusProvider({ tree, children }: { tree: FolderNode[]; children: React.ReactNode }) {
  return <Arbre.Provider value={tree}>{children}</Arbre.Provider>;
}

/** Message bref en bas de l'écran, pour ce qui n'a pas de boîte où s'afficher. */
function useAnnonce() {
  const [message, setMessage] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!message) return;
    const minuteur = window.setTimeout(() => setMessage(null), 5000);
    return () => window.clearTimeout(minuteur);
  }, [message]);
  const annonce = (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "fixed bottom-24 left-1/2 z-50 -translate-x-1/2 rounded-full bg-surface-highest px-4 py-2 m3-label-large text-on-surface elevation-2 transition-opacity md:bottom-6",
        message ? "opacity-100" : "pointer-events-none opacity-0",
      )}
    >
      {message}
    </p>
  );
  return [annonce, setMessage] as const;
}

type DialogueNote = "renommer" | "ranger" | "supprimer" | null;

export function NoteMenu({
  note,
  children,
}: {
  note: { id: string; title: string; folderId: string | null; mastered: boolean };
  children: React.ReactNode;
}) {
  const router = useRouter();
  const tree = React.useContext(Arbre);
  const chemins = React.useMemo(() => folderPaths(tree), [tree]);
  const [dialogue, setDialogue] = React.useState<DialogueNote>(null);
  const [annonce, annoncer] = useAnnonce();
  const nom = note.title.trim() || UNTITLED;
  const fermer = () => setDialogue(null);

  async function dupliquer() {
    try {
      const id = await duplicateNote(note.id);
      if (!id) {
        annoncer("Duplication impossible.");
        return;
      }
      annoncer(`« ${nom} » dupliquée.`);
      router.refresh();
    } catch {
      annoncer("Duplication impossible — vérifie ta connexion.");
    }
  }

  async function marquer() {
    try {
      const result = await setNoteMastered(note.id, !note.mastered);
      if (!result.ok) {
        annoncer(result.error ?? "Enregistrement impossible.");
        return;
      }
      router.refresh();
    } catch {
      annoncer("Enregistrement impossible — vérifie ta connexion.");
    }
  }

  const actions: MenuAction[] = [
    { label: "Ouvrir", icon: SquareArrowOutUpRight, onSelect: () => router.push(`/notes/${note.id}`) },
    note.mastered
      ? { label: "Retirer la marque « maîtrisée »", icon: Circle, onSelect: () => void marquer() }
      : { label: "Marquer comme maîtrisée", icon: CircleCheck, onSelect: () => void marquer() },
    { label: "Renommer", icon: Pencil, onSelect: () => setDialogue("renommer") },
    { label: "Dupliquer", icon: Copy, onSelect: () => void dupliquer() },
    { label: "Ranger dans un dossier", icon: FolderInput, onSelect: () => setDialogue("ranger") },
    { label: "Supprimer", icon: Trash2, destructive: true, onSelect: () => setDialogue("supprimer") },
  ];

  return (
    <ContextMenu
      label={`Options de la note « ${nom} »`}
      actions={actions}
      trigger={
        // La poignée et le menu, ensemble dans le coin : sur une vignette, un
        // fond les détache de la page qu'ils recouvrent.
        <div className="absolute right-2 top-2 z-10 flex items-center rounded-full bg-surface-container/90 backdrop-blur-sm">
          <NoteDragHandle noteId={note.id} title={nom} />
          <MoreButton label={`Options de la note « ${nom} »`} />
        </div>
      }
    >
      {children}

      {dialogue === "renommer" ? (
        <RenommerNote id={note.id} titre={note.title} onClose={fermer} />
      ) : null}

      {dialogue === "ranger" ? (
        <MoveNote
          noteId={note.id}
          folderId={note.folderId}
          folders={chemins}
          open
          onOpenChange={(open) => (open ? null : fermer())}
        />
      ) : null}

      {dialogue === "supprimer" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? null : fermer())}
          title={`Supprimer « ${nom} » ?`}
          description="La note et tous ses blocs seront définitivement effacés."
          confirmLabel="Supprimer"
          action={async () => {
            try {
              const result = await deleteNote(note.id);
              if (!result.ok) annoncer(result.error ?? "Suppression impossible.");
            } catch {
              annoncer("Suppression impossible — vérifie ta connexion.");
            }
            fermer();
            router.refresh();
          }}
        />
      ) : null}

      {annonce}
    </ContextMenu>
  );
}

function RenommerNote({ id, titre, onClose }: { id: string; titre: string; onClose: () => void }) {
  const router = useRouter();
  const [valeur, setValeur] = React.useState(titre);
  const [erreur, setErreur] = React.useState<string | null>(null);
  const [envoi, setEnvoi] = React.useState(false);

  return (
    <Dialog open onOpenChange={(open) => (open ? null : onClose())}>
      <DialogContent title="Renommer la note" className="sm:max-w-md">
        <form
          className="space-y-4"
          onSubmit={async (event) => {
            event.preventDefault();
            setEnvoi(true);
            try {
              const result = await renameNote(id, valeur.trim());
              if (!result.ok) {
                setErreur(result.error ?? "Renommage impossible.");
                return;
              }
              onClose();
              router.refresh();
            } catch {
              setErreur("Renommage impossible — vérifie ta connexion.");
            } finally {
              setEnvoi(false);
            }
          }}
        >
          <Field label="Titre" htmlFor="renommer-note">
            <Input
              id="renommer-note"
              value={valeur}
              onChange={(event) => setValeur(event.target.value)}
              maxLength={200}
              autoFocus
              placeholder={UNTITLED}
            />
          </Field>
          {erreur ? (
            <p role="alert" className="m3-body-medium text-error">
              {erreur}
            </p>
          ) : null}
          <div className="flex justify-end gap-2 pt-2">
            <DialogClose asChild>
              <Button type="button" variant="outlined">
                Annuler
              </Button>
            </DialogClose>
            <Button type="submit" disabled={envoi}>
              {envoi ? "Enregistrement…" : "Renommer"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type DialogueDossier = "modifier" | "sous-dossier" | "deplacer" | "supprimer" | null;

export function FolderMenu({
  folder,
  href,
  children,
}: {
  folder: FolderNode;
  /** Adresse du dossier, avec l'affichage courant de la liste. */
  href: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const tree = React.useContext(Arbre);
  const [dialogue, setDialogue] = React.useState<DialogueDossier>(null);
  const [annonce, annoncer] = useAnnonce();
  const fermer = () => setDialogue(null);

  const modifier = React.useMemo(() => updateFolder.bind(null, folder.id), [folder.id]);
  const creer = React.useMemo(() => createFolder.bind(null, folder.id, "note"), [folder.id]);
  // La branche du dossier est retirée : il ne peut pas devenir son propre
  // descendant.
  const destinations = React.useMemo(() => folderOptions(tree, folder.id), [tree, folder.id]);
  const plein = depthOf(tree, folder.id) >= MAX_FOLDER_DEPTH;

  async function nouvelleNote() {
    try {
      const id = await createNote(folder.id);
      if (id) router.push(`/notes/${id}`);
      else annoncer("Création impossible.");
    } catch {
      annoncer("Création impossible — vérifie ta connexion.");
    }
  }

  const actions: MenuAction[] = [
    { label: "Ouvrir", icon: FolderOpen, onSelect: () => router.push(href) },
    { label: "Nouvelle note ici", icon: FilePlus2, onSelect: () => void nouvelleNote() },
    {
      label: plein ? `Nouveau sous-dossier (${MAX_FOLDER_DEPTH} niveaux au plus)` : "Nouveau sous-dossier",
      icon: FolderPlus,
      disabled: plein,
      onSelect: () => setDialogue("sous-dossier"),
    },
    { label: "Renommer ou changer la couleur", icon: Pencil, onSelect: () => setDialogue("modifier") },
    { label: "Déplacer", icon: FolderInput, onSelect: () => setDialogue("deplacer") },
    { label: "Supprimer", icon: Trash2, destructive: true, onSelect: () => setDialogue("supprimer") },
  ];

  return (
    <ContextMenu
      label={`Options du dossier « ${folder.name} »`}
      actions={actions}
      trigger={
        <MoreButton
          label={`Options du dossier « ${folder.name} »`}
          className="absolute right-1 top-1/2 z-10 -translate-y-1/2"
        />
      }
    >
      {children}

      {dialogue === "modifier" || dialogue === "sous-dossier" ? (
        <Dialog open onOpenChange={(open) => (open ? null : fermer())}>
          <DialogContent
            title={dialogue === "modifier" ? "Modifier le dossier" : "Nouveau sous-dossier"}
            description={dialogue === "sous-dossier" ? `Dans « ${folder.name} ».` : undefined}
          >
            <FolderForm
              action={dialogue === "modifier" ? modifier : creer}
              submitLabel={dialogue === "modifier" ? "Enregistrer" : "Créer"}
              defaults={dialogue === "modifier" ? folder : undefined}
              onSaved={() => {
                fermer();
                router.refresh();
              }}
            />
          </DialogContent>
        </Dialog>
      ) : null}

      {dialogue === "deplacer" ? (
        <MoveDialog
          open
          onOpenChange={(open) => (open ? null : fermer())}
          title={`Déplacer « ${folder.name} »`}
          currentParentId={folder.parentId}
          options={destinations}
          rootLabel="Notes (aucun dossier)"
          action={async (destination) => {
            await moveFolder(folder.id, destination);
            router.refresh();
          }}
        />
      ) : null}

      {dialogue === "supprimer" ? (
        <ConfirmDialog
          open
          onOpenChange={(open) => (open ? null : fermer())}
          title={`Supprimer « ${folder.name} » ?`}
          description="Les sous-dossiers seront supprimés avec lui. Les notes qu'ils contiennent ne sont pas effacées : elles remontent à la racine des notes."
          confirmLabel="Supprimer le dossier"
          action={deleteFolder.bind(null, folder.id)}
        />
      ) : null}

      {annonce}
    </ContextMenu>
  );
}
