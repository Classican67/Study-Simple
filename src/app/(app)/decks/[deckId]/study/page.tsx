import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PartyPopper } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth";
import { getDeckCards, getDeckForUser } from "@/lib/decks";
import { isDue } from "@/lib/scheduling";
import { orderCards } from "@/lib/study-order";
import { readStudyOrder } from "@/lib/study-order-server";
import { StudyClient } from "./study-client";
import { WriteClient } from "./write-client";
import { ModeSwitch } from "./mode-switch";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Révision" };

export default async function StudyPage(props: PageProps<"/decks/[deckId]/study">) {
  const { deckId } = await props.params;
  const { all, mode } = await props.searchParams;
  const user = await requireUser();

  const deck = await getDeckForUser(deckId, user.id);
  if (!deck) notFound();

  const cards = await getDeckCards(deckId, user.id);
  const reviewAll = all === "1";
  const order = await readStudyOrder();
  const writeMode = mode === "write";
  // Par défaut on ne repasse que ce qui n'est pas encore acquis ; `?all=1`
  // rejoue le paquet entier.
    // Par défaut on ne présente que ce qui est arrivé à échéance ; `?all=1`
  // rejoue tout, quelle que soit la planification.
  const pool = reviewAll ? cards : cards.filter((card) => isDue(card.dueAt));

  if (cards.length === 0) notFound();

  if (pool.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          icon={<PartyPopper className="size-5" />}
          title="Rien à réviser pour l'instant"
          description="Toutes les cartes de ce paquet sont planifiées pour plus tard. Tu peux quand même le repasser en entier dès maintenant."
          action={
            <div className="flex flex-col gap-2 sm:flex-row">
              <Button asChild variant="secondary">
                <Link href={`/decks/${deckId}`}>Retour au paquet</Link>
              </Button>
              <Button asChild>
                <Link href={`/decks/${deckId}/study?all=1`}>Tout revoir</Link>
              </Button>
            </div>
          }
        />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        href={`/decks/${deckId}`}
        className="-ml-2 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-fg-muted transition-colors hover:text-fg"
      >
        <ArrowLeft className="size-4" />
        {deck.title}
      </Link>

      <ModeSwitch base={`/decks/${deckId}/study`} all={reviewAll} write={writeMode} />

      {writeMode ? (
        <WriteClient
          deckId={deckId}
          title={deck.title}
          backHref={`/decks/${deckId}`}
          cardsHref={`/decks/${deckId}/study${reviewAll ? "?all=1" : ""}`}
          cards={orderCards(pool, order)}
          deckOrder={pool.map((card) => card.id)}
          order={order}
        />
      ) : (
        <StudyClient
          deckId={deckId}
          title={deck.title}
          backHref={`/decks/${deckId}`}
          replayHref={`/decks/${deckId}/study?all=1`}
          cards={orderCards(pool, order)}
          deckOrder={pool.map((card) => card.id)}
          order={order}
        />
      )}
    </div>
  );
}
