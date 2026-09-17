"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { CircleArrowDown, CircleCheck, CloudOff, LoaderCircle } from "lucide-react";

import type { MenuAction } from "@/components/context-menu";
import { epingler, retirer } from "@/lib/hors-ligne/client";
import { disponibilite, type GenreEpingle } from "@/lib/hors-ligne/modele";
import { cn } from "@/lib/utils";
import { useHorsLigne, useHorsLignePossible } from "./use-hors-ligne";

/**
 * « Garder hors ligne » — sur un paquet ou un dossier.
 *
 * Une puce de filtre Material 3, placée sous le titre de ce qu'elle garde :
 * c'est l'état de **cet** élément sur **cet** appareil, pas une action de plus
 * parmi « Importer » et « Réviser ».
 *
 * Quatre états, et chacun dit ce qu'on peut en faire :
 *
 * - rien sur l'appareil → la toucher le garde ;
 * - en route (ou en attente du réseau) → c'est dit, et on peut encore annuler ;
 * - disponible → la toucher le retire, et libère la place tout de suite ;
 * - gardé **par un dossier parent** → ce n'est pas ici qu'on le retire : la
 *   puce mène au dossier qui le garde, au lieu d'un bouton grisé muet.
 */
export function BoutonHorsLigne({
  genre,
  id,
  folderId,
  nom,
  className,
}: {
  genre: GenreEpingle;
  id: string;
  /** Pour un paquet : son dossier, d'où peut venir un héritage. */
  folderId?: string | null;
  nom: string;
  className?: string;
}) {
  const etat = useHorsLigne();
  const possible = useHorsLignePossible();

  if (!possible) return null;

  const cles = new Set(etat.epingles.keys());
  const dispo = disponibilite(genre, id, { epingles: cles, dossiers: etat.dossiers, folderId });

  const base = cn(
    "state-layer inline-flex min-h-11 items-center gap-2 rounded-lg px-3 m3-label-large transition-colors",
    "[&_svg]:size-4.5 [&_svg]:shrink-0",
    className,
  );

  if (dispo.etat === "herite") {
    return (
      <Link
        href={dispo.via.kind === "note" ? `/notes?folder=${dispo.via.id}` : `/folders/${dispo.via.id}`}
        className={cn(base, "bg-secondary-container text-on-secondary-container")}
        title={`Gardé avec le dossier « ${dispo.via.name} ». C'est là qu'on le retire.`}
        data-testid="hors-ligne"
        data-etat="herite"
      >
        <CircleCheck aria-hidden />
        <span>
          Hors ligne avec « <span className="font-semibold">{dispo.via.name}</span> »
        </span>
      </Link>
    );
  }

  const epingle = etat.epingles.get(`${genre}:${id}`);
  const enAttente = dispo.etat === "epingle" && epingle?.resolueLe === null;
  const sansReseau = enAttente && (etat.synchro === "hors-ligne" || etat.synchro === "session");
  const telecharge = dispo.etat === "epingle" && !enAttente;

  const libelle = !etat.charge
    ? "Garder hors ligne"
    : dispo.etat === "absent"
      ? "Garder hors ligne"
      : sansReseau
        ? "En attente du réseau"
        : enAttente || (etat.fichiers && etat.synchro === "encours")
          ? "Téléchargement…"
          : "Disponible hors ligne";

  const Icone = !etat.charge || dispo.etat === "absent"
    ? CircleArrowDown
    : sansReseau
      ? CloudOff
      : enAttente
        ? LoaderCircle
        : CircleCheck;

  return (
    <button
      type="button"
      disabled={!etat.charge}
      aria-pressed={dispo.etat === "epingle"}
      aria-label={
        dispo.etat === "epingle"
          ? `${libelle} — retirer « ${nom} » de l'appareil`
          : `Garder « ${nom} » hors ligne`
      }
      onClick={() => void (dispo.etat === "epingle" ? retirer(genre, id) : epingler(genre, id))}
      className={cn(
        base,
        dispo.etat === "epingle"
          ? "bg-secondary-container text-on-secondary-container"
          : "border border-outline-variant text-on-surface-variant hover:text-on-surface",
        "disabled:opacity-60",
      )}
      data-testid="hors-ligne"
      data-etat={!etat.charge ? "lecture" : telecharge ? "disponible" : enAttente ? "attente" : "absent"}
    >
      <Icone aria-hidden className={cn(Icone === LoaderCircle && "animate-spin")} />
      <span aria-live="polite">{libelle}</span>
    </button>
  );
}

/**
 * Pastille discrète, dans la grille : ce paquet ou ce dossier est lisible sans
 * réseau. Rien quand il ne l'est pas — l'absence est l'état normal.
 */
export function PastilleHorsLigne({
  genre,
  id,
  folderId,
  className,
}: {
  genre: GenreEpingle;
  id: string;
  folderId?: string | null;
  className?: string;
}) {
  const etat = useHorsLigne();
  if (!etat.charge) return null;

  const dispo = disponibilite(genre, id, { epingles: new Set(etat.epingles.keys()), dossiers: etat.dossiers, folderId });
  // Seulement une fois tout descendu : la pastille promet qu'on peut partir.
  const epingle =
    dispo.etat === "epingle"
      ? etat.epingles.get(`${genre}:${id}`)
      : dispo.etat === "herite"
        ? etat.epingles.get(`dossier:${dispo.via.id}`)
        : undefined;
  const stocke = genre === "paquet" ? etat.paquets.has(id) : genre === "note" ? etat.notes.has(id) : true;
  const present = Boolean(epingle && epingle.resolueLe !== null && stocke);
  if (!present) return null;

  return (
    <span
      role="img"
      aria-label="Disponible hors ligne"
      title="Disponible hors ligne"
      className={cn("inline-grid shrink-0 place-items-center text-primary", className)}
      data-testid="pastille-hors-ligne"
    >
      <CircleCheck className="size-4" aria-hidden />
    </span>
  );
}

/**
 * L'option « Garder hors ligne » d'un menu contextuel — clic droit, appui long
 * ou bouton ⋮. Même logique que la puce, dite en un libellé : c'est depuis la
 * liste qu'on choisit ce qu'on emporte, sans ouvrir chaque note.
 *
 * Rend `null` là où la fonction n'existe pas (pas de service worker).
 */
export function useActionHorsLigne({
  genre,
  id,
  folderId,
}: {
  genre: GenreEpingle;
  id: string;
  folderId?: string | null;
}): MenuAction | null {
  const etat = useHorsLigne();
  const possible = useHorsLignePossible();
  const router = useRouter();
  if (!possible || !etat.charge) return null;

  const dispo = disponibilite(genre, id, { epingles: new Set(etat.epingles.keys()), dossiers: etat.dossiers, folderId });
  if (dispo.etat === "herite") {
    return {
      label: `Hors ligne avec « ${dispo.via.name} »`,
      icon: CircleCheck,
      // Mène au dossier qui garde l'élément : c'est là qu'on le retire.
      onSelect: () =>
        router.push(dispo.via.kind === "note" ? `/notes?folder=${dispo.via.id}` : `/folders/${dispo.via.id}`),
    };
  }
  return dispo.etat === "epingle"
    ? { label: "Retirer de l'appareil", icon: CircleCheck, onSelect: () => void retirer(genre, id) }
    : { label: "Garder hors ligne", icon: CircleArrowDown, onSelect: () => void epingler(genre, id) };
}
