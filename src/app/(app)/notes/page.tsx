import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, FileText, Folder as FolderIcon, Home, NotebookPen, PenLine, Table2, Type } from "lucide-react";

import { EmptyState } from "@/components/ui/panel";
import { DropZone } from "@/components/drag-move";
import { NewNoteButton } from "./new-note-button";
import { NoteDragHandle } from "./note-drag-handle";
import { NewNoteFolderButton } from "./new-note-folder-button";
import { NoteSearch } from "./note-search";
import { requireUser } from "@/lib/auth";
import { deckColor } from "@/lib/deck-colors";
import { getNotesView, type NoteFilters } from "@/lib/note-queries";
import { UNTITLED } from "@/lib/notes";
import { describeAgo } from "@/lib/scheduling";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Notes" };

export default async function NotesPage(props: PageProps<"/notes">) {
  const user = await requireUser();
  const params = await props.searchParams;

  const folderId = typeof params.folder === "string" ? params.folder : null;
  const query = typeof params.q === "string" ? params.q : "";
  const has = ["drawing", "table", "text"].includes(String(params.has))
    ? (params.has as NoteFilters["has"])
    : null;

  const view = await getNotesView(user.id, folderId, { query, has });
  // Dossier inexistant et dossier d'un autre compte donnent la même réponse.
  if (!view) notFound();

  const cherche = query.trim().length > 0 || Boolean(has);
  const href = (extra: Record<string, string | null>) => {
    const url = new URLSearchParams();
    const base = { folder: folderId, q: query || null, has: has ?? null, ...extra };
    for (const [k, v] of Object.entries(base)) if (v) url.set(k, v);
    const qs = url.toString();
    return qs ? `/notes?${qs}` : "/notes";
  };

  return (
    <div className="space-y-6">
      {view.breadcrumb.length > 0 ? <Breadcrumb trail={view.breadcrumb} /> : null}

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-3">
          {view.current ? (
            <span
              className="mt-1 grid size-11 shrink-0 place-items-center rounded-2xl text-white elevation-1"
              style={{ backgroundColor: deckColor(view.current.color) }}
            >
              <FolderIcon className="size-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-pretty m3-display-small">{view.current?.name ?? "Notes"}</h1>
            <p className="mt-2 m3-body-large text-on-surface-variant">
              {view.total === 0
                ? "Du texte, des tableaux, et de l'écriture au stylet."
                : cherche
                  ? `${view.notes.length} note${view.notes.length > 1 ? "s" : ""} trouvée${view.notes.length > 1 ? "s" : ""}.`
                  : `${view.notes.length} note${view.notes.length > 1 ? "s" : ""} ici.`}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Les dossiers se créent aussi d'ici : ranger ses notes par thème
              ne doit pas obliger à passer par la section Paquets. */}
          <NewNoteFolderButton parentId={folderId} />
          {view.total > 0 ? <NewNoteButton folderId={folderId} /> : null}
        </div>
      </header>

      {view.total > 0 ? <NoteSearch query={query} has={has ?? null} folderId={folderId} /> : null}

      {view.total === 0 ? (
        <EmptyState
          icon={<NotebookPen className="size-6" />}
          title="Aucune note"
          description="Prends tes notes de cours ici : paragraphes, tableaux calculés, et pages manuscrites au stylet."
          action={<NewNoteButton folderId={folderId} />}
        />
      ) : null}

      {view.folders.length > 0 ? (
        <section className="space-y-2">
          <h2 className="m3-title-small text-on-surface-variant">Dossiers</h2>
          <ul className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {view.folders.map((folder) => (
              <DropZone key={folder.id} folderId={folder.id}>
                <Link
                  href={href({ folder: folder.id, q: null, has: null })}
                  className="state-layer flex min-h-14 items-center gap-3 rounded-xl border border-outline-variant bg-surface-container px-4 transition-all hover:-translate-y-0.5 hover:elevation-2"
                >
                  <span
                    className="grid size-9 shrink-0 place-items-center rounded-xl text-white"
                    style={{ backgroundColor: deckColor(folder.color) }}
                  >
                    <FolderIcon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate m3-title-small text-on-surface">
                    {folder.name}
                  </span>
                  <span className="m3-label-small tabular-nums text-on-surface-variant">
                    {folder.noteCount}
                  </span>
                </Link>
              </DropZone>
            ))}
          </ul>
        </section>
      ) : null}

      {view.total > 0 && view.notes.length === 0 ? (
        <p className="py-8 text-center m3-body-medium text-on-surface-variant">
          Aucune note ne correspond.
        </p>
      ) : null}

      {view.notes.length > 0 ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {view.notes.map((note) => (
            <li key={note.id} className="relative">
              {/* La poignée est hors du lien : un lien ne peut pas contenir de
                  bouton, et le glissement ne doit pas déclencher la navigation. */}
              <div className="absolute right-2 top-2 z-10">
                <NoteDragHandle noteId={note.id} title={note.title.trim() || UNTITLED} />
              </div>
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
                <Composition kinds={note.kinds} />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Ce que contient la note, d'un coup d'œil. */
function Composition({ kinds }: { kinds: string[] }) {
  const entries = [
    { n: kinds.filter((k) => k === "text").length, icon: Type, label: "blocs de texte" },
    { n: kinds.filter((k) => k === "table").length, icon: Table2, label: "tableaux" },
    { n: kinds.filter((k) => k === "drawing").length, icon: PenLine, label: "pages manuscrites" },
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

function Breadcrumb({ trail }: { trail: { id: string; name: string }[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="-mt-1">
      <ol className="flex flex-wrap items-center gap-1 m3-body-medium text-on-surface-variant">
        {/* Déposer ici sort la note de tout dossier. */}
        <DropZone folderId={null}>
          <Link
            href="/notes"
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 transition-colors hover:text-on-surface"
          >
            <Home className="size-4" />
            Notes
          </Link>
        </DropZone>
        {trail.map((folder, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={folder.id} className="flex items-center">
              <ChevronRight className="size-4 shrink-0 opacity-50" />
              {last ? (
                <span className="px-2 font-medium text-on-surface">{folder.name}</span>
              ) : (
                <Link
                  href={`/notes?folder=${folder.id}`}
                  className="flex min-h-11 items-center rounded-lg px-2 transition-colors hover:text-on-surface"
                >
                  {folder.name}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
