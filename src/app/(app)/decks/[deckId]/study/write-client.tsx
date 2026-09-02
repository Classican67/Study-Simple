"use client";

import * as React from "react";
import Link from "next/link";
import { Check, CircleHelp, RotateCcw, ThumbsUp, Trophy, X } from "lucide-react";

import { AnswerView } from "@/components/answer-view";
import { Confetti } from "@/components/confetti";
import { StudyOrderSwitch } from "@/components/study-order-switch";
import { StudySideSwitch } from "@/components/study-side-switch";
import { RichText, toPlainText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { ProgressBar } from "@/components/ui/panel";
import { checkAnswer, type AnswerVerdict } from "@/lib/answer-check";
import { reorderQueue, type StudyOrder } from "@/lib/study-order";
import { facesOf, type StudySide } from "@/lib/study-side";
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
  deckOrder,
  order: initialOrder,
  side: initialSide,
}: {
  deckId: string | null;
  title: string;
  backHref: string;
  /** Déjà triées côté serveur selon `order`. */
  cards: StudyCard[];
  /** Retour au mode cartes, en conservant le paquet. */
  cardsHref: string;
  /** Identifiants dans l'ordre du paquet, pour pouvoir y revenir. */
  deckOrder: string[];
  order: StudyOrder;
  side: StudySide;
}) {
  const [queue, setQueue] = React.useState(cards);
  const [order, setOrder] = React.useState<StudyOrder>(initialOrder);
  const [side, setSide] = React.useState<StudySide>(initialSide);
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

    const result = checkAnswer(typed, facesOf(current, side).answer);
    setVerdict(result);

    // Réponse juste : on enchaîne tout seul, le temps de voir la confirmation.
    if (result !== "wrong") {
      window.setTimeout(() => advance(true), result === "exact" ? 650 : 1100);
    }
  }

  function changeOrder(next: StudyOrder) {
    setOrder(next);
    setQueue((current) => reorderQueue(current, deckOrder, next));
  }

  function changeSide(next: StudySide) {
    setSide(next);
    // La question change de contenu : une réponse déjà tapée ou déjà jugée
    // ne veut plus rien dire.
    setTyped("");
    setVerdict(null);
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
  const faces = facesOf(current, side);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-2xl font-semibold tabular-nums">
            {stats.correct}
            <span className="text-base font-normal text-on-surface-variant">/{cards.length}</span>
          </span>
          <span className="text-sm tabular-nums text-on-surface-variant">
            {queue.length} restante{queue.length > 1 ? "s" : ""}
          </span>
        </div>
        <ProgressBar value={progress} />
      </div>

      <div className="rounded-2xl border border-outline-variant bg-surface-container p-6 elevation-3 sm:p-8">
        <span className="text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
          Question
        </span>
        <RichText className="mt-4 text-balance text-center m3-headline-medium sm:m3-display-small">
          {faces.question}
        </RichText>

        {faces.questionImage ? (
          <div className="mt-5 flex justify-center">
            <AnswerView definition="" imagePath={faces.questionImage} compact />
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
              "h-12 w-full rounded-xl border bg-surface-container px-4 text-center text-base text-on-surface",
              "placeholder:text-on-surface-variant focus:outline-none focus:ring-2",
              verdict === null && "border-outline-variant focus:border-primary focus:ring-primary",
              verdict === "wrong" && "border-error text-error focus:ring-0",
              verdict !== null && verdict !== "wrong" && "border-success text-success focus:ring-0",
            )}
          />

          {!answered ? (
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outlined"
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
            <div className="rounded-xl border border-outline-variant bg-surface-container-high p-4">
              <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-error">
                <X className="size-3.5" />
                La réponse attendue
              </p>
              <AnswerView definition={faces.answer} imagePath={faces.answerImage} />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              {/* Indispensable : la comparaison ne reconnaît ni un synonyme ni
                  une formulation différente. Sans cette porte de sortie, le
                  mode devient punitif. */}
              <Button
                type="button"
                variant="outlined"
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

      <div className="flex flex-wrap items-center justify-center gap-2">
        <StudySideSwitch value={side} onChange={changeSide} />
        <StudyOrderSwitch value={order} onChange={changeOrder} />
      </div>

      <p className="hidden text-center m3-body-small text-on-surface-variant lg:block">
        <Kbd>Entrée</Kbd> pour vérifier, puis pour enchaîner.
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-outline-variant bg-surface-container px-1.5 py-0.5 font-mono text-[0.7rem] text-on-surface-variant elevation-1">
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
      <Confetti />
      <div className="mx-auto mb-6 grid size-20 animate-pop place-items-center rounded-3xl bg-success-container/12 text-success">
        <Trophy className="size-10" />
      </div>

      <h1 className="m3-headline-large">Série terminée</h1>
      <p className="mt-1 m3-body-medium text-on-surface-variant">
        Tu as écrit les {total} réponse{total > 1 ? "s" : ""} de « {toPlainText(title)} ».
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Justes" value={stats.correct} tone="text-success" />
        <Stat label="Ratées" value={stats.miss} tone="text-error" />
        <Stat label="Réussite" value={`${accuracy} %`} />
      </dl>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="outlined">
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
    <div className="rounded-xl border border-outline-variant bg-surface-container p-4 elevation-1">
      <dt className="m3-body-small text-on-surface-variant">{label}</dt>
      <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</dd>
    </div>
  );
}
