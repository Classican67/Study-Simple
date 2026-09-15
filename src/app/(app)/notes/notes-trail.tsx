import Link from "next/link";
import { ArrowLeft, ChevronRight, Home } from "lucide-react";

import { DropZone } from "@/components/drag-move";

/**
 * Où l'on est dans les notes, et comment en remonter.
 *
 * La page d'une note renvoyait toujours à la racine, quel que soit le dossier
 * d'où l'on venait : ouvrir une note rangée trois niveaux plus bas, puis
 * revenir, obligeait à redescendre. Et dans un dossier, rien ne désignait le
 * parent — seulement un fil d'Ariane en petit texte.
 *
 * La flèche remonte donc d'**un** niveau : au dossier de la note, ou au parent
 * du dossier ouvert. Le fil montre le chemin entier, et chaque maillon est une
 * cible où déposer une note glissée.
 */
export function NotesTrail({
  trail,
  inNote = false,
  href = (folderId) => (folderId ? `/notes?folder=${folderId}` : "/notes"),
}: {
  /** Dossiers de la racine jusqu'au dossier courant, ou celui de la note. */
  trail: { id: string; name: string }[];
  /** Sur la page d'une note : le dernier dossier est un lien, pas la page courante. */
  inNote?: boolean;
  /** Adresse d'un dossier. La liste y garde son affichage et son tri. */
  href?: (folderId: string | null) => string;
}) {
  const parent = inNote ? trail.at(-1) : trail.at(-2);
  const nomParent = parent?.name ?? "Notes";

  return (
    <nav aria-label="Fil d'Ariane" className="-ml-2 flex min-w-0 items-center gap-1">
      <Link
        href={href(parent?.id ?? null)}
        aria-label={`Revenir à « ${nomParent} »`}
        title={`Revenir à « ${nomParent} »`}
        className="state-layer grid size-12 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <ArrowLeft className="size-5" />
      </Link>

      <ol className="flex min-w-0 flex-wrap items-center gap-x-0.5 m3-body-medium text-on-surface-variant">
        {/* Déposer ici sort la note de tout dossier. */}
        <DropZone folderId={null} className="!rounded-lg">
          <Link
            href={href(null)}
            className="flex min-h-12 items-center gap-1.5 rounded-lg px-2 transition-colors hover:text-on-surface"
          >
            <Home className="size-4" />
            Notes
          </Link>
        </DropZone>
        {trail.map((folder, index) => {
          const courant = !inNote && index === trail.length - 1;
          return (
            <li key={folder.id} className="flex min-w-0 items-center">
              <ChevronRight aria-hidden className="size-4 shrink-0 opacity-60" />
              {courant ? (
                // Le dossier ouvert : un lien vers soi-même n'apporte rien et
                // brouille la navigation au clavier.
                <span aria-current="page" className="max-w-56 truncate px-2 font-medium text-on-surface">
                  {folder.name}
                </span>
              ) : (
                <DropZone as="div" folderId={folder.id} className="min-w-0 !rounded-lg">
                  <Link
                    href={href(folder.id)}
                    className="flex min-h-12 max-w-56 items-center rounded-lg px-2 transition-colors hover:text-on-surface"
                  >
                    <span className="truncate">{folder.name}</span>
                  </Link>
                </DropZone>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
