"use client";

import * as React from "react";
import Link from "next/link";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
} from "motion/react";
import { Check, Expand, RotateCcw, Trophy, Undo2, X } from "lucide-react";

import { AnswerView } from "@/components/answer-view";
import { Confetti } from "@/components/confetti";
import { StudyHeader } from "@/components/study-header";
import { StudyOptions } from "@/components/study-options";
import { RichText, toPlainText } from "@/components/rich-text";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { reorderQueue, type StudyOrder } from "@/lib/study-order";
import { facesOf, type CardFaces, type StudySide } from "@/lib/study-side";
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
  extraOptions,
  title,
  backHref,
  replayHref,
  cards,
  deckOrder,
  order: initialOrder,
  side: initialSide,
}: {
  // Nul pour la révision d'un dossier entier : les cartes viennent alors de
  // plusieurs paquets, et aucune session ne se rattache à l'un d'eux.
  deckId: string | null;
  /**
   * Réglages propres à la page appelante — le choix du mode, par exemple.
   * Rendus par le serveur puis placés dans la feuille d'options : la surface
   * de révision occupe tout l'écran, ce qui resterait au-dessus d'elle serait
   * simplement recouvert.
   */
  extraOptions?: React.ReactNode;
  title: string;
  backHref: string;
  replayHref: string;
  /** Déjà triées côté serveur selon `order` : le mélange ne peut pas être
   *  refait à l'hydratation sans afficher une autre carte que le serveur. */
  cards: StudyCard[];
  /** Identifiants dans l'ordre du paquet, pour pouvoir y revenir. */
  deckOrder: string[];
  order: StudyOrder;
  side: StudySide;
}) {
  const [queue, setQueue] = React.useState<StudyCard[]>(cards);
  const [order, setOrder] = React.useState<StudyOrder>(initialOrder);
  const [side, setSide] = React.useState<StudySide>(initialSide);
  const [flipped, setFlipped] = React.useState(false);
  const [stats, setStats] = React.useState({ correct: 0, miss: 0 });
  const [exitDirection, setExitDirection] = React.useState(0);
  // Tant que la visionneuse est ouverte, les flèches lui appartiennent :
  // sans ça, zoomer sur un schéma répondrait à la carte en arrière-plan.
  const [lightboxOpen, setLightboxOpen] = React.useState(false);
  // Pile des cartes déjà jouées, pour pouvoir revenir sur la dernière.
  const [history, setHistory] = React.useState<
    { card: StudyCard; knew: boolean }[]
  >([]);

  const current = queue[0];
  const done = stats.correct + stats.miss;
  const answeredRight = stats.correct;
  const progress =
    cards.length === 0 ? 0 : (answeredRight / cards.length) * 100;

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
    setQueue((q) => [
      last.card,
      ...(last.knew ? q : q.filter((c) => c.id !== last.card.id)),
    ]);
    setFlipped(false);
  }, [history]);

  // Enregistre la session une seule fois, quand la file se vide.
  React.useEffect(() => {
    if (queue.length > 0 || done === 0 || finishedRef.current) return;
    finishedRef.current = true;
    // La progression par carte est enregistrée au fil de l'eau dans tous les
    // cas ; seul l'historique de session suppose un paquet identifié.
    if (deckId) void finishSession(deckId, stats.correct, stats.miss);
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

  function changeSide(next: StudySide) {
    setSide(next);
    // Sans cela, une carte retournée montrerait d'un coup l'autre face : on
    // repart de la question, qui vient de changer de contenu.
    setFlipped(false);
  }

  function changeOrder(next: StudyOrder) {
    setOrder(next);
    // On réorganise ce qui reste, sans revenir sur les cartes déjà répondues
    // ni remplacer celle qui est affichée.
    setQueue((current) => reorderQueue(current, deckOrder, next));
  }

  if (!current) {
    return (
      <Summary
        title={title}
        backHref={backHref}
        replayHref={replayHref}
        stats={stats}
        total={cards.length}
      />
    );
  }

  const faces = facesOf(current, side);
  const isLong = faces.answer.length > LONG_ANSWER;
  // Une carte ratée retourne en fin de file : compter les réponses données
  // dépasserait le total. On compte donc ce qui est réellement sorti de la file.
  const position = Math.min(cards.length - queue.length + 1, cards.length);

  return (
    /*
     * Surface plein écran, et non un bloc dans le flux de la page.
     *
     * La carte avait une hauteur fixe qui ignorait tout ce qui l'entourait :
     * mesuré, le contenu dépassait de 70 à 227 px selon l'appareil, et il
     * fallait faire défiler pour atteindre les réglages. Ici la hauteur est
     * bornée par l'écran et c'est la carte qui absorbe la place restante :
     * le débordement devient impossible, quel que soit le bandeau au-dessus.
     *
     * Les encoches sont prises en compte en ajoutant la zone sûre à la marge
     * plutôt qu'en la remplaçant, sinon la marge disparaît sur les écrans qui
     * n'en déclarent pas.
     */
    <div
      className={cn(
        "fixed inset-0 z-20 flex flex-col gap-3 bg-surface px-4 sm:gap-4 sm:px-6",
        "pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-[calc(env(safe-area-inset-bottom)+1rem)]",
      )}
    >
      <div className="mx-auto w-full max-w-xl shrink-0 sm:max-w-2xl">
        <StudyHeader
          backHref={backHref}
          position={position}
          total={cards.length}
          known={answeredRight}
          progress={progress}
          options={
            <StudyOptions
              side={side}
              order={order}
              onSideChange={changeSide}
              onOrderChange={changeOrder}
              replayHref={replayHref}
              extra={extraOptions}
            />
          }
        />
      </div>

      {/* `min-h-0` est indispensable : sans lui, un enfant de colonne flexible
          refuse de descendre sous sa hauteur de contenu et déborde à nouveau.
          Le plafond évite qu'une carte de trois mots ne s'étire en colonne sur
          un écran très haut ; c'est un maximum, jamais une hauteur imposée, la
          garantie de tenir dans l'écran reste donc entière. */}
      <div className="flex min-h-0 w-full flex-1 items-center justify-center">
        <div className="perspective relative h-full max-h-[44rem] w-full max-w-xl select-none sm:max-w-2xl">
          {/* Deux cartes fantômes derrière, pour montrer qu'il reste une pile. */}
          {queue.slice(1, 3).map((card, index) => (
            <div
              key={card.id}
              aria-hidden
              className="absolute inset-x-0 top-0 h-full rounded-2xl border border-outline-variant bg-surface-container elevation-1"
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
              // Le sens fait partie de la clé : changer de face doit remonter
              // une carte neuve, sinon l'ancienne garderait son animation de
              // retournement en cours.
              key={`${current.id}-${history.length}-${side}`}
              faces={faces}
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
      </div>

      <div className="mx-auto flex w-full max-w-xl shrink-0 items-center gap-2 sm:max-w-2xl sm:gap-3">
        <Button
          variant="outlined"
          size="icon"
          onClick={undo}
          disabled={history.length === 0}
          aria-label="Annuler la dernière réponse"
          title="Annuler (Z)"
          className="shrink-0"
        >
          <Undo2 />
        </Button>

        <Button
          variant="error"
          size="lg"
          className="flex-1"
          title="À revoir (←)"
          onClick={() => answer(false)}
        >
          <X />À revoir
        </Button>
        <Button
          variant="success"
          size="lg"
          className="flex-1"
          title="Je savais (→)"
          onClick={() => answer(true)}
        >
          <Check />
          Je savais
        </Button>
      </div>
    </div>
  );
}

// Une carte glissable. Elle détient SES propres valeurs de mouvement : une
// valeur partagée par le parent était écrite par l'animation de sortie de la
// carte précédente, qui entraînait donc la suivante avec elle.
function SwipeCard({
  faces,
  flipped,
  isLong,
  exitDirection,
  enterDirection,
  onFlip,
  onAnswer,
  onLightboxChange,
}: {
  faces: CardFaces;
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
          Math.abs(info.offset.x) > SWIPE_DISTANCE ||
          Math.abs(info.velocity.x) > SWIPE_VELOCITY;
        if (passed) onAnswer(info.offset.x > 0);
      }}
      initial={
        enterDirection
          ? {
              x: enterDirection * away,
              rotate: enterDirection * 18,
              opacity: 0,
            }
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
        faces={faces}
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
            className="pointer-events-none absolute left-6 top-6 -rotate-12 rounded-2xl border-[3px] border-success bg-surface-container-container/80 px-4 py-2 text-base font-bold uppercase tracking-wide text-success backdrop-blur-sm"
          >
            Je savais
          </motion.div>
          <motion.div
            style={{ opacity: reviewGlow }}
            className="pointer-events-none absolute right-6 top-6 rotate-12 rounded-2xl border-[3px] border-error bg-surface-container-container/80 px-4 py-2 text-base font-bold uppercase tracking-wide text-error backdrop-blur-sm"
          >
            À revoir
          </motion.div>
        </>
      ) : null}
    </motion.div>
  );
}

function FlipCard({
  faces,
  flipped,
  isLong,
  onFlip,
  onLightboxChange,
}: {
  faces: CardFaces;
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
        {/* En sens inverse, la question est la définition : elle peut être
            longue et venir avec son image. On la rend donc comme une réponse,
            défilement compris, plutôt qu'en gros titre. */}
        {faces.questionImage || faces.question.length > LONG_ANSWER ? (
          <div className="scroll-slim w-full overflow-y-auto overscroll-contain">
            <AnswerView
              showcase
              definition={faces.question}
              imagePath={faces.questionImage}
              onLightboxChange={onLightboxChange}
            />
          </div>
        ) : (
          <RichText className="text-balance text-center m3-headline-medium sm:m3-display-small">
            {faces.question}
          </RichText>
        )}
        <p className="mt-7 m3-body-small text-on-surface-variant">
          Touche la carte pour voir la réponse
        </p>
      </Face>

      {/* Verso : la réponse, tournée à 180° et masquée tant qu'on est de face. */}
      <Face
        onClick={onFlip}
        label="Réponse"
        className="[transform:rotateY(180deg)]"
      >
        <div
          className={cn(
            "scroll-slim w-full overflow-y-auto overscroll-contain",
            !faces.answerImage && "flex flex-col justify-center",
          )}
        >
          <AnswerView
            showcase
            definition={faces.answer}
            imagePath={faces.answerImage}
            onLightboxChange={onLightboxChange}
          />
        </div>

        {isLong ? (
          <Dialog>
            <DialogTrigger asChild>
              <Button
                variant="outlined"
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
            <DialogContent title={toPlainText(faces.question)}>
              <AnswerView
                definition={faces.answer}
                imagePath={faces.answerImage}
              />
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
        "rounded-2xl border border-outline-variant bg-surface-container p-6 elevation-3 sm:p-8",
        className,
      )}
    >
      <span className="absolute left-6 top-5 text-[0.7rem] font-semibold uppercase tracking-[0.12em] text-on-surface-variant">
        {label}
      </span>
      <div className="flex max-h-full w-full flex-col items-center justify-center overflow-hidden pt-7">
        {children}
      </div>
    </div>
  );
}

function Summary({
  title,
  backHref,
  replayHref,
  stats,
  total,
}: {
  title: string;
  backHref: string;
  replayHref: string;
  stats: { correct: number; miss: number };
  total: number;
}) {
  const attempts = stats.correct + stats.miss;
  const accuracy =
    attempts === 0 ? 0 : Math.round((stats.correct / attempts) * 100);

  return (
    <div className="mx-auto max-w-md animate-slide-up text-center">
      <Confetti />
      <div className="mx-auto mb-6 grid size-20 animate-pop place-items-center rounded-3xl bg-success-container/12 text-success">
        <Trophy className="size-10" />
      </div>

      <h1 className="m3-headline-large">Paquet terminé</h1>
      <p className="mt-1 m3-body-medium text-on-surface-variant">
        Tu as passé les {total} carte{total > 1 ? "s" : ""} de « {title} ».
      </p>

      <dl className="mt-6 grid grid-cols-3 gap-3">
        <Stat label="Sues" value={stats.correct} tone="text-success" />
        <Stat label="Ratées" value={stats.miss} tone="text-error" />
        <Stat label="Réussite" value={`${accuracy}%`} />
      </dl>

      <div className="mt-8 flex flex-col gap-2 sm:flex-row sm:justify-center">
        <Button asChild variant="outlined">
          <Link href={backHref}>Retour</Link>
        </Button>
        <Button asChild>
          {/* `all=1` force une passe complète : sans ça, toutes les cartes étant
              désormais « sues », la session repartirait vide. */}
          <Link href={replayHref}>
            <RotateCcw />
            Tout revoir
          </Link>
        </Button>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: React.ReactNode;
  tone?: string;
}) {
  return (
    <div className="rounded-xl border border-outline-variant bg-surface-container p-4 elevation-1">
      <dt className="m3-body-small text-on-surface-variant">{label}</dt>
      <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>
        {value}
      </dd>
    </div>
  );
}
