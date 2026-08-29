import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, PartyPopper } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth";
import { getDeckCards, getDeckForUser } from "@/lib/decks";
import { StudyClient } from "./study-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Révision" };

// Mélange de Fisher-Yates : l'ordre de saisie ne doit pas devenir un indice
// de rappel, sinon on apprend la séquence plutôt que le contenu.
function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export default async function StudyPage(props: PageProps<"/decks/[deckId]/study">) {
  const { deckId } = await props.params;
  const { all } = await props.searchParams;
  const user = await requireUser();

  const deck = await getDeckForUser(deckId, user.id);
  if (!deck) notFound();

  const cards = await getDeckCards(deckId, user.id);
  const reviewAll = all === "1";
  // Par défaut on ne repasse que ce qui n'est pas encore acquis ; `?all=1`
  // rejoue le paquet entier.
  const pool = reviewAll ? cards : cards.filter((card) => card.status !== "known");

  if (cards.length === 0) notFound();

  if (pool.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          icon={<PartyPopper className="size-5" />}
          title="Tout est su"
          description="Aucune carte de ce paquet n'est en attente de révision. Tu peux quand même le repasser en entier."
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

      <StudyClient deckId={deckId} deckTitle={deck.title} cards={shuffle(pool)} />
    </div>
  );
}
