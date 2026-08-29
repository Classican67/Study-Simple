import Link from "next/link";
import { ArrowRight, ChevronRight, Folder as FolderIcon, Home, Layers, Sparkles } from "lucide-react";

import { Badge, EmptyState, ProgressBar } from "@/components/ui/panel";
import { deckColor } from "@/lib/decks";
import type { FolderOption, FolderView } from "@/lib/folders";
import { NewDeckButton } from "./new-deck-button";
import { NewFolderButton } from "./new-folder-button";
import { FolderSettings } from "./folder-settings";

// Vue commune à la racine et à un dossier : la seule différence est le
// contenu passé en paramètre, donc les deux pages partagent tout ce fichier.
export function FolderBrowser({
  view,
  folderOptions,
}: {
  view: FolderView;
  folderOptions: FolderOption[];
}) {
  const { current, breadcrumb, folders, decks } = view;
  const totalCards = decks.reduce((sum, deck) => sum + deck.cardCount, 0);
  const totalKnown = decks.reduce((sum, deck) => sum + deck.knownCount, 0);
  const empty = folders.length === 0 && decks.length === 0;

  return (
    <div className="space-y-8">
      {breadcrumb.length > 0 ? <Breadcrumb trail={breadcrumb} /> : null}

      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 items-start gap-3">
          {current ? (
            <span
              className="mt-1 grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-soft"
              style={{ backgroundColor: deckColor(current.color) }}
            >
              <FolderIcon className="size-5" />
            </span>
          ) : null}
          <div className="min-w-0">
            <h1 className="text-pretty text-3xl font-semibold tracking-tight sm:text-4xl">
              {current ? current.name : "Mes paquets"}
            </h1>
            <p className="mt-2 text-sm text-fg-muted">
              {describe(folders.length, decks.length, totalKnown, totalCards)}
            </p>
          </div>
        </div>

        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap sm:gap-3">
          {current ? (
            <FolderSettings
              folder={current}
              options={folderOptions.filter((o) => o.id !== current.id)}
            />
          ) : null}
          {!empty ? (
            <>
              <NewFolderButton parentId={current?.id ?? null} className="flex-1 sm:flex-none" />
              <NewDeckButton folderId={current?.id ?? null} className="flex-1 sm:flex-none" />
            </>
          ) : null}
        </div>
      </header>

      {empty ? (
        <EmptyState
          icon={<Sparkles className="size-6" />}
          title={current ? "Ce dossier est vide" : "Commence par créer un paquet"}
          description="Un paquet par cours ou par chapitre. Les dossiers servent à les regrouper par matière ou par session."
          action={
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <NewDeckButton folderId={current?.id ?? null} />
              <NewFolderButton parentId={current?.id ?? null} />
            </div>
          }
        />
      ) : (
        <div className="space-y-8">
          {folders.length > 0 ? (
            <section className="space-y-3">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">
                Dossiers
              </h2>
              <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {folders.map((folder) => (
                  <li key={folder.id}>
                    <Link
                      href={`/folders/${folder.id}`}
                      className="group flex items-center gap-3 rounded-card border border-border bg-surface p-4 shadow-soft transition-all hover:-translate-y-0.5 hover:border-border-strong hover:shadow-lift"
                    >
                      <span
                        className="grid size-10 shrink-0 place-items-center rounded-xl text-white shadow-soft"
                        style={{ backgroundColor: deckColor(folder.color) }}
                      >
                        <FolderIcon className="size-4.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-display font-semibold">
                          {folder.name}
                        </span>
                        <span className="block text-xs text-fg-subtle">
                          {summarise(folder.deckCount, folder.childCount)}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          {decks.length > 0 ? (
            <section className="space-y-3">
              {folders.length > 0 ? (
                <h2 className="text-sm font-semibold uppercase tracking-wide text-fg-subtle">
                  Paquets
                </h2>
              ) : null}
              <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {decks.map((deck) => {
                  const progress =
                    deck.cardCount === 0 ? 0 : (deck.knownCount / deck.cardCount) * 100;
                  const color = deckColor(deck.color);
                  const remaining = deck.cardCount - deck.knownCount;

                  return (
                    <li key={deck.id}>
                      <Link
                        href={`/decks/${deck.id}`}
                        className="group relative flex h-full flex-col overflow-hidden rounded-card border border-border bg-surface shadow-soft transition-all duration-200 hover:-translate-y-1 hover:border-border-strong hover:shadow-lift sm:min-h-52"
                      >
                        {/* Lavis de la couleur du paquet : identifie le cours d'un
                            coup d'œil sans coloriser toute la carte. */}
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-x-0 top-0 h-28 opacity-[0.13] transition-opacity group-hover:opacity-20"
                          style={{ background: `linear-gradient(to bottom, ${color}, transparent)` }}
                        />

                        <div className="relative flex flex-1 flex-col p-5">
                          <div className="mb-4 flex items-start justify-between gap-3">
                            <span
                              className="grid size-11 shrink-0 place-items-center rounded-2xl text-white shadow-soft"
                              style={{ backgroundColor: color }}
                            >
                              <Layers className="size-5" />
                            </span>
                            <Badge
                              tone={remaining === 0 && deck.cardCount > 0 ? "success" : "neutral"}
                            >
                              {remaining === 0 && deck.cardCount > 0
                                ? "Tout su"
                                : `${remaining} à revoir`}
                            </Badge>
                          </div>

                          <h3 className="text-pretty font-display text-lg font-semibold leading-snug">
                            {deck.title}
                          </h3>
                          {deck.description ? (
                            <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-fg-muted">
                              {deck.description}
                            </p>
                          ) : null}

                          <div className="mt-auto pt-5">
                            <div className="mb-2 flex items-center justify-between text-xs text-fg-subtle">
                              <span className="tabular-nums">
                                {deck.knownCount}/{deck.cardCount} carte
                                {deck.cardCount > 1 ? "s" : ""}
                              </span>
                              <span className="flex items-center gap-1 font-medium text-fg-muted opacity-0 transition-opacity group-hover:opacity-100">
                                Ouvrir
                                <ArrowRight className="size-3.5" />
                              </span>
                            </div>
                            <ProgressBar value={progress} tint={color} />
                          </div>
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Breadcrumb({ trail }: { trail: { id: string; name: string }[] }) {
  return (
    <nav aria-label="Fil d'Ariane" className="-mt-1">
      <ol className="flex flex-wrap items-center gap-1 text-sm text-fg-muted">
        <li>
          <Link
            href="/"
            className="flex min-h-11 items-center gap-1.5 rounded-lg px-2 transition-colors hover:text-fg"
          >
            <Home className="size-3.5" />
            Accueil
          </Link>
        </li>
        {trail.map((folder, index) => {
          const last = index === trail.length - 1;
          return (
            <li key={folder.id} className="flex items-center">
              <ChevronRight className="size-3.5 shrink-0 text-fg-subtle" />
              {last ? (
                // Le dernier maillon est la page courante : un lien vers
                // soi-même n'apporte rien et brouille la navigation clavier.
                <span aria-current="page" className="px-2 font-medium text-fg">
                  {folder.name}
                </span>
              ) : (
                <Link
                  href={`/folders/${folder.id}`}
                  className="flex min-h-11 items-center rounded-lg px-2 transition-colors hover:text-fg"
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

function summarise(deckCount: number, childCount: number): string {
  const parts: string[] = [];
  if (deckCount > 0) parts.push(`${deckCount} paquet${deckCount > 1 ? "s" : ""}`);
  if (childCount > 0) parts.push(`${childCount} dossier${childCount > 1 ? "s" : ""}`);
  return parts.length > 0 ? parts.join(" · ") : "Vide";
}

function describe(
  folderCount: number,
  deckCount: number,
  known: number,
  total: number,
): string {
  if (folderCount === 0 && deckCount === 0) return "Rien ici pour l'instant.";
  if (total === 0) {
    return deckCount > 0
      ? `${deckCount} paquet${deckCount > 1 ? "s" : ""}, aucune carte.`
      : `${folderCount} dossier${folderCount > 1 ? "s" : ""}.`;
  }
  return `${known} sur ${total} carte${total > 1 ? "s" : ""} acquise${known > 1 ? "s" : ""}.`;
}
