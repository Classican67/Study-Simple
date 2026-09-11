"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Images, Layers, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { deckColor } from "@/lib/deck-colors";
import { cn } from "@/lib/utils";
import { countByDeck, groupCards, type GroupFilter } from "./group-actions";

export type GroupableDeck = { id: string; title: string; color: string; cardCount: number };

/**
 * Réunit les cartes de plusieurs paquets dans un paquet de révision.
 *
 * Pensé pour un besoin précis : les figures anatomiques sont éparpillées dans
 * les paquets d'un cours, et on veut les revoir ensemble. On choisit donc les
 * paquets, on ne garde que les cartes qui portent une image, et on les reprend
 * dans un paquet dédié.
 *
 * Ce sont de vraies copies : on les modifie et on les supprime dans le paquet
 * de révision sans que le paquet d'origine en soit affecté.
 */
export function GroupDialog({
  decks,
  folderId,
  className,
}: {
  decks: GroupableDeck[];
  /** Le paquet créé est rangé ici, à côté de ses sources. */
  folderId: string | null;
  className?: string;
}) {
  const [open, setOpen] = React.useState(false);

  // Ne rien proposer là où il n'y a rien à réunir : un seul paquet ne se
  // regroupe pas avec lui-même.
  if (decks.length < 2) return null;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outlined" size="lg" className={className}>
          <Images />
          Regrouper
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Regrouper des cartes"
        description="Copie les cartes de plusieurs paquets dans un paquet de révision."
        className="sm:max-w-lg"
      >
        <GroupForm decks={decks} folderId={folderId} onDone={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

function GroupForm({
  decks,
  folderId,
  onDone,
}: {
  decks: GroupableDeck[];
  folderId: string | null;
  onDone: () => void;
}) {
  const router = useRouter();
  // Rien de coché au départ : on choisit ce qu'on regroupe. Tout présélectionner
  // pousse à valider sans regarder, alors que l'intérêt est justement de ne
  // prendre que les paquets qui contiennent des figures.
  const [selected, setSelected] = React.useState<string[]>([]);
  const [onlyImages, setOnlyImages] = React.useState(true);
  const [title, setTitle] = React.useState("Figures à réviser");
  const [targetId, setTargetId] = React.useState<string>("");
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const filter: GroupFilter = onlyImages ? "withImage" : "all";
  const deckIds = React.useMemo(() => decks.map((d) => d.id), [decks]);

  /*
   * Les comptes sont conservés AVEC le filtre qui les a produits : « en cours
   * de calcul » se déduit au rendu, au lieu d'être recopié dans un état qu'il
   * faudrait remettre à zéro depuis un effet — ce qui déclenche une cascade de
   * rendus.
   *
   * Un seul appel couvre tous les paquets ; le total se recalcule ensuite sans
   * aller-retour à chaque case cochée.
   */
  const [counted, setCounted] = React.useState<{ filter: GroupFilter; byDeck: Record<string, number> } | null>(
    null,
  );
  const counts = counted?.filter === filter ? counted.byDeck : null;

  React.useEffect(() => {
    let cancelled = false;
    countByDeck(deckIds, filter)
      .then((byDeck) => {
        if (!cancelled) setCounted({ filter, byDeck });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [deckIds, filter]);

  const count = counts ? selected.reduce((sum, id) => sum + (counts[id] ?? 0), 0) : null;

  // « Tout sélectionner » ne retient que les paquets qui ont de quoi donner :
  // cocher un paquet sans figure n'apporte rien et brouille le compte.
  const utiles = counts ? decks.filter((d) => (counts[d.id] ?? 0) > 0) : decks;
  // Comparé aux paquets utiles, pas à tous : sinon le bouton continuerait à
  // proposer « Tout sélectionner » alors que tout ce qui compte l'est déjà.
  const allSelected = utiles.length > 0 && utiles.every((d) => selected.includes(d.id));

  async function submit() {
    setPending(true);
    setError(null);
    const result = await groupCards({
      deckIds: selected,
      filter,
      targetDeckId: targetId || null,
      newDeckTitle: title,
      folderId,
    });
    setPending(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    onDone();
    router.push(`/decks/${result.deckId}`);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <div className="flex items-center justify-between gap-4">
          <h3 className="m3-title-small text-on-surface">Paquets à parcourir</h3>
          <button
            type="button"
            onClick={() => setSelected(allSelected ? [] : utiles.map((d) => d.id))}
            className="min-h-11 rounded-full px-3 m3-label-large text-primary"
          >
            {allSelected ? "Tout décocher" : "Tout sélectionner"}
          </button>
        </div>

        <ul className="scroll-slim max-h-56 space-y-1 overflow-y-auto">
          {decks.map((deck) => {
            const on = selected.includes(deck.id);
            const disponible = counts?.[deck.id] ?? 0;
            return (
              <li key={deck.id}>
                <label
                  className={cn(
                    "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl px-3 transition-colors",
                    on ? "bg-primary-container/40" : "hover:bg-surface-container",
                    counts !== null && disponible === 0 && !on && "opacity-55",
                  )}
                >
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(deck.id)
                          ? current.filter((id) => id !== deck.id)
                          : [...current, deck.id],
                      )
                    }
                    className="size-5 accent-[var(--m3-primary)]"
                  />
                  <span
                    className="grid size-8 shrink-0 place-items-center rounded-lg text-white"
                    style={{ backgroundColor: deckColor(deck.color) }}
                  >
                    <Layers className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1 truncate m3-body-large text-on-surface">
                    {deck.title}
                  </span>
                  {/* Le compte qui décide : combien de cartes ce paquet
                      donnerait, filtre appliqué. Sans lui on coche à
                      l'aveugle. */}
                  <span
                    className={cn(
                      "shrink-0 tabular-nums m3-label-small",
                      disponible === 0 ? "text-on-surface-variant/50" : "text-on-surface-variant",
                    )}
                    title={
                      onlyImages
                        ? `${disponible} carte(s) avec image sur ${deck.cardCount}`
                        : `${deck.cardCount} carte(s)`
                    }
                  >
                    {counts === null ? "…" : onlyImages ? `${disponible}/${deck.cardCount}` : deck.cardCount}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="rounded-2xl bg-surface-lowest p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="m3-body-large text-on-surface">Seulement les cartes avec image</p>
            <p className="mt-0.5 m3-body-small text-on-surface-variant">
              C&apos;est ce qu&apos;on veut pour réunir des figures.
            </p>
          </div>
          <Switch
            label="Seulement les cartes avec image"
            checked={onlyImages}
            onChange={setOnlyImages}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="m3-title-small text-on-surface">Destination</h3>
        <select
          value={targetId}
          onChange={(event) => setTargetId(event.target.value)}
          aria-label="Paquet de destination"
          className="h-12 w-full rounded-xl border border-outline-variant bg-surface-container px-3 m3-body-large text-on-surface"
        >
          <option value="">Nouveau paquet</option>
          {decks.map((deck) => (
            <option key={deck.id} value={deck.id}>
              {deck.title}
            </option>
          ))}
        </select>

        {targetId === "" ? (
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            aria-label="Titre du nouveau paquet"
            placeholder="Titre du nouveau paquet"
            className="h-12 w-full rounded-xl border border-outline-variant bg-surface-container px-3 m3-body-large text-on-surface"
          />
        ) : null}
      </section>

      <p aria-live="polite" className="m3-body-medium text-on-surface-variant">
        {selected.length === 0
          ? "Choisis les paquets à parcourir."
          : count === null
            ? "Calcul…"
            : count === 0
              ? "Aucune carte ne correspond."
              : `${count} carte${count > 1 ? "s" : ""} seront copiées. Celles déjà présentes sont ignorées.`}
      </p>

      {error ? (
        <p role="alert" className="m3-body-medium text-error">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button onClick={submit} disabled={pending || selected.length === 0 || count === 0}>
          {pending ? <Loader2 className="animate-spin" /> : <Images />}
          Regrouper
        </Button>
      </div>
    </div>
  );
}
