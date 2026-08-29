import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, GraduationCap, Layers } from "lucide-react";

import { Badge, EmptyState, ProgressBar } from "@/components/ui/panel";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth";
import { deckColor, getDeckCards, getDeckForUser } from "@/lib/decks";
import { CardRow } from "./card-row";
import { AddCardButton, DeckSettings } from "./deck-toolbar";

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
  const known = cards.filter((card) => card.status === "known").length;
  const toReview = cards.length - known;
  const progress = cards.length === 0 ? 0 : (known / cards.length) * 100;

  return (
    <div className="space-y-8">
      <div>
        <Link
          href="/"
          className="mb-4 inline-flex items-center gap-1.5 rounded-lg text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          Tous les paquets
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className="grid size-11 shrink-0 place-items-center rounded-xl text-white"
              style={{ backgroundColor: deckColor(deck.color) }}
            >
              <Layers className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-2xl font-semibold tracking-tight break-words">{deck.title}</h1>
              {deck.description ? (
                <p className="mt-1 text-sm text-fg-muted">{deck.description}</p>
              ) : null}
            </div>
          </div>

          <DeckSettings deck={deck} hasProgress={known > 0 || cards.some((c) => c.status === "learning")} />
        </div>
      </div>

      <div className="rounded-card border border-border bg-surface p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Badge tone="success">{known} sue{known > 1 ? "s" : ""}</Badge>
            <Badge tone={toReview > 0 ? "accent" : "neutral"}>{toReview} à revoir</Badge>
          </div>

          <div className="flex gap-2">
            <AddCardButton deckId={deck.id} />
            {cards.length > 0 ? (
              <Button asChild variant="secondary">
                <Link href={`/decks/${deck.id}/study`}>
                  <GraduationCap />
                  Réviser
                </Link>
              </Button>
            ) : null}
          </div>
        </div>
        <ProgressBar value={progress} className="mt-4" />
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-5" />}
          title="Ce paquet est vide"
          description="Ajoute une première carte : une question au recto, la réponse au verso, avec une image si ça aide."
          action={<AddCardButton deckId={deck.id} />}
        />
      ) : (
        <ul className="space-y-3">
          {cards.map((card, index) => (
            <CardRow key={card.id} card={card} index={index} />
          ))}
        </ul>
      )}
    </div>
  );
}
