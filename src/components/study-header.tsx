"use client";

import Link from "next/link";
import { X } from "lucide-react";

import { FullscreenToggle } from "@/components/fullscreen-toggle";
import { ProgressBar } from "@/components/ui/panel";
import { cn } from "@/lib/utils";

/**
 * Bandeau de la révision.
 *
 * Trois informations sur une seule ligne : la sortie, où l'on en est, et les
 * réglages. Puis la barre de progression sur toute la largeur, et le décompte
 * des deux piles. Rien d'autre — c'est la carte qui doit occuper l'écran.
 */
export function StudyHeader({
  backHref,
  position,
  total,
  known,
  progress,
  options,
}: {
  backHref: string;
  /** Rang de la carte affichée, à partir de 1. */
  position: number;
  total: number;
  /** Cartes déjà mises de côté comme sues. */
  known: number;
  /** Avancement en pourcentage. */
  progress: number;
  /** La roue crantée et sa feuille de réglages. */
  options: React.ReactNode;
}) {
  const learning = Math.max(0, total - known);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Link
          href={backHref}
          aria-label="Quitter la révision"
          title="Quitter la révision"
          className="state-layer grid size-12 shrink-0 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface"
        >
          <X className="size-6" />
        </Link>

        <span className="flex-1 text-center m3-title-medium tabular-nums text-on-surface">
          {position} / {total}
        </span>

        <FullscreenToggle />
        {options}
      </div>

      <ProgressBar value={progress} />

      <div className="flex items-center justify-between gap-4">
        <Count value={learning} label="En cours" tone="learning" />
        <Count value={known} label="Acquis" tone="known" reversed />
      </div>
    </div>
  );
}

function Count({
  value,
  label,
  tone,
  reversed,
}: {
  value: number;
  label: string;
  tone: "learning" | "known";
  reversed?: boolean;
}) {
  const color = tone === "known" ? "text-success" : "text-tertiary";

  return (
    <div
      className={cn("flex items-center gap-2", reversed && "flex-row-reverse")}
    >
      <span
        className={cn(
          "grid size-9 place-items-center rounded-full border-2 tabular-nums m3-label-large",
          tone === "known"
            ? "border-success text-success"
            : "border-tertiary text-tertiary",
        )}
      >
        {value}
      </span>
      <span className={cn("m3-label-large", color)}>{label}</span>
    </div>
  );
}
