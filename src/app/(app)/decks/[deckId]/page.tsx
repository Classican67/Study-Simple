import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GraduationCap, Layers } from "lucide-react";

import { Badge, ProgressBar } from "@/components/ui/panel";
import { Button, Fab } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { requireUser } from "@/lib/auth";
import { deckColor, getDeckCards, getDeckForUser } from "@/lib/decks";
import { listFolderOptions } from "@/lib/folders";
import { describeDue, isDue } from "@/lib/scheduling";
import { CardEditor } from "./card-editor";
import { DeckSettings } from "./deck-toolbar";
import { ImportDialog } from "./import-dialog";
import { SearchDialog } from "@/components/search-dialog";

export const dynamic = "force-dynamic";

export async function generateMetadata(
  props: PageProps<"/decks/[deckId]">,
): Promise<Metadata> {
  const { deckId } = await props.params;
  const user = await requireUser();
  const deck = await getDeckForUser(deckId, user.id);
  return { title: deck?.title ?? "Paquet" };
}

export default async function DeckPage(props: PageProps<"/decks/[deckId]">) {
  const { deckId } = await props.params;
  const user = await requireUser();

  const deck = await getDeckForUser(deckId, user.id);
  // Paquet inexistant et paquet d'un autre compte donnent la même réponse.
  if (!deck) notFound();

  const cards = await getDeckCards(deckId, user.id);
  const folderOptions = await listFolderOptions(user.id);
  const known = cards.filter((card) => card.status === "known").length;
  const due = cards.filter((card) => isDue(card.dueAt)).length;
  const progress = cards.length === 0 ? 0 : (known / cards.length) * 100;

  // Prochaine échéance parmi les cartes qui ne sont pas déjà dues : c'est elle
  // qui répond à « quand dois-je revenir ? ».
  const upcoming = cards
    .map((card) => card.dueAt)
    .filter((date): date is Date => date !== null && !isDue(date))
    .sort((a, b) => a.getTime() - b.getTime())[0];

  return (
    // Marge basse quand le bouton flottant est là : sans elle il se pose sur
    // « Ajouter une carte », qui est précisément le dernier élément de la liste.
    <div className={cn("space-y-8", cards.length > 0 && "pb-20 md:pb-24")}>
      <div>
        {/* Remonte d'un cran dans la hiérarchie, et non à la racine : un
            paquet rangé dans un dossier renvoyait jusqu'ici vers « tous les
            paquets », ce qui perdait le chemin parcouru. La destination vient
            du paquet lui-même, pas de l'historique de navigation : elle est
            donc juste même en arrivant par un lien direct ou un signet. */}
        <Link
          href={deck.folder ? `/folders/${deck.folder.id}` : "/"}
          className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 m3-body-medium text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <ArrowLeft className="size-4" />
          {deck.folder ? deck.folder.name : "Tous les paquets"}
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-2xl text-white elevation-1"
              style={{ backgroundColor: deckColor(deck.color) }}
            >
              <Layers className="size-5.5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-pretty m3-headline-medium">
                {deck.title}
              </h1>
              {deck.description ? (
                <p className="mt-1.5 text-sm leading-relaxed text-on-surface-variant">{deck.description}</p>
              ) : null}
            </div>
          </div>

          <SearchDialog deckId={deck.id} deckTitle={deck.title} />
          <DeckSettings
            deck={deck}
            hasProgress={known > 0 || cards.some((c) => c.status === "learning")}
            folderOptions={folderOptions}
          />
        </div>
      </div>

      <div className="rounded-xl border border-outline-variant bg-surface-container p-5 elevation-1 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={due > 0 ? "accent" : "neutral"}>
              {due > 0 ? `${due} à réviser` : "Rien à réviser"}
            </Badge>
            <Badge tone="success">
              {known} sue{known > 1 ? "s" : ""} sur {cards.length}
            </Badge>
            {due === 0 && upcoming ? (
              <Badge>Prochaine {describeDue(upcoming)}</Badge>
            ) : null}
          </div>

          {/* Trois actions ne tiennent pas sur une ligne de téléphone : la
              rangée passe à la ligne plutôt que de les comprimer sous la
              taille tactile. */}
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
            {cards.length > 0 ? (
              <Button asChild size="lg" className="flex-1 sm:flex-none">
                <Link href={`/decks/${deck.id}/study`}>
                  <GraduationCap />
                  {due > 0 ? `Réviser (${due})` : "Réviser"}
                </Link>
              </Button>
            ) : null}
            <ImportDialog deckId={deck.id} />
          </div>
        </div>
        <ProgressBar value={progress} className="mt-5" />
      </div>

      <CardEditor
        deckId={deck.id}
        initialCards={cards.map((card) => ({
          id: card.id,
          term: card.term,
          definition: card.definition,
          imagePath: card.imagePath,
        }))}
      />

      {/* Raccourci de révision, toujours à portée.
          Le bouton du haut disparaît dès qu'on descend dans la liste, et un
          paquet fourni fait plusieurs écrans de haut.
          `bottom` dégage la barre de navigation, haute de 6 rem et masquée à
          partir de `md` — sans quoi le bouton se poserait dessus. */}
      {cards.length > 0 ? (
        <Fab
          asChild
          extended
          aria-label={due > 0 ? `Réviser ${due} cartes` : "Réviser le paquet"}
          className="fixed right-4 z-30 bottom-[calc(env(safe-area-inset-bottom)+7rem)] sm:right-6 md:bottom-[calc(env(safe-area-inset-bottom)+1.5rem)]"
        >
          <Link href={`/decks/${deck.id}/study`}>
            <GraduationCap />
            {due > 0 ? `Réviser (${due})` : "Réviser"}
          </Link>
        </Fab>
      ) : null}
    </div>
  );
}
