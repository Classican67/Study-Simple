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
import { ImportDialog } from "./import-dialog";

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
          className="-ml-2 mb-3 inline-flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-sm text-fg-muted transition-colors hover:text-fg"
        >
          <ArrowLeft className="size-4" />
          Tous les paquets
        </Link>

        <div className="flex items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3.5">
            <span
              className="grid size-12 shrink-0 place-items-center rounded-2xl text-white shadow-soft"
              style={{ backgroundColor: deckColor(deck.color) }}
            >
              <Layers className="size-5.5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-pretty text-2xl font-semibold tracking-tight sm:text-3xl">
                {deck.title}
              </h1>
              {deck.description ? (
                <p className="mt-1.5 text-sm leading-relaxed text-fg-muted">{deck.description}</p>
              ) : null}
            </div>
          </div>

          <DeckSettings deck={deck} hasProgress={known > 0 || cards.some((c) => c.status === "learning")} />
        </div>
      </div>

      <div className="rounded-card border border-border bg-surface p-5 shadow-soft sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone="success">{known} sue{known > 1 ? "s" : ""}</Badge>
            <Badge tone={toReview > 0 ? "accent" : "neutral"}>{toReview} à revoir</Badge>
          </div>

          {/* Trois actions ne tiennent pas sur une ligne de téléphone : la
              rangée passe à la ligne plutôt que de les comprimer sous la
              taille tactile. */}
          <div className="flex w-full flex-wrap gap-2 sm:w-auto sm:flex-nowrap">
            {cards.length > 0 ? (
              <Button asChild size="lg" className="flex-1 sm:flex-none">
                <Link href={`/decks/${deck.id}/study`}>
                  <GraduationCap />
                  Réviser
                </Link>
              </Button>
            ) : null}
            <AddCardButton deckId={deck.id} variant={cards.length > 0 ? "secondary" : "primary"} />
            <ImportDialog deckId={deck.id} />
          </div>
        </div>
        <ProgressBar value={progress} className="mt-5" />
      </div>

      {cards.length === 0 ? (
        <EmptyState
          icon={<Layers className="size-5" />}
          title="Ce paquet est vide"
          description="Ajoute une première carte à la main, ou colle une liste venue de Quizlet, de Studyield ou d'un tableur."
          action={
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <AddCardButton deckId={deck.id} />
              <ImportDialog deckId={deck.id} />
            </div>
          }
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
