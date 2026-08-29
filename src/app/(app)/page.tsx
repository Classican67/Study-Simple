import Link from "next/link";
import { ArrowRight, Layers, Sparkles } from "lucide-react";

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
  const globalProgress = totalCards === 0 ? 0 : (totalKnown / totalCards) * 100;

  return (
    <div className="space-y-8">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Mes paquets</h1>
          <p className="mt-2 text-sm text-fg-muted">
            {totalCards === 0
              ? "Aucune carte pour l'instant."
              : `${totalKnown} sur ${totalCards} carte${totalCards > 1 ? "s" : ""} acquise${totalKnown > 1 ? "s" : ""}.`}
          </p>
        </div>

        {decks.length > 0 ? (
          <div className="flex w-full items-center gap-4 sm:w-auto">
            {totalCards > 0 ? (
              // Progression d'ensemble : visible sur grand écran, où la place
              // ne manque pas ; le détail par paquet suffit sur téléphone.
              <div className="hidden w-40 md:block">
                <div className="mb-1.5 flex justify-between text-xs text-fg-subtle">
                  <span>Progression</span>
                  <span className="tabular-nums">{Math.round(globalProgress)} %</span>
                </div>
                <ProgressBar value={globalProgress} />
              </div>
            ) : null}
            <NewDeckButton className="w-full sm:w-auto" />
          </div>
        ) : null}
      </header>

      {decks.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="size-6" />}
          title="Commence par créer un paquet"
          description="Un paquet par cours ou par chapitre. Tu y ajoutes ensuite tes cartes question / réponse, avec une image si ça aide."
          action={<NewDeckButton />}
        />
      ) : (
        // Une seule colonne sur téléphone, deux dès l'iPad en portrait, trois
        // au-delà : une carte isolée reste large et ne flotte pas dans le vide.
        <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {decks.map((deck) => {
            const progress = deck.cardCount === 0 ? 0 : (deck.knownCount / deck.cardCount) * 100;
            const color = deckColor(deck.color);
            const remaining = deck.cardCount - deck.knownCount;

            return (
              <li key={deck.id}>
                <Link
                  href={`/decks/${deck.id}`}
                  className="group relative flex h-full flex-col overflow-hidden sm:min-h-52 rounded-card border border-border bg-surface shadow-soft transition-all duration-200 hover:-translate-y-1 hover:border-border-strong hover:shadow-lift"
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
                      <Badge tone={remaining === 0 && deck.cardCount > 0 ? "success" : "neutral"}>
                        {remaining === 0 && deck.cardCount > 0
                          ? "Tout su"
                          : `${remaining} à revoir`}
                      </Badge>
                    </div>

                    <h2 className="text-pretty font-display text-lg font-semibold leading-snug">
                      {deck.title}
                    </h2>
                    {deck.description ? (
                      <p className="mt-1.5 line-clamp-2 text-sm leading-relaxed text-fg-muted">
                        {deck.description}
                      </p>
                    ) : null}

                    <div className="mt-auto pt-5">
                      <div className="mb-2 flex items-center justify-between text-xs text-fg-subtle">
                        <span className="tabular-nums">
                          {deck.knownCount}/{deck.cardCount} carte{deck.cardCount > 1 ? "s" : ""}
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
      )}
    </div>
  );
}
