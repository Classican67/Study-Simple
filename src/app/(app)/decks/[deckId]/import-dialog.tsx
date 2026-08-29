"use client";

import * as React from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { CircleCheck, Download, TriangleAlert, Wand2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Field, Input } from "@/components/ui/field";
import { Badge } from "@/components/ui/panel";
import {
  CARD_SEPARATORS,
  TERM_SEPARATORS,
  detectSeparators,
  parseImport,
  type CardSeparatorKey,
  type ImportOptions,
  type TermSeparatorKey,
} from "@/lib/import";
import { cn } from "@/lib/utils";
import { importCards, type ImportState } from "./actions";

const selectClass =
  "h-11 w-full rounded-xl border border-border bg-surface px-3 text-sm text-fg " +
  "focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring";

const PLACEHOLDER = `mitose\tDivision en deux cellules identiques
méiose\tDivision réductionnelle

Colle ici l'export de Quizlet (Exporter → copier le texte),
ou n'importe quelle liste « terme <séparateur> définition ».`;

function Submit({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending || disabled}>
      <Download />
      {pending ? "Import…" : "Importer"}
    </Button>
  );
}

export function ImportDialog({ deckId }: { deckId: string }) {
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [term, setTerm] = React.useState<TermSeparatorKey>("tab");
  const [card, setCard] = React.useState<CardSeparatorKey>("newline");
  const [customTerm, setCustomTerm] = React.useState("");
  const [customCard, setCustomCard] = React.useState("");
  // Tant que l'utilisateur n'a pas choisi lui-même, la détection reste maîtresse.
  const [manual, setManual] = React.useState(false);
  const [detected, setDetected] = React.useState(false);

  const boundImport = React.useMemo(() => importCards.bind(null, deckId), [deckId]);
  const [state, formAction] = useActionState<ImportState, FormData>(boundImport, {});

  // L'objet d'options est construit dans le mémo : le créer à l'extérieur en
  // ferait une nouvelle référence à chaque rendu, que le mémo devrait alors
  // lister en dépendance — ce qui annulerait sa raison d'être.
  const preview = React.useMemo(
    () =>
      parseImport(text, {
        termSeparator: term,
        cardSeparator: card,
        customTerm,
        customCard,
      } satisfies ImportOptions),
    [text, term, card, customTerm, customCard],
  );

  function onTextChange(value: string) {
    setText(value);
    if (manual) return;
    const guess = detectSeparators(value);
    if (guess) {
      setTerm(guess.termSeparator);
      setCard(guess.cardSeparator);
      setDetected(true);
    } else {
      setDetected(false);
    }
  }

  function chooseTerm(value: TermSeparatorKey) {
    setManual(true);
    setDetected(false);
    setTerm(value);
  }

  function chooseCard(value: CardSeparatorKey) {
    setManual(true);
    setDetected(false);
    setCard(value);
  }

  function reset() {
    setText("");
    setManual(false);
    setDetected(false);
    setTerm("tab");
    setCard("newline");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        // Rouvrir la modale ne doit pas ramener le collage précédent ni le
        // compte-rendu de l'import passé.
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary" size="lg" className="flex-1 sm:flex-none">
          <Download />
          <span className="sm:hidden">Importer</span>
          <span className="hidden sm:inline">Importer des cartes</span>
        </Button>
      </DialogTrigger>

      <DialogContent
        title="Importer des cartes"
        description="Colle une liste depuis Quizlet, Studyield, un tableur ou un fichier texte. Les images ne peuvent pas être importées : ces exports ne contiennent que du texte."
      >
        {state.created ? (
          // Compte-rendu : on remplace le formulaire plutôt que de l'empiler,
          // pour que le résultat soit la seule chose à lire.
          <div className="space-y-5 text-center">
            <div className="mx-auto grid size-14 animate-pop place-items-center rounded-2xl bg-success/12 text-success">
              <CircleCheck className="size-7" />
            </div>
            <div>
              <p className="font-display text-xl font-semibold">
                {state.created} carte{state.created > 1 ? "s" : ""} importée
                {state.created > 1 ? "s" : ""}
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                {state.duplicates ? (
                  <Badge>
                    {state.duplicates} doublon{state.duplicates > 1 ? "s" : ""} ignoré
                    {state.duplicates > 1 ? "s" : ""}
                  </Badge>
                ) : null}
                {state.skipped ? (
                  <Badge tone="danger">
                    {state.skipped} ligne{state.skipped > 1 ? "s" : ""} non reconnue
                    {state.skipped > 1 ? "s" : ""}
                  </Badge>
                ) : null}
              </div>
            </div>
            <Button onClick={() => setOpen(false)} className="w-full sm:w-auto">
              Terminé
            </Button>
          </div>
        ) : (
          <form action={formAction} className="space-y-4">
            <Field label="Cartes à importer" htmlFor="import-text">
              <textarea
                name="text"
                value={text}
                onChange={(e) => onTextChange(e.target.value)}
                rows={8}
                autoFocus
                spellCheck={false}
                placeholder={PLACEHOLDER}
                className="w-full resize-y rounded-xl border border-border bg-surface px-3 py-2 font-mono text-xs leading-relaxed text-fg placeholder:text-fg-subtle focus:border-accent focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="import-term" className="text-sm font-medium text-fg">
                  Entre le terme et la définition
                </label>
                <select
                  id="import-term"
                  name="termSeparator"
                  value={term}
                  onChange={(e) => chooseTerm(e.target.value as TermSeparatorKey)}
                  className={selectClass}
                >
                  {Object.entries(TERM_SEPARATORS).map(([key, sep]) => (
                    <option key={key} value={key}>
                      {sep.label}
                      {"hint" in sep ? ` — ${sep.hint}` : ""}
                    </option>
                  ))}
                  <option value="custom">Personnalisé…</option>
                </select>
                {term === "custom" ? (
                  <Input
                    name="customTerm"
                    value={customTerm}
                    onChange={(e) => setCustomTerm(e.target.value)}
                    placeholder="ex. ::"
                    aria-label="Séparateur personnalisé entre terme et définition"
                  />
                ) : null}
              </div>

              <div className="space-y-1.5">
                <label htmlFor="import-card" className="text-sm font-medium text-fg">
                  Entre deux cartes
                </label>
                <select
                  id="import-card"
                  name="cardSeparator"
                  value={card}
                  onChange={(e) => chooseCard(e.target.value as CardSeparatorKey)}
                  className={selectClass}
                >
                  {Object.entries(CARD_SEPARATORS).map(([key, sep]) => (
                    <option key={key} value={key}>
                      {sep.label}
                      {"hint" in sep ? ` — ${sep.hint}` : ""}
                    </option>
                  ))}
                  <option value="custom">Personnalisé…</option>
                </select>
                {card === "custom" ? (
                  <Input
                    name="customCard"
                    value={customCard}
                    onChange={(e) => setCustomCard(e.target.value)}
                    placeholder="ex. ---"
                    aria-label="Séparateur personnalisé entre deux cartes"
                  />
                ) : null}
              </div>
            </div>

            {detected ? (
              <p className="flex items-center gap-2 text-xs text-accent">
                <Wand2 className="size-3.5 shrink-0" />
                Format reconnu automatiquement. Change les séparateurs si l&apos;aperçu est faux.
              </p>
            ) : null}

            {/* Le libellé fait partie de la cible : on lui donne la hauteur
                tactile, pour que toute la ligne réponde au doigt. */}
            <label className="-mx-2 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-2 text-sm text-fg transition-colors hover:bg-surface-raised">
              <input
                type="checkbox"
                name="skipDuplicates"
                defaultChecked
                className="size-5 shrink-0 rounded border-border accent-[var(--color-accent)]"
              />
              Ignorer les cartes dont le terme existe déjà
            </label>

            {text.trim() ? <Preview result={preview} /> : null}

            {state.error ? (
              <p role="alert" className="flex items-center gap-2 text-sm text-danger">
                <TriangleAlert className="size-4 shrink-0" />
                {state.error}
              </p>
            ) : null}

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Submit disabled={preview.cards.length === 0} />
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// Aperçu en direct : c'est lui qui rend les séparateurs compréhensibles.
// Sans ça, l'utilisateur ne découvrirait le mauvais découpage qu'après import.
function Preview({ result }: { result: ReturnType<typeof parseImport> }) {
  const { cards, skipped } = result;

  return (
    <div className="rounded-xl border border-border bg-surface-raised p-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <Badge tone={cards.length > 0 ? "success" : "danger"}>
          {cards.length} carte{cards.length > 1 ? "s" : ""} reconnue{cards.length > 1 ? "s" : ""}
        </Badge>
        {skipped.length > 0 ? (
          <Badge tone="danger">
            {skipped.length} ligne{skipped.length > 1 ? "s" : ""} ignorée
            {skipped.length > 1 ? "s" : ""}
          </Badge>
        ) : null}
      </div>

      {cards.length > 0 ? (
        <ul className="space-y-1.5">
          {cards.slice(0, 3).map((c, i) => (
            <li key={i} className="grid grid-cols-[1fr_auto_1.4fr] items-start gap-2 text-xs">
              <span className="truncate font-medium text-fg">{c.term}</span>
              <span className="text-fg-subtle">→</span>
              <span className="line-clamp-2 text-fg-muted">{c.definition}</span>
            </li>
          ))}
          {cards.length > 3 ? (
            <li className="text-xs text-fg-subtle">et {cards.length - 3} autre{cards.length - 3 > 1 ? "s" : ""}…</li>
          ) : null}
        </ul>
      ) : (
        <p className="text-xs text-fg-muted">
          Aucune carte reconnue avec ces séparateurs. Essaie-en un autre.
        </p>
      )}

      {skipped.length > 0 ? (
        <p className={cn("mt-2 truncate text-xs text-fg-subtle")}>
          Ignoré : « {skipped[0]} »{skipped.length > 1 ? ` et ${skipped.length - 1} de plus` : ""}
        </p>
      ) : null}
    </div>
  );
}
