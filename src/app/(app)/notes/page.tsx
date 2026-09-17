import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleCheck, Folder as FolderIcon, NotebookPen, PenLine, Table2, Type } from "lucide-react";

import { EmptyState } from "@/components/ui/panel";
import { DropZone } from "@/components/drag-move";
import { DepotDocument } from "./depot-document";
import { NewNoteButton } from "./new-note-button";
import { NewNoteFolderButton } from "./new-note-folder-button";
import { NoteSearch } from "./note-search";
import { NoteViewOptions } from "./note-view-options";
import { FolderMenu, NoteMenu, NotesMenusProvider } from "./notes-menus";
import { NotesTrail } from "./notes-trail";
import { NoteThumbnail } from "@/components/note/note-thumbnail";
import { BoutonHorsLigne, PastilleHorsLigne } from "@/components/hors-ligne/bouton-hors-ligne";
import { requireUser } from "@/lib/auth";
import { deckColor } from "@/lib/deck-colors";
import { getNotesView, isNoteSort, type NoteFilters } from "@/lib/note-queries";
import { isNoteView, type NoteView } from "@/lib/note-views";
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
  const vue: NoteView = isNoteView(params.vue) ? params.vue : "large";
  const tri = isNoteSort(params.tri) ? params.tri : "updated";

  const view = await getNotesView(user.id, folderId, { query, has, sort: tri });
  // Dossier inexistant et dossier d'un autre compte donnent la même réponse.
  if (!view) notFound();

  const cherche = query.trim().length > 0 || Boolean(has);
  const href = (extra: Record<string, string | null>) => {
    const url = new URLSearchParams();
    const base = {
      folder: folderId,
      q: query || null,
      has: has ?? null,
      vue: vue === "large" ? null : vue,
      tri: tri === "updated" ? null : tri,
      ...extra,
    };
    for (const [k, v] of Object.entries(base)) if (v) url.set(k, v);
    const qs = url.toString();
    return qs ? `/notes?${qs}` : "/notes";
  };
  // Changer de dossier garde l'affichage et le tri, pas la recherche.
  const dossier = (id: string | null) => href({ folder: id, q: null, has: null });

  return (
    /*
     * Toute la liste reçoit les documents qu'on y dépose.
     *
     * Un PDF tiré depuis Fichiers devient une note, rangée dans le dossier
     * ouvert. C'est le seul chemin d'import « natif » qui existe sur iPad :
     * Safari ne sait pas faire d'une application web la destination d'une
     * feuille de partage. Cf. `DepotDocument`.
     */
    <DepotDocument folderId={folderId} nomDossier={view.current?.name}>
    <NotesMenusProvider tree={view.tree}>
    <div className="space-y-6">
      {view.breadcrumb.length > 0 ? <NotesTrail trail={view.breadcrumb} href={dossier} /> : null}

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
            {view.current ? (
              <BoutonHorsLigne genre="dossier" id={view.current.id} nom={view.current.name} className="mt-3" />
            ) : null}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Les dossiers se créent aussi d'ici : ranger ses notes par thème
              ne doit pas obliger à passer par la section Paquets. */}
          <NewNoteFolderButton parentId={folderId} />
          {view.total > 0 ? <NewNoteButton folderId={folderId} /> : null}
        </div>
      </header>

      {view.total > 0 ? (
        <div className="space-y-3">
          <NoteSearch query={query} has={has ?? null} folderId={folderId} />
          <NoteViewOptions view={vue} sort={tri} />
        </div>
      ) : null}

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
              <DropZone key={folder.id} folderId={folder.id} className="relative">
                {/* Clic droit, appui long ou bouton ⋮ : les options du dossier
                    sans avoir à l'ouvrir. */}
                <FolderMenu
                  folder={{ id: folder.id, name: folder.name, color: folder.color, parentId: folderId }}
                  href={dossier(folder.id)}
                >
                  <Link
                    href={dossier(folder.id)}
                    className="state-layer flex min-h-14 items-center gap-3 rounded-xl border border-outline-variant bg-surface-container pl-4 pr-14 transition-all hover:-translate-y-0.5 hover:elevation-2"
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
                    <PastilleHorsLigne genre="dossier" id={folder.id} />
                    <span className="m3-label-small tabular-nums text-on-surface-variant">
                      {folder.noteCount}
                    </span>
                  </Link>
                </FolderMenu>
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
        <ul
          className={
            vue === "list"
              ? "space-y-2"
              : vue === "small"
                ? "grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5"
                : "grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
          }
        >
          {view.notes.map((note) => (
            <li key={note.id} className="relative">
              <NoteMenu
                note={{ id: note.id, title: note.title, folderId: note.folderId, mastered: note.mastered }}
              >
                {vue === "list" ? (
                  <Link
                    href={`/notes/${note.id}`}
                    className="state-layer flex items-center gap-4 rounded-xl border border-outline-variant bg-surface-container p-3 pr-28 transition-all hover:elevation-2"
                  >
                    <NoteThumbnail
                      preview={note.preview}
                      className="h-14 w-11 shrink-0 rounded-lg border border-outline-variant"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate m3-title-small text-on-surface">
                        {note.title.trim() || UNTITLED}
                      </span>
                      <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 m3-body-small text-on-surface-variant">
                        Modifiée {describeAgo(note.updatedAt)}
                        <PastilleHorsLigne genre="note" id={note.id} />
                        {note.mastered ? <Maitrisee /> : null}
                      </span>
                    </span>
                    <Composition kinds={note.kinds} />
                  </Link>
                ) : (
                  <Link
                    href={`/notes/${note.id}`}
                    className="state-layer flex h-full flex-col overflow-hidden rounded-xl border border-outline-variant bg-surface-container elevation-1 transition-all hover:-translate-y-0.5 hover:elevation-2"
                  >
                    {/* La vignette d'abord, et grande : deux notes de cours se
                        ressemblent jusqu'à ce qu'on voie leur première page. */}
                    <NoteThumbnail
                      preview={note.preview}
                      className={
                        vue === "small"
                          ? "aspect-[3/4] w-full border-b border-outline-variant"
                          : "aspect-[4/3] w-full border-b border-outline-variant"
                      }
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1 p-4">
                      <span className="block truncate m3-title-small text-on-surface">
                        {note.title.trim() || UNTITLED}
                      </span>
                      <span className="flex items-center gap-1.5 m3-body-small text-on-surface-variant">
                        Modifiée {describeAgo(note.updatedAt)}
                        <PastilleHorsLigne genre="note" id={note.id} />
                      </span>
                      {note.mastered ? <Maitrisee /> : null}
                      <Composition kinds={note.kinds} />
                    </span>
                  </Link>
                )}
              </NoteMenu>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
    </NotesMenusProvider>
    </DepotDocument>
  );
}

/** La pastille d'une note que la personne a marquée comme maîtrisée. */
function Maitrisee() {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-success-container py-0.5 pl-1.5 pr-2 m3-label-small text-on-success-container">
      <CircleCheck aria-hidden className="size-3.5" />
      Maîtrisée
    </span>
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
