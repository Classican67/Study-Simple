"use client";

import * as React from "react";
import Link from "next/link";
import { Check, CircleHelp, RotateCcw, ThumbsUp, Trophy, X } from "lucide-react";

import { AnswerView } from "@/components/answer-view";
import { RichText, toPlainText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/panel";
import { checkAnswer, type AnswerVerdict } from "@/lib/answer-check";
import { cn } from "@/lib/utils";
import { finishSession, recordAnswer } from "./actions";
import type { StudyCard } from "./study-client";

/**
 * Mode « écrire » : au lieu de retourner la carte et de s'auto-évaluer, on
 * tape la réponse et l'app la vérifie.
 *
 * L'auto-évaluation est complaisante — on se dit « oui je savais » en voyant
 * la réponse. Produire la réponse est un exercice nettement plus exigeant, et
 * c'est ce qui ancre réellement la mémoire.
 */
export function WriteClient({
  deckId,
  title,
  backHref,
  cards,
  cardsHref,
}: {
  deckId: string | null;
  title: string;
  backHref: string;
  cards: StudyCard[];
  /** Retour au mode cartes, en conservant le paquet. */
  cardsHref: string;
}) {
  const [queue, setQueue] = React.useState(cards);
  const [typed, setTyped] = React.useState("");
  const [verdict, setVerdict] = React.useState<AnswerVerdict | null>(null);
  const [stats, setStats] = React.useState({ correct: 0, miss: 0 });
  const inputRef = React.useRef<HTMLInputElement>(null);
  const finishedRef = React.useRef(false);

  const current = queue[0];
  const done = stats.correct + stats.miss;
  const progress = cards.length === 0 ? 0 : (stats.correct / cards.length) * 100;

  React.useEffect(() => {
    if (queue.length > 0 || done === 0 || finishedRef.current) return;
    finishedRef.current = true;
    if (deckId) void finishSession(deckId, stats.correct, stats.miss);
  }, [queue.length, done, deckId, stats.correct, stats.miss]);

  // Passe à la carte suivante en enregistrant le résultat.
  const advance = React.useCallback(
    (knew: boolean) => {
      const card = queue[0];
      if (!card) return;

      void recordAnswer(card.id, knew);
      setStats((s) => ({
        correct: s.correct + (knew ? 1 : 0),
        miss: s.miss + (knew ? 0 : 1),
      }));
      // Une carte ratée revient plus loin dans la même session, comme en
      // mode cartes.
      setQueue((q) => (knew ? q.slice(1) : [...q.slice(1), card]));
      setTyped("");
      setVerdict(null);
      // Le champ perd le focus au clic sur un bouton : on le lui rend pour
      // pouvoir enchaîner au clavier sans toucher la souris.
      window.setTimeout(() => inputRef.current?.focus(), 0);
    },
    [queue],
  );

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!current || verdict) return;

    const result = checkAnswer(typed, current.definition);
    setVerdict(result);

    // Réponse juste : on enchaîne tout seul, le temps de voir la confirmation.
    if (result !== "wrong") {
      window.setTimeout(() => advance(true), result === "exact" ? 650 : 1100);
    }
  }

  if (!current) {
    return (
      <Summary
        title={title}
        backHref={backHref}
        cardsHref={cardsHref}
        stats={stats}
        total={cards.length}
      />
    );
  }

  const answered = verdict !== null;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-2xl font-semibold tabular-nums">
            {stats.correct}
            <span className="text-base font-normal text-fg-subtle">/{cards.length}</span>
          </span>
          <span className="text-sm tabular-nums text-fg-muted">
            {queue.length} restante{queue.length > 1 ? "s" : ""}
          </span>
        </div>
        <ProgressBar value={progress} />
      </div>

      <div className="rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
          Question
        </span>
        <RichText className="mt-4 text-balance text-center font-display text-2xl font-semibold leading-tight sm:text-3xl">
          {current.term}
        </RichText>

        {current.imagePath ? (
          <div className="mt-5 flex justify-center">
            <AnswerView definition="" imagePath={current.imagePath} compact />
          </div>
        ) : null}

        <form onSubmit={submit} className="mt-7 space-y-3">
          <input
            ref={inputRef}
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
            readOnly={answered}
            autoFocus
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Écris la réponse…"
            aria-label="Ta réponse"
            className={cn(
              "h-12 w-full rounded-xl border bg-surface px-4 text-center text-base text-fg",
              "placeholder:text-fg-subtle focus:outline-none focus:ring-2",
              verdict === null && "border-border focus:border-accent focus:ring-ring",
              verdict === "wrong" && "border-danger text-danger focus:ring-0",
              verdict !== null && verdict !== "wrong" && "border-success text-success focus:ring-0",
            )}
          />

          {!answered ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => setVerdict("wrong")}
                className="flex-1"
              >
                <CircleHelp />
                Je ne sais pas
              </Button>
              <Button type="submit" size="lg" className="flex-1" disabled={!typed.trim()}>
                <Check />
                Vérifier
              </Button>
            </div>
          ) : null}
        </form>

        {verdict !== null && verdict !== "wrong" ? (
          <p
            role="status"
            className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-success"
          >
            <Check className="size-4" />
            {verdict === "exact" ? "Correct" : "Correct, à l'orthographe près"}
          </p>
        ) : null}

        {verdict === "wrong" ? (
          <div className="mt-5 space-y-4">
            <div className="rounded-xl border border-border bg-surface-raised p-4">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-danger">
                <X className="size-3.5" />
                La réponse attendue
              </p>
              <AnswerView definition={current.definition} />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {/* Indispensable : la comparaison ne reconnaît ni un synonyme ni
                  une formulation différente. Sans cette porte de sortie, le
                  mode devient punitif. */}
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={() => advance(true)}
                className="flex-1"
              >
                <ThumbsUp />
                En fait, je savais
              </Button>
              <Button type="button" size="lg" onClick={() => advance(false)} className="flex-1">
                Continuer
              </Button>
            </div>
          </div>
        ) : null}
      </div>

      <p className="hidden text-center text-xs text-fg-subtle lg:block">
        <Kbd>Entrée</Kbd> pour vérifier, puis pour enchaîner.
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[0.7rem] text-fg-muted shadow-soft">
      {children}
    </kbd>
  );
}

function Summary({
  title,
  backHref,
  cardsHref,
  stats,
  total,
}: {
  title: string;
  backHref: string;
  cardsHref: string;
  stats: { correct: number; miss: number };
  total: number;
}) {
  const attempts = stats.correct + stats.miss;
  const accuracy = attempts === 0 ? 0 : Math.round((stats.correct / attempts) * 100);

  return (
    <div className="mx-auto max-w-md animate-slide-up text-center">
      <div className="mx-auto mb-6 grid size-20 animate-pop place-items-center rounded-3xl bg-success/12 text-success">
        <Trophy className="size-10" />
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">Série terminée</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Tu as écrit les {total} réponse{total > 1 ? "s" : ""} de « {toPlainText(title)} ».
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Justes" value={stats.correct} tone="text-success" />
        <Stat label="Ratées" value={stats.miss} tone="text-danger" />
        <Stat label="Réussite" value={`${accuracy} %`} />
      </dl>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="secondary">
          <Link href={backHref}>Retour</Link>
        </Button>
        <Button asChild>
          <Link href={cardsHref}>
            <RotateCcw />
            Mode cartes
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4 shadow-soft">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", tone)}>{value}</dd>
    </div>
  );
}
