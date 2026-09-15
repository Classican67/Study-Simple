import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { NoteEditor, type EditableBlock } from "@/components/note/note-editor";
import { Button } from "@/components/ui/button";
import { MasteredToggle } from "./mastered-toggle";
import { MoveNote } from "./move-note";
import { NotesTrail } from "../notes-trail";
import { requireUser } from "@/lib/auth";
import { buildBreadcrumb, folderPaths } from "@/lib/folder-tree";
import { noteFolderTree } from "@/lib/note-queries";
import { prisma } from "@/lib/prisma";
import { isBlockKind, UNTITLED } from "@/lib/notes";
import { deleteNote } from "../actions";

export const dynamic = "force-dynamic";

async function load(noteId: string, userId: string) {
  return prisma.note.findFirst({
    where: { id: noteId, ownerId: userId },
    select: {
      id: true,
      title: true,
      folderId: true,
      mastered: true,
      blocks: {
        orderBy: { position: "asc" },
        select: { id: true, kind: true, content: true },
      },
    },
  });
}

export async function generateMetadata(
  props: PageProps<"/notes/[noteId]">,
): Promise<Metadata> {
  const { noteId } = await props.params;
  const user = await requireUser();
  const note = await load(noteId, user.id);
  return { title: note?.title.trim() || UNTITLED };
}

export default async function NotePage(props: PageProps<"/notes/[noteId]">) {
  const { noteId } = await props.params;
  const user = await requireUser();

  const note = await load(noteId, user.id);
  // Note inexistante et note d'un autre compte donnent la même réponse.
  if (!note) notFound();

  const tree = await noteFolderTree(user.id);
  // Le chemin du dossier de la note : on revient là d'où l'on vient, pas à la
  // racine des notes.
  const trail = buildBreadcrumb(tree, note.folderId);
  const dossier = trail.at(-1);
  const retour = dossier ? `/notes?folder=${dossier.id}` : "/notes";

  // Un type inconnu viendrait d'une version plus récente de l'app : on ignore
  // le bloc plutôt que de faire échouer le rendu de toute la note.
  const blocks: EditableBlock[] = note.blocks
    .filter((block) => isBlockKind(block.kind))
    .map((block) => ({
      id: block.id,
      kind: block.kind as EditableBlock["kind"],
      content: block.content,
    }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <NotesTrail trail={trail.map(({ id, name }) => ({ id, name }))} inNote />

        <div className="flex flex-wrap items-center justify-end gap-0.5">
          <MasteredToggle noteId={note.id} mastered={note.mastered} />

          <MoveNote
            noteId={note.id}
            folderId={note.folderId}
            folders={folderPaths(tree)}
          />

          <ConfirmDialog
            trigger={
              <Button
                variant="text"
                size="icon"
                aria-label="Supprimer la note"
                className="hover:text-error"
              >
                <Trash2 />
              </Button>
            }
            title="Supprimer cette note ?"
            description="La note et tous ses blocs seront définitivement effacés."
            confirmLabel="Supprimer"
            action={async () => {
              "use server";
              await deleteNote(noteId);
              // La page qu'on vient de supprimer ne peut plus s'afficher : on
              // renvoie au dossier qui la contenait plutôt qu'à la racine.
              redirect(retour);
            }}
          />
        </div>
      </div>

      <NoteEditor
        noteId={note.id}
        initialTitle={note.title}
        initialBlocks={blocks}
      />
    </div>
  );
}
