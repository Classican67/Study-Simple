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

  // Direction de sortie de la carte qui part, et d'entrée de celle qui arrive.
  // L'annulation a besoin des deux : la carte rappelée doit revenir par le côté
  // où elle était partie, et celle du dessus se retirer sans rejouer un verdict.
  const [enterDirection, setEnterDirection] = React.useState(0);

  const finishedRef = React.useRef(false);

  const answer = React.useCallback(
    (knew: boolean) => {
      const card = queue[0];
      if (!card) return;

      setExitDirection(knew ? 1 : -1);
      setEnterDirection(0);
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
    },
    [queue],
  );

  const undo = React.useCallback(() => {
    const last = history.at(-1);
    if (!last) return;

    // Sans cela, la carte du dessus rejouerait la direction de la dernière
    // réponse : une annulation ressemblait à une bonne réponse de plus.
    setExitDirection(0);
    setEnterDirection(last.knew ? 1 : -1);

    setHistory((h) => h.slice(0, -1));
    setStats((s) => ({
      correct: s.correct - (last.knew ? 1 : 0),
      miss: s.miss - (last.knew ? 0 : 1),
    }));
    // La carte ratée avait été renvoyée en fin de file : on l'en retire avant
    // de la remettre en tête, sinon elle apparaîtrait deux fois.
    setQueue((q) => [last.card, ...(last.knew ? q : q.filter((c) => c.id !== last.card.id))]);
    setFlipped(false);
  }, [history]);

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
    <div className="mx-auto flex min-h-[calc(100dvh-11rem)] w-full max-w-xl flex-col gap-4 sm:max-w-2xl sm:gap-5">
      <div className="space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="font-display text-2xl font-semibold tabular-nums">
            {answeredRight}
            <span className="text-base font-normal text-fg-subtle">/{cards.length}</span>
          </span>
          <span className="text-sm tabular-nums text-fg-muted">
            {queue.length} restante{queue.length > 1 ? "s" : ""}
          </span>
        </div>
        <ProgressBar value={progress} />
      </div>

      {/* Hauteur relative au viewport : la carte remplit l'écran d'un téléphone
          sans déborder, et reste confortable sur iPad. Les bornes évitent
          l'aplatissement en paysage et l'étirement sur grand écran. */}
      <div className="perspective relative my-auto h-[clamp(20rem,58dvh,32rem)] select-none sm:h-[clamp(24rem,60dvh,40rem)]">
        {/* Deux cartes fantômes derrière, pour montrer qu'il reste une pile. */}
        {queue.slice(1, 3).map((card, index) => (
          <div
            key={card.id}
            aria-hidden
            className="absolute inset-x-0 top-0 h-full rounded-panel border border-border bg-surface shadow-soft"
            style={{
              transform: `translateY(${(index + 1) * 10}px) scale(${1 - (index + 1) * 0.03})`,
              opacity: 1 - (index + 1) * 0.35,
            }}
          />
        ))}

        <AnimatePresence initial={false}>
          {/* La clé change à chaque réponse ET à chaque annulation : Motion
              démonte l'ancienne carte et en monte une neuve, qui possède donc
              ses propres valeurs de mouvement. */}
          <SwipeCard
            key={`${current.id}-${history.length}`}
            card={current}
            flipped={flipped}
            isLong={isLong}
            exitDirection={exitDirection}
            enterDirection={enterDirection}
            onFlip={() => setFlipped((f) => !f)}
            onAnswer={answer}
            onLightboxChange={setLightboxOpen}
          />
        </AnimatePresence>
      </div>

      <div className="pb-safe flex items-center gap-2 sm:gap-3">
        <Button
          variant="secondary"
          size="icon"
          onClick={undo}
          disabled={history.length === 0}
          aria-label="Annuler la dernière réponse"
          title="Annuler (Z)"
          className="shrink-0"
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

      {/* Les raccourcis n'existent qu'au clavier : inutile de les afficher sur
          un appareil tactile, où ils n'occuperaient que de la place. */}
      <p className="hidden text-center text-xs text-fg-subtle lg:block">
        Glisse la carte, ou <Kbd>←</Kbd> <Kbd>→</Kbd> pour répondre, <Kbd>Espace</Kbd> pour
        retourner, <Kbd>Z</Kbd> pour annuler.
      </p>
    </div>
  );
}

// Une carte glissable. Elle détient SES propres valeurs de mouvement : une
// valeur partagée par le parent était écrite par l'animation de sortie de la
// carte précédente, qui entraînait donc la suivante avec elle.
function SwipeCard({
  card,
  flipped,
  isLong,
  exitDirection,
  enterDirection,
  onFlip,
  onAnswer,
  onLightboxChange,
}: {
  card: StudyCard;
  flipped: boolean;
  isLong: boolean;
  exitDirection: number;
  enterDirection: number;
  onFlip: () => void;
  onAnswer: (knew: boolean) => void;
  onLightboxChange: (open: boolean) => void;
}) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-240, 240], [-14, 14]);
  const knownGlow = useTransform(x, [40, 160], [0, 1]);
  const reviewGlow = useTransform(x, [-160, -40], [1, 0]);

  // Les tampons appartiennent au geste, pas aux animations : sans ce drapeau,
  // « Je savais » s'affichait aussi pendant une annulation.
  const [dragging, setDragging] = React.useState(false);

  const away = 420;

  return (
    <motion.div
      className="absolute inset-0 cursor-grab active:cursor-grabbing"
      // `pan-y` laisse le doigt faire défiler la page verticalement tout en
      // réservant l'horizontale au glissement de réponse. Sans cela, le
      // navigateur et Motion se disputent le geste.
      style={{ x, rotate, touchAction: "pan-y" }}
      drag="x"
      dragElastic={0.6}
      dragConstraints={{ left: 0, right: 0 }}
      onDragStart={() => setDragging(true)}
      onDragEnd={(_, info) => {
        setDragging(false);
        const passed =
          Math.abs(info.offset.x) > SWIPE_DISTANCE || Math.abs(info.velocity.x) > SWIPE_VELOCITY;
        if (passed) onAnswer(info.offset.x > 0);
      }}
      initial={
        enterDirection
          ? { x: enterDirection * away, rotate: enterDirection * 18, opacity: 0 }
          : { x: 0, scale: 0.96, opacity: 0 }
      }
      animate={{ x: 0, rotate: 0, scale: 1, opacity: 1 }}
      exit={
        exitDirection
          ? {
              x: exitDirection * away,
              rotate: exitDirection * 18,
              opacity: 0,
              transition: { duration: 0.22 },
            }
          : // Annulation : la carte du dessus se retire sur place, sans verdict.
            { scale: 0.94, opacity: 0, transition: { duration: 0.18 } }
      }
    >
      <FlipCard
        card={card}
        flipped={flipped}
        isLong={isLong}
        onFlip={onFlip}
        onLightboxChange={onLightboxChange}
      />

      {/* Verdict qui se révèle au glissement, avant même de lâcher. */}
      {dragging ? (
        <>
          <motion.div
            style={{ opacity: knownGlow }}
            className="pointer-events-none absolute left-6 top-6 -rotate-12 rounded-2xl border-[3px] border-success bg-surface/80 px-4 py-2 font-display text-base font-bold uppercase tracking-wide text-success backdrop-blur-sm"
          >
            Je savais
          </motion.div>
          <motion.div
            style={{ opacity: reviewGlow }}
            className="pointer-events-none absolute right-6 top-6 rotate-12 rounded-2xl border-[3px] border-danger bg-surface/80 px-4 py-2 font-display text-base font-bold uppercase tracking-wide text-danger backdrop-blur-sm"
          >
            À revoir
          </motion.div>
        </>
      ) : null}
    </motion.div>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded-md border border-border bg-surface px-1.5 py-0.5 font-mono text-[0.7rem] text-fg-muted shadow-soft">
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
        <RichText className="text-balance text-center font-display text-2xl font-semibold leading-tight sm:text-3xl">
          {card.term}
        </RichText>
        <p className="mt-7 text-xs text-fg-subtle">Touche la carte pour voir la réponse</p>
      </Face>

      {/* Verso : la réponse, tournée à 180° et masquée tant qu'on est de face. */}
      <Face onClick={onFlip} label="Réponse" className="[transform:rotateY(180deg)]">
        <div className="scroll-slim w-full overflow-y-auto overscroll-contain">
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
        "rounded-panel border border-border bg-surface p-6 shadow-card sm:p-8",
        className,
      )}
    >
      <span className="absolute left-6 top-5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-fg-subtle">
        {label}
      </span>
      <div className="flex max-h-full w-full flex-col items-center justify-center overflow-hidden pt-7">
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
      <div className="mx-auto mb-6 grid size-20 animate-pop place-items-center rounded-3xl bg-success/12 text-success">
        <Trophy className="size-10" />
      </div>

      <h1 className="text-3xl font-semibold tracking-tight">Paquet terminé</h1>
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
    <div className="rounded-card border border-border bg-surface p-4 shadow-soft">
      <dt className="text-xs text-fg-subtle">{label}</dt>
      <dd className={cn("mt-1 font-display text-2xl font-semibold tabular-nums", tone)}>{value}</dd>
    </div>
  );
}
