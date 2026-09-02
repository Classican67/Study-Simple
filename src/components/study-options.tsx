"use client";

import * as React from "react";
import Link from "next/link";
import { RotateCcw, Settings } from "lucide-react";

import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { STUDY_ORDER_COOKIE, type StudyOrder } from "@/lib/study-order";
import { STUDY_SIDE_COOKIE, type StudySide } from "@/lib/study-side";
import { cn } from "@/lib/utils";

/**
 * Réglages de la session, rassemblés derrière une roue crantée.
 *
 * Ils vivaient sous la carte, en sélecteurs à libellés : deux rangées de plus
 * à l'écran, qu'il fallait aller chercher en faisant défiler la page sur iPad.
 * Réunis ici, ils laissent la carte occuper tout l'espace, et gagnent au
 * passage la place d'être nommés — un interrupteur d'icône ne dit pas ce qu'il
 * fait tant qu'on ne l'a pas essayé.
 */
export function StudyOptions({
  side,
  order,
  onSideChange,
  onOrderChange,
  replayHref,
  extra,
}: {
  side: StudySide;
  order: StudyOrder;
  onSideChange: (side: StudySide) => void;
  onOrderChange: (order: StudyOrder) => void;
  /** Recommence la série entière, y compris les cartes déjà sues. */
  replayHref: string;
  /** Réglages propres à la page appelante — le choix du mode, par exemple. */
  extra?: React.ReactNode;
}) {
  function remember(name: string, value: string) {
    // Un an : c'est une préférence, pas une session.
    document.cookie = `${name}=${value}; path=/; max-age=31536000; samesite=lax`;
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="Options de révision"
          title="Options de révision"
          className="state-layer grid size-12 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <Settings className="size-6" />
        </button>
      </DialogTrigger>

      <DialogContent
        title="Options"
        description="Réglages de cette session de révision."
      >
        <div className="space-y-3">
          <Group>
            <Row
              label="Mélanger les cartes"
              hint="Sinon elles suivent l'ordre du paquet."
            >
              <Switch
                label="Mélanger les cartes"
                checked={order === "shuffle"}
                onChange={(on) => {
                  const next: StudyOrder = on ? "shuffle" : "deck";
                  remember(STUDY_ORDER_COOKIE, next);
                  onOrderChange(next);
                }}
              />
            </Row>
          </Group>

          <Group title="Configuration de la carte">
            <p className="m3-body-medium text-on-surface">Recto</p>
            <div
              role="group"
              aria-label="Face montrée en premier"
              className="mt-2 flex rounded-full bg-surface-container p-1"
            >
              <Segment
                active={side === "term"}
                label="Terme"
                onSelect={() => {
                  remember(STUDY_SIDE_COOKIE, "term");
                  onSideChange("term");
                }}
              />
              <Segment
                active={side === "definition"}
                label="Définition"
                onSelect={() => {
                  remember(STUDY_SIDE_COOKIE, "definition");
                  onSideChange("definition");
                }}
              />
            </div>
            <p className="mt-2 m3-body-small text-on-surface-variant">
              {side === "definition"
                ? "La définition est montrée en premier : à toi de retrouver le terme."
                : "Le terme est montré en premier : à toi de retrouver sa définition."}
            </p>
          </Group>

          {extra ? <Group title="Mode de révision">{extra}</Group> : null}

          {/* Action destructrice : à part, et de la couleur des erreurs. */}
          <Link
            href={replayHref}
            className="state-layer flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-surface-lowest px-4 m3-label-large text-error"
          >
            <RotateCcw className="size-4" />
            Recommencer la série
          </Link>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Group({
  title,
  children,
}: {
  title?: string;
  children: React.ReactNode;
}) {
  return (
    // `surface-lowest` et non `surface-container` : la feuille est déjà en
    // `surface-high`, deux paliers voisins ne se distinguaient pas. L'écart
    // fonctionne dans les deux thèmes, la teinte s'inversant avec eux.
    <section className="rounded-2xl bg-surface-lowest p-4">
      {title ? (
        <h3 className="mb-3 m3-title-small text-on-surface">{title}</h3>
      ) : null}
      {children}
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-12 items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="m3-body-large text-on-surface">{label}</p>
        {hint ? (
          <p className="mt-0.5 m3-body-small text-on-surface-variant">{hint}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

function Segment({
  active,
  label,
  onSelect,
}: {
  active: boolean;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "min-h-11 flex-1 rounded-full px-4 m3-label-large transition-colors",
        active
          ? "bg-primary text-on-primary elevation-1"
          : "text-on-surface-variant",
      )}
    >
      {label}
    </button>
  );
}
