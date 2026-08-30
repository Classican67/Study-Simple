import type { Metadata } from "next";
import Link from "next/link";
import { PartyPopper } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth";
import { getDueCards } from "@/lib/decks";
import { orderCards } from "@/lib/study-order";
import { readStudyOrder } from "@/lib/study-order-server";
import { StudyClient } from "../decks/[deckId]/study/study-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "À réviser aujourd'hui" };

/**
 * Révision de tout ce qui est arrivé à échéance, quel que soit le paquet.
 *
 * C'est l'entrée quotidienne de l'app : elle répond à « qu'est-ce que je dois
 * revoir maintenant ? » sans avoir à parcourir les dossiers.
 */
export default async function TodayPage() {
  const user = await requireUser();
  const cards = await getDueCards(user.id);
  const order = await readStudyOrder();

  if (cards.length === 0) {
    return (
      <div className="mx-auto max-w-md">
        <EmptyState
          icon={<PartyPopper className="size-6" />}
          title="Rien à réviser aujourd'hui"
          description="Toutes tes cartes sont planifiées pour plus tard. Reviens demain, ou ouvre un paquet pour le repasser en entier."
          action={
            <Button asChild>
              <Link href="/">Voir mes paquets</Link>
            </Button>
          }
        />
      </div>
    );
  }

  return (
    <StudyClient
      // Les cartes viennent de plusieurs paquets : aucune session ne se
      // rattache à l'un d'eux en particulier.
      deckId={null}
      title="la révision du jour"
      backHref="/"
      replayHref="/study"
      cards={orderCards(cards, order)}
      deckOrder={cards.map((card) => card.id)}
      order={order}
    />
  );
}
