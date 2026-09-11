import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Trash2 } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { NoteEditor, type EditableBlock } from "@/components/note/note-editor";
import { Button } from "@/components/ui/button";
import { MoveNote } from "./move-note";
import { requireUser } from "@/lib/auth";
import { listNoteFolders } from "@/lib/note-queries";
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

  const folders = await listNoteFolders(user.id);

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
      <div className="flex items-center justify-between gap-2">
        <Link
          href="/notes"
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 m3-label-large text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <ArrowLeft className="size-4" />
          Notes
        </Link>

        <div className="flex items-center gap-0.5">
          <MoveNote
            noteId={note.id}
            folderId={note.folderId}
            folders={folders}
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
              // renvoie à la liste plutôt que de laisser un écran mort.
              redirect("/notes");
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
