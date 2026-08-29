"use client";

import * as React from "react";
import Link from "next/link";
import { AnimatePresence, motion, useMotionValue, useTransform } from "motion/react";
import { Check, Expand, RotateCcw, Trophy, Undo2, X } from "lucide-react";

import { AnswerView } from "@/components/answer-view";
import { RichText, toPlainText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { ProgressBar } from "@/components/ui/panel";
import { cn } from "@/lib/utils";
import { finishSession, recordAnswer } from "./actions";

export type StudyCard = {
  id: string;
  term: string;
  definition: string;
  imagePath: string | null;
  status: string;
};

// Distance (px) ou vitesse (px/s) au-delà de laquelle un glissement compte
// comme une réponse. La vitesse permet un petit geste sec, la distance un
// glissement lent et appuyé.
const SWIPE_DISTANCE = 110;
const SWIPE_VELOCITY = 450;

// Une réponse trop longue pour la carte : on propose la modale.
const LONG_ANSWER = 260;

export function StudyClient({
  deckId,
  deckTitle,
  cards,
}: {
  deckId: string;
  deckTitle: string;
  cards: StudyCard[];
}) {
  const [queue, setQueue] = React.useState<StudyCard[]>(cards);
  const [flipped, setFlipped] = React.useState(false);
  const [stats, setStats] = React.useState({ correct: 0, miss: 0 });
  const [exitDirection, setExitDirection] = React.useState(0);
  // Tant que la visionneuse est ouverte, les flèches lui appartiennent :
  // sans ça, zoomer sur un schéma répondrait à la carte en arrière-plan.
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  // Pile des cartes déjà jouées, pour pouvoir revenir sur la dernière.
  const [history, setHistory] = React.useState<{ card: StudyCard; knew: boolean }[]>([]);

  const current = queue[0];
  const done = stats.correct + stats.miss;
  const answeredRight = stats.correct;
  const progress = cards.length === 0 ? 0 : (answeredRight / cards.length) * 100;

  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-14, 14]);
  const knownGlow = useTransform(x, [40, 160], [0, 1]);
  const reviewGlow = useTransform(x, [-160, -40], [1, 0]);

  const finishedRef = React.useRef(false);

  const answer = React.useCallback(
    (knew: boolean) => {
      const card = queue[0];
      if (!card) return;

      setExitDirection(knew ? 1 : -1);
      // Envoi sans attendre : l'animation ne doit pas dépendre du réseau.
      // Chaque réponse est persistée seule, donc rien n'est perdu si on quitte.
      void recordAnswer(card.id, knew);

      setStats((s) => ({
        correct: s.correct + (knew ? 1 : 0),
        miss: s.miss + (knew ? 0 : 1),
      }));
      setHistory((h) => [...h, { card, knew }]);

      // Une carte ratée retourne en fin de file : elle revient dans la même
      // session, ce qui est tout l'intérêt de la pile « à revoir ».
      setQueue((q) => (knew ? q.slice(1) : [...q.slice(1), card]));
      setFlipped(false);
      x.set(0);
    },
    [queue, x],
  );

  const undo = React.useCallback(() => {
    const last = history.at(-1);
    if (!last) return;

    setHistory((h) => h.slice(0, -1));
    setStats((s) => ({
      correct: s.correct - (last.knew ? 1 : 0),
      miss: s.miss - (last.knew ? 0 : 1),
    }));
    // La carte ratée avait été renvoyée en fin de file : on l'en retire avant
    // de la remettre en tête, sinon elle apparaîtrait deux fois.
    setQueue((q) => [last.card, ...(last.knew ? q : q.filter((c) => c.id !== last.card.id))]);
    setFlipped(false);
    x.set(0);
  }, [history, x]);

  // Enregistre la session une seule fois, quand la file se vide.
  React.useEffect(() => {
    if (queue.length > 0 || done === 0 || finishedRef.current) return;
    finishedRef.current = true;
    void finishSession(deckId, stats.correct, stats.miss);
  }, [queue.length, done, deckId, stats.correct, stats.miss]);

  // Raccourcis clavier : réviser au clavier est plus rapide qu'à la souris,
  // et c'est ce que fait Quizlet sur ordinateur.
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // Ne pas détourner les touches quand une modale ou un champ a le focus.
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [role='dialog']")) return;
      if (lightboxOpen || !current) return;

      if (event.key === " " || event.key === "Enter") {
        event.preventDefault();
        setFlipped((f) => !f);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        answer(true);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        answer(false);
      } else if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        undo();
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, undo, current, lightboxOpen]);

  if (!current) {
    return <Summary deckId={deckId} deckTitle={deckTitle} stats={stats} total={cards.length} />;
  }

  const isLong = current.definition.length > LONG_ANSWER;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between text-sm text-fg-muted">
          <span className="tabular-nums">
            {answeredRight}/{cards.length} sues
          </span>
          <span className="tabular-nums">
            {queue.length} restante{queue.length > 1 ? "s" : ""}
          </span>
        </div>
        <ProgressBar value={progress} />
      </div>

      <div className="perspective relative h-[440px] select-none">
        {/* Deux cartes fantômes derrière, pour montrer qu'il reste une pile. */}
        {queue.slice(1, 3).map((card, index) => (
          <div
            key={card.id}
            aria-hidden
            className="absolute inset-x-0 top-0 h-full rounded-card border border-border bg-surface"
            style={{
              transform: `translateY(${(index + 1) * 10}px) scale(${1 - (index + 1) * 0.03})`,
              opacity: 1 - (index + 1) * 0.35,
            }}
          />
        ))}

        <AnimatePresence initial={false}>
          <motion.div
            key={current.id + String(history.length)}
            className="absolute inset-0 cursor-grab active:cursor-grabbing"
            style={{ x, rotate }}
            drag="x"
            dragElastic={0.6}
            dragConstraints={{ left: 0, right: 0 }}
            onDragEnd={(_, info) => {
              const passed =
                Math.abs(info.offset.x) > SWIPE_DISTANCE ||
                Math.abs(info.velocity.x) > SWIPE_VELOCITY;
              if (passed) answer(info.offset.x > 0);
            }}
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{
              x: exitDirection * 420,
              opacity: 0,
              rotate: exitDirection * 18,
              transition: { duration: 0.22 },
            }}
          >
            <FlipCard
              card={current}
              flipped={flipped}
              isLong={isLong}
              onFlip={() => setFlipped((f) => !f)}
              onLightboxChange={setLightboxOpen}
            />

            {/* Verdict qui se révèle au glissement, avant même de lâcher. */}
            <motion.div
              style={{ opacity: knownGlow }}
              className="pointer-events-none absolute left-5 top-5 rounded-xl border-2 border-success px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-success"
            >
              Je savais
            </motion.div>
            <motion.div
              style={{ opacity: reviewGlow }}
              className="pointer-events-none absolute right-5 top-5 rounded-xl border-2 border-danger px-3 py-1.5 text-sm font-bold uppercase tracking-wide text-danger"
            >
              À revoir
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      <div className="flex items-center justify-center gap-3">
        <Button
          variant="secondary"
          size="icon"
          onClick={undo}
          disabled={history.length === 0}
          aria-label="Annuler la dernière réponse (Z)"
          title="Annuler (Z)"
        >
          <Undo2 />
        </Button>

        <Button variant="danger" size="lg" className="flex-1" onClick={() => answer(false)}>
          <X />
          À revoir
        </Button>
        <Button variant="success" size="lg" className="flex-1" onClick={() => answer(true)}>
          <Check />
          Je savais
        </Button>
      </div>

      <p className="text-center text-xs text-fg-muted">
        Glisse la carte, ou utilise <Kbd>←</Kbd> <Kbd>→</Kbd> pour répondre et <Kbd>Espace</Kbd>{" "}
        pour retourner.
      </p>
    </div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-surface-raised px-1.5 py-0.5 font-mono text-[0.7rem] text-fg">
      {children}
    </kbd>
  );
}

function FlipCard({
  card,
  flipped,
  isLong,
  onFlip,
  onLightboxChange,
}: {
  card: StudyCard;
  flipped: boolean;
  isLong: boolean;
  onFlip: () => void;
  onLightboxChange: (open: boolean) => void;
}) {
  return (
    <div
      className="preserve-3d relative h-full w-full transition-transform duration-500"
      style={{ transform: flipped ? "rotateY(180deg)" : "rotateY(0deg)" }}
    >
      {/* Recto : la question. */}
      <Face onClick={onFlip} label="Question">
        <RichText className="text-balance text-center text-xl font-medium leading-snug">
          {card.term}
        </RichText>
        <p className="mt-6 text-xs text-fg-muted">Touche la carte pour voir la réponse</p>
      </Face>

      {/* Verso : la réponse, tournée à 180° et masquée tant qu'on est de face. */}
      <Face onClick={onFlip} label="Réponse" className="[transform:rotateY(180deg)]">
        <div className="w-full overflow-y-auto overscroll-contain">
          <AnswerView
            definition={card.definition}
            imagePath={card.imagePath}
            onLightboxChange={onLightboxChange}
          />
        </div>

        {isLong ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="secondary"
                size="sm"
                className="mt-4 shrink-0"
                // Sans cela, le clic remonterait jusqu'à la carte et la retournerait.
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <Expand />
                Voir en entier
              </Button>
            </DialogTrigger>
            <DialogContent title={toPlainText(card.term)}>
              <AnswerView definition={card.definition} imagePath={card.imagePath} />
            </DialogContent>
          </Dialog>
        ) : null}
      </Face>
    </div>
  );
}

function Face({
  children,
  className,
  label,
  onClick,
}: {
  children: React.ReactNode;
  className?: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onClick}
      className={cn(
        "backface-hidden absolute inset-0 flex flex-col items-center justify-center",
        "rounded-card border border-border bg-surface p-6 shadow-lg",
        className,
      )}
    >
      <span className="absolute left-5 top-4 text-xs font-medium uppercase tracking-wide text-fg-muted">
        {label}
      </span>
      <div className="flex max-h-full w-full flex-col items-center justify-center overflow-hidden pt-6">
        {children}
      </div>
    </div>
  );
}

function Summary({
  deckId,
  deckTitle,
  stats,
  total,
}: {
  deckId: string;
  deckTitle: string;
  stats: { correct: number; miss: number };
  total: number;
}) {
  const attempts = stats.correct + stats.miss;
  const accuracy = attempts === 0 ? 0 : Math.round((stats.correct / attempts) * 100);

  return (
    <div className="mx-auto max-w-md animate-slide-up text-center">
      <div className="mx-auto mb-5 grid size-16 place-items-center rounded-2xl bg-success/15 text-success">
        <Trophy className="size-8" />
      </div>

      <h1 className="text-2xl font-semibold tracking-tight">Paquet terminé</h1>
      <p className="mt-1 text-sm text-fg-muted">
        Tu as passé les {total} carte{total > 1 ? "s" : ""} de « {deckTitle} ».
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Sues" value={stats.correct} tone="text-success" />
        <Stat label="Ratées" value={stats.miss} tone="text-danger" />
        <Stat label="Réussite" value={`${accuracy}%`} />
      </dl>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="secondary">
          <Link href={`/decks/${deckId}`}>Retour au paquet</Link>
        </Button>
        <Button asChild>
          {/* `all=1` force une passe complète : sans ça, toutes les cartes étant
              désormais « sues », la session repartirait vide. */}
          <Link href={`/decks/${deckId}/study?all=1`}>
            <RotateCcw />
            Tout revoir
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</dd>
    </div>
  );
}
