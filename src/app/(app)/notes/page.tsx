import type { Metadata } from "next";
import Link from "next/link";
import { FileText, NotebookPen, PenLine, Table2, Type } from "lucide-react";

import { EmptyState } from "@/components/ui/panel";
import { NewNoteButton } from "./new-note-button";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { UNTITLED } from "@/lib/notes";
import { describeAgo } from "@/lib/scheduling";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage() {
  const user = await requireUser();

  const notes = await prisma.note.findMany({
    where: { ownerId: user.id },
    // La note qu'on vient de quitter est celle qu'on rouvre le plus souvent.
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      updatedAt: true,
      // De quoi annoncer le contenu sans charger les blocs eux-mêmes : un
      // croquis pèse des centaines de kilooctets.
      blocks: { select: { kind: true } },
    },
  });

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-pretty m3-display-small">Notes</h1>
          <p className="mt-2 m3-body-large text-on-surface-variant">
            {notes.length === 0
              ? "Du texte, des tableaux, des croquis au stylet."
              : `${notes.length} note${notes.length > 1 ? "s" : ""}.`}
          </p>
        </div>
        {notes.length > 0 ? <NewNoteButton /> : null}
      </header>

      {notes.length === 0 ? (
        <EmptyState
          icon={<NotebookPen className="size-6" />}
          title="Aucune note"
          description="Prends tes notes de cours ici : paragraphes, tableaux calculés, et croquis à main levée avec un stylet."
          action={<NewNoteButton />}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((note) => (
            <li key={note.id}>
              <Link
                href={`/notes/${note.id}`}
                className="state-layer flex h-full flex-col gap-3 rounded-xl border border-outline-variant bg-surface-container p-5 elevation-1 transition-all hover:-translate-y-0.5 hover:elevation-2"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-primary-container text-on-primary-container">
                  <FileText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate m3-title-medium text-on-surface">
                    {note.title.trim() || UNTITLED}
                  </span>
                  <span className="mt-1 block m3-body-small text-on-surface-variant">
                    Modifiée {describeAgo(note.updatedAt)}
                  </span>
                </span>
                <Composition kinds={note.blocks.map((b) => b.kind)} />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Ce que contient la note, d'un coup d'œil. */
function Composition({ kinds }: { kinds: string[] }) {
  const counts = {
    text: kinds.filter((k) => k === "text").length,
    table: kinds.filter((k) => k === "table").length,
    drawing: kinds.filter((k) => k === "drawing").length,
  };
  const entries = [
    { n: counts.text, icon: Type, label: "blocs de texte" },
    { n: counts.table, icon: Table2, label: "tableaux" },
    { n: counts.drawing, icon: PenLine, label: "croquis" },
  ].filter((e) => e.n > 0);

  if (entries.length === 0) return null;

  return (
    <span className="flex flex-wrap items-center gap-3 m3-label-small text-on-surface-variant">
      {entries.map(({ n, icon: Icon, label }) => (
        <span key={label} className="flex items-center gap-1" title={`${n} ${label}`}>
          <Icon className="size-3.5" />
          {n}
        </span>
      ))}
    </span>
  );
}
