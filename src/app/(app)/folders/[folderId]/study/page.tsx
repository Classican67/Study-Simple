import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PartyPopper } from "lucide-react";

import { Button } from "@/components/ui/button";
import { FullscreenToggle } from "@/components/fullscreen-toggle";
import { EmptyState } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth";
import { getFolderCards, getFolderForUser } from "@/lib/folders";
import { isDue } from "@/lib/scheduling";
import { orderCards } from "@/lib/study-order";
import { readStudyOrder } from "@/lib/study-order-server";
import { readStudySide } from "@/lib/study-side-server";
import { StudyClient } from "../../../decks/[deckId]/study/study-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Révision du dossier" };

/**
 * Révision d'un dossier entier : toutes les cartes de tous ses paquets,
 * sous-dossiers compris, mélangées ensemble.
 *
 * C'est le mode « aléatoire » à l'échelle d'une matière : les cartes ne
 * reviennent plus dans l'ordre d'un paquet, ce qui empêche de reconnaître une
 * réponse à sa seule position.
 */
export default async function FolderStudyPage(
  props: PageProps<"/folders/[folderId]/study">,
) {
  const { folderId } = await props.params;
  const { all } = await props.searchParams;
  const user = await requireUser();

  const folder = await getFolderForUser(folderId, user.id);
  if (!folder) notFound();

  const cards = await getFolderCards(user.id, folderId);
  if (cards.length === 0) notFound();

  const reviewAll = all === "1";
  const order = await readStudyOrder();
  const side = await readStudySide();
    // Par défaut on ne présente que ce qui est arrivé à échéance ; `?all=1`
  // rejoue tout, quelle que soit la planification.
  const pool = reviewAll ? cards : cards.filter((card) => isDue(card.dueAt));

  const backHref = `/folders/${folderId}`;

  if (pool.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          icon={<PartyPopper className="size-6" />}
          title="Rien à réviser pour l'instant"
          description={`Toutes les cartes de « ${folder.name} » sont planifiées pour plus tard. Tu peux quand même tout repasser dès maintenant.`}
          action={
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <Button asChild variant="outlined">
                <Link href={backHref}>Retour au dossier</Link>
              </Button>
              <Button asChild>
                <Link href={`${backHref}/study?all=1`}>Tout revoir</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <Link
          href={backHref}
          className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-full px-3 m3-label-large text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <ArrowLeft className="size-4" />
          {folder.name}
        </Link>
        <FullscreenToggle />
      </div>

      <StudyClient
        // Pas de paquet unique : la session n'est pas rattachée à l'un d'eux,
        // seule la progression par carte est enregistrée.
        deckId={null}
        title={folder.name}
        backHref={backHref}
        replayHref={`${backHref}/study?all=1`}
        cards={orderCards(pool, order)}
        deckOrder={pool.map((card) => card.id)}
        order={order}
        side={side}
      />
    </div>
  );
}
