"use client";

import * as React from "react";
import { Reorder, useDragControls } from "motion/react";
import {
  ChevronDown,
  ChevronUp,
  GripVertical,
  ImagePlus,
  Loader2,
  Plus,
  Trash2,
  TriangleAlert,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { ImageLightbox } from "@/components/image-lightbox";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { RichTextarea } from "@/components/rich-textarea";
import {
  addEmptyCard,
  deleteCard,
  reorderCards,
  saveCardText,
  setCardImage,
} from "./actions";

export type EditableCard = {
  id: string;
  term: string;
  definition: string;
  imagePath: string | null;
};

const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Éditeur de cartes en ligne, façon Quizlet : toutes les cartes visibles à la
 * fois, modifiables sur place, réordonnables.
 *
 * Après le montage, c'est cette liste côté client qui fait foi : les actions
 * d'enregistrement ne revalident pas la page, car un rafraîchissement en pleine
 * frappe ferait sauter le curseur. Les compteurs de l'en-tête sont donc
 * rafraîchis à la navigation, pas à chaque lettre tapée.
 */
export function CardEditor({
  deckId,
  initialCards,
}: {
  deckId: string;
  initialCards: EditableCard[];
}) {
  const [cards, setCards] = React.useState(initialCards);
  const [pendingAdd, setPendingAdd] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  // Id de la carte à laquelle donner le focus une fois rendue.
  const [focusId, setFocusId] = React.useState<string | null>(null);

  const persistOrder = React.useCallback(
    async (next: EditableCard[]) => {
      const result = await reorderCards(deckId, next.map((c) => c.id));
      if (!result.ok) setError(result.error ?? "Réordonnancement impossible.");
    },
    [deckId],
  );

  // Le glissement met à jour la liste en continu ; on n'écrit en base qu'au
  // relâchement, pour ne pas déclencher une transaction par pixel parcouru.
  const onReorder = React.useCallback((next: EditableCard[]) => setCards(next), []);

  const move = React.useCallback(
    (index: number, direction: -1 | 1) => {
      const target = index + direction;
      if (target < 0 || target >= cards.length) return;
      const next = [...cards];
      [next[index], next[target]] = [next[target], next[index]];
      setCards(next);
      void persistOrder(next);
    },
    [cards, persistOrder],
  );

  async function add() {
    setPendingAdd(true);
    setError(null);
    const created = await addEmptyCard(deckId);
    setPendingAdd(false);
    if (!created) {
      setError("Impossible d'ajouter une carte.");
      return;
    }
    setCards((current) => [...current, created]);
    setFocusId(created.id);
  }

  async function remove(id: string) {
    await deleteCard(id);
    setCards((current) => current.filter((card) => card.id !== id));
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p role="alert" className="flex items-center gap-2 text-sm text-danger">
          <TriangleAlert className="size-4 shrink-0" />
          {error}
        </p>
      ) : null}

      <Reorder.Group axis="y" values={cards} onReorder={onReorder} className="space-y-3">
        {cards.map((card, index) => (
          <CardRow
            key={card.id}
            card={card}
            index={index}
            total={cards.length}
            autoFocus={card.id === focusId}
            onFocused={() => setFocusId(null)}
            onDragEnd={() => persistOrder(cards)}
            onMove={(direction) => move(index, direction)}
            onDelete={() => remove(card.id)}
          />
        ))}
      </Reorder.Group>

      <Button
        variant="secondary"
        size="lg"
        onClick={add}
        disabled={pendingAdd}
        className="w-full border-dashed"
      >
        {pendingAdd ? <Loader2 className="animate-spin" /> : <Plus />}
        Ajouter une carte
      </Button>
    </div>
  );
}

type SaveState = "idle" | "saving" | "saved" | "error";

function CardRow({
  card,
  index,
  total,
  autoFocus,
  onFocused,
  onDragEnd,
  onMove,
  onDelete,
}: {
  card: EditableCard;
  index: number;
  total: number;
  autoFocus: boolean;
  onFocused: () => void;
  onDragEnd: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const controls = useDragControls();
  const [imagePath, setImagePath] = React.useState(card.imagePath);
  const [state, setState] = React.useState<SaveState>("idle");
  const [message, setMessage] = React.useState<string | null>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const rowRef = React.useRef<HTMLDivElement>(null);

  // Dernières valeurs enregistrées : sortir d'un champ sans l'avoir modifié
  // ne doit pas déclencher d'écriture.
  const saved = React.useRef({ term: card.term, definition: card.definition });

  React.useEffect(() => {
    if (!autoFocus) return;
    rowRef.current?.querySelector("textarea")?.focus();
    onFocused();
  }, [autoFocus, onFocused]);

  async function persist(term: string, definition: string) {
    if (term === saved.current.term && definition === saved.current.definition) return;

    setState("saving");
    const result = await saveCardText(card.id, term, definition);
    if (result.ok) {
      saved.current = { term, definition };
      setState("saved");
      setMessage(null);
      // L'indicateur disparaît de lui-même : il confirme, il n'informe pas.
      window.setTimeout(() => setState("idle"), 1600);
    } else {
      setState("error");
      setMessage(result.error ?? "Enregistrement impossible.");
    }
  }

  function onBlur() {
    const textareas = rowRef.current?.querySelectorAll("textarea");
    if (!textareas || textareas.length < 2) return;
    void persist(textareas[0].value, textareas[1].value);
  }

  async function onPickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setState("error");
      setMessage("Image trop lourde (8 Mo maximum).");
      event.target.value = "";
      return;
    }

    setState("saving");
    const data = new FormData();
    data.set("image", file);
    const result = await setCardImage(card.id, data);
    event.target.value = "";

    if (result.ok) {
      setImagePath(result.imagePath ?? null);
      setState("saved");
      setMessage(null);
      window.setTimeout(() => setState("idle"), 1600);
    } else {
      setState("error");
      setMessage(result.error ?? "Envoi impossible.");
    }
  }

  async function dropImage() {
    const data = new FormData();
    data.set("remove", "1");
    const result = await setCardImage(card.id, data);
    if (result.ok) setImagePath(null);
  }

  return (
    <Reorder.Item
      value={card}
      // Sans `dragListener={false}`, tout le bloc devient une poignée : on ne
      // pourrait plus sélectionner de texte dans les champs.
      dragListener={false}
      dragControls={controls}
      className="rounded-card border border-border bg-surface shadow-soft"
    >
      <div ref={rowRef}>
        <header className="flex items-center gap-1 border-b border-border px-3 py-2">
          <span className="w-7 text-center text-sm font-medium tabular-nums text-fg-subtle">
            {index + 1}
          </span>

          <SaveIndicator state={state} message={message} />

          <div className="ml-auto flex items-center gap-0.5">
            {/* Flèches en plus du glisser : au clavier et sur un long paquet,
                c'est la seule façon confortable de réordonner. */}
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onMove(-1)}
              disabled={index === 0}
              aria-label={`Monter la carte ${index + 1}`}
            >
              <ChevronUp />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => onMove(1)}
              disabled={index === total - 1}
              aria-label={`Descendre la carte ${index + 1}`}
            >
              <ChevronDown />
            </Button>

            <button
              type="button"
              onPointerDown={(event) => controls.start(event)}
              aria-hidden
              tabIndex={-1}
              // `touch-none` empêche le navigateur de faire défiler la page
              // pendant qu'on glisse la carte au doigt.
              className="grid size-11 cursor-grab touch-none place-items-center rounded-xl text-fg-subtle transition-colors hover:bg-surface-raised hover:text-fg active:cursor-grabbing"
            >
              <GripVertical className="size-4" />
            </button>

            <ConfirmDialog
              trigger={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Supprimer la carte ${index + 1}`}
                  className="hover:text-danger"
                >
                  <Trash2 />
                </Button>
              }
              title="Supprimer cette carte ?"
              description="La carte et son image seront définitivement effacées."
              confirmLabel="Supprimer"
              action={async () => onDelete()}
            />
          </div>
        </header>

        <div
          // Le glissement est confié à la poignée : on relâche ici pour
          // enregistrer le nouvel ordre.
          onPointerUp={onDragEnd}
          className="grid gap-3 p-3 lg:grid-cols-[1fr_1.3fr_auto]"
        >
          <LabelledField label="Terme">
            <RichTextarea
              compact
              defaultValue={card.term.trim()}
              onBlur={onBlur}
              rows={2}
              maxLength={2000}
              placeholder="Décibel"
            />
          </LabelledField>

          <LabelledField label="Définition">
            <RichTextarea
              compact
              defaultValue={card.definition.trim()}
              onBlur={onBlur}
              rows={2}
              maxLength={10000}
              placeholder="Rapport logarithmique entre la pression mesurée et la pression de référence"
            />
          </LabelledField>

          <div className="lg:w-40">
            <span className="mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-wide text-fg-subtle">
              Image
            </span>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
              onChange={onPickImage}
              className="sr-only"
            />
            {imagePath ? (
              <div className="relative w-fit">
                <ImageLightbox
                  src={`/api/uploads/${imagePath}`}
                  alt={`Illustration de la carte ${index + 1}`}
                  thumbnailClassName="max-h-24 w-auto"
                />
                <button
                  type="button"
                  onClick={dropImage}
                  aria-label="Retirer l'image"
                  className="absolute -right-2 -top-2 grid size-7 place-items-center rounded-full bg-surface text-fg-muted shadow-lift transition-colors hover:text-danger"
                >
                  <X className="size-3.5" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex h-24 w-full flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border-strong text-fg-subtle transition-colors hover:border-accent hover:text-accent lg:w-40"
              >
                <ImagePlus className="size-5" />
                <span className="text-xs">Image</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </Reorder.Item>
  );
}

function LabelledField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="mb-1.5 block text-[0.7rem] font-semibold uppercase tracking-wide text-fg-subtle">
        {label}
      </span>
      {children}
    </div>
  );
}

function SaveIndicator({ state, message }: { state: SaveState; message: string | null }) {
  if (state === "idle") return null;

  if (state === "error") {
    return (
      <span role="alert" className="flex items-center gap-1.5 text-xs font-medium text-danger">
        <TriangleAlert className="size-3.5 shrink-0" />
        {message ?? "Erreur"}
      </span>
    );
  }

  return (
    // `role="status"` : le changement est annoncé sans voler le focus.
    <span role="status" className="flex items-center gap-1.5 text-xs text-fg-subtle">
      {state === "saving" ? (
        <>
          <Loader2 className="size-3.5 animate-spin" />
          Enregistrement…
        </>
      ) : (
        "Enregistré"
      )}
    </span>
  );
}
