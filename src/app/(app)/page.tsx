import Link from "next/link";
import { Layers, Sparkles } from "lucide-react";

import { Badge, EmptyState, ProgressBar } from "@/components/ui/panel";
import { requireUser } from "@/lib/auth";
import { deckColor, listDecks } from "@/lib/decks";
import { NewDeckButton } from "./new-deck-button";

// Les paquets et la progression changent à chaque révision : rien à mettre en
// cache statique ici.
export const dynamic = "force-dynamic";

export default async function HomePage() {
  const user = await requireUser();
  const decks = await listDecks(user.id);

  const totalCards = decks.reduce((sum, deck) => sum + deck.cardCount, 0);
  const totalKnown = decks.reduce((sum, deck) => sum + deck.knownCount, 0);

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Mes paquets</h1>
          <p className="mt-1 text-sm text-fg-muted">
            {totalCards === 0
              ? "Aucune carte pour l'instant."
              : `${totalKnown} carte${totalKnown > 1 ? "s" : ""} sue${totalKnown > 1 ? "s" : ""} sur ${totalCards}.`}
          </p>
        </div>
        {decks.length > 0 ? <NewDeckButton /> : null}
      </div>

      {decks.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-5" />}
          title="Commence par créer un paquet"
          description="Un paquet par cours ou par chapitre. Tu y ajoutes ensuite tes cartes question / réponse, avec une image si besoin."
          action={<NewDeckButton />}
        />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks.map((deck) => {
            const progress = deck.cardCount === 0 ? 0 : (deck.knownCount / deck.cardCount) * 100;

            return (
              <li key={deck.id}>
                <Link
                  href={`/decks/${deck.id}`}
                  className="group flex h-full flex-col rounded-card border border-border bg-surface p-5 shadow-sm transition-all hover:-translate-y-0.5 hover:border-accent/40 hover:shadow-md"
                >
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <span
                      className="grid size-9 shrink-0 place-items-center rounded-xl text-white"
                      style={{ backgroundColor: deckColor(deck.color) }}
                    >
                      <Layers className="size-4" />
                    </span>
                    <Badge tone={progress === 100 && deck.cardCount > 0 ? "success" : "neutral"}>
                      {deck.knownCount}/{deck.cardCount}
                    </Badge>
                  </div>

                  <h2 className="font-semibold leading-snug text-fg group-hover:text-accent">
                    {deck.title}
                  </h2>
                  {deck.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{deck.description}</p>
                  ) : null}

                  <div className="mt-auto pt-4">
                    <ProgressBar value={progress} />
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
