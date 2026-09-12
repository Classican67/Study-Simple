"use client";

import * as React from "react";
import { Circle, Crosshair, Eraser, Highlighter, Lasso, Maximize2, Minus as LineIcon, Pen, PenOff, Redo2, Ruler as RulerIcon, Scissors, Shapes, Square as RectIcon, Trash2, Undo2, X } from "lucide-react";

import { rulerDegrees, SHAPES, type Ruler, type Shape } from "@/lib/ink";
import { PAPERS, type Paper } from "@/lib/notes";
import { cn } from "@/lib/utils";
import type { InkTool } from "@/components/note/ink-canvas";

/**
 * Barre d'outils de la page manuscrite.
 *
 * Elle tenait sur une seule rangée plate : outil, six couleurs, trois
 * épaisseurs, quatre papiers, règle, annulation, plein écran — une vingtaine de
 * commandes de même poids, qui formaient un mur sur téléphone.
 *
 * Deux rangées désormais, et une hiérarchie : **ce qu'on fait** en haut, **avec
 * quoi** en dessous. La seconde rangée ne montre que les réglages de l'outil
 * courant, et disparaît pour ceux qui n'en ont pas. C'est le fonctionnement des
 * applications de référence, et la raison en est simple : on change d'outil bien
 * plus souvent qu'on ne change ses réglages.
 */

export const INKS = [
  { name: "default", label: "Encre" },
  { name: "rose", label: "Rouge" },
  { name: "amber", label: "Orange" },
  { name: "emerald", label: "Vert" },
  { name: "blue", label: "Bleu" },
  { name: "violet", label: "Violet" },
] as const;

const SIZES = [
  { size: 1.2, label: "Fin" },
  { size: 2.5, label: "Moyen" },
  { size: 5, label: "Épais" },
];

const HIGHLIGHTER_SIZES = [
  { size: 2, label: "Fin" },
  { size: 4, label: "Moyen" },
  { size: 6, label: "Épais" },
];

const PAPER_LABELS: Record<Paper, { label: string; icon: React.ElementType }> = {
  blank: { label: "Uni", icon: RectIcon },
  ruled: { label: "Lignes", icon: LineIcon },
  grid: { label: "Carreaux", icon: Crosshair },
  dots: { label: "Points", icon: Circle },
};

const SHAPE_ICONS: Record<Shape, { label: string; icon: React.ElementType }> = {
  line: { label: "Ligne", icon: LineIcon },
  rect: { label: "Rectangle", icon: RectIcon },
  ellipse: { label: "Ellipse", icon: Circle },
};

/** Réglages propres à un outil d'écriture. */
export type InkSettings = { color: string; size: number };

export type PaletteProps = {
  tool: InkTool;
  /** Réglages du stylo et du surligneur, retenus séparément. */
  pen: InkSettings;
  highlighter: InkSettings;
  shape: Shape;
  paper: Paper;
  /** La gomme ne retire-t-elle que les surlignages ? */
  eraseHighlightsOnly: boolean;
  erasePrecise: boolean;
  /** Le doigt n'écrit jamais, même avant qu'un stylet ait servi. */
  penOnly: boolean;
  penDetected: boolean;
  selection: number;
  zoom: number;
  full: boolean;
  hasBackdrop: boolean;
  onTool: (tool: InkTool) => void;
  onSettings: (next: InkSettings) => void;
  onShape: (shape: Shape) => void;
  onPaper: (paper: Paper) => void;
  onEraseHighlightsOnly: (value: boolean) => void;
  onErasePrecise: (value: boolean) => void;
  onPenOnly: (value: boolean) => void;
  onDeleteSelection: () => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onResetView: () => void;
  onToggleFull: () => void;
  ruler: Ruler | null;
  onToggleRuler: () => void;
};

export function InkPalette(props: PaletteProps) {
  const {
    tool,
    pen,
    highlighter,
    shape,
    paper,
    eraseHighlightsOnly,
    erasePrecise,
    penOnly,
    penDetected,
    selection,
    zoom,
    full,
    hasBackdrop,
    ruler,
  } = props;

  const ecrit = tool === "pen" || tool === "highlighter" || tool === "shape";
  const reglages = tool === "highlighter" ? highlighter : pen;
  const tailles = tool === "highlighter" ? HIGHLIGHTER_SIZES : SIZES;

  return (
    <div
      role="toolbar"
      aria-label="Outils d'écriture"
      className={cn(
        "flex flex-col gap-1",
        // En plein écran, la barre flotte au-dessus de la feuille, à portée du
        // pouce, avec la zone sûre des encoches.
        full &&
          "pb-safe shrink-0 border-t border-outline-variant bg-surface-container px-2 py-1.5 elevation-3",
      )}
    >
      {/* --- Ce qu'on fait ---------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-0.5">
        <Group label="Outil">
          <Tool active={tool === "pen"} onClick={() => props.onTool("pen")} icon={Pen} label="Stylo" />
          <Tool
            active={tool === "highlighter"}
            onClick={() => props.onTool("highlighter")}
            icon={Highlighter}
            label="Surligneur"
          />
          <Tool active={tool === "eraser"} onClick={() => props.onTool("eraser")} icon={Eraser} label="Gomme" />
          <Tool active={tool === "lasso"} onClick={() => props.onTool("lasso")} icon={Lasso} label="Lasso" />
          <Tool active={tool === "shape"} onClick={() => props.onTool("shape")} icon={Shapes} label="Formes" />
          <Tool
            active={Boolean(ruler)}
            onClick={props.onToggleRuler}
            icon={RulerIcon}
            label={ruler ? "Ranger la règle" : "Poser la règle"}
          />
        </Group>

        {/* L'angle de la règle : c'est le propre d'une règle qu'on puisse
            l'aligner sur une valeur franche. */}
        {ruler ? (
          <span
            className="ml-1 rounded-full bg-surface-container px-2 py-1 m3-label-small tabular-nums text-on-surface-variant"
            title="Glisse la règle du doigt pour la déplacer, saisis-la par un bout pour l'orienter. Le stylet, lui, écrit le long du bord."
          >
            {rulerDegrees(ruler)}°
          </span>
        ) : null}

        {/* Pastille de l'encre courante : on voit avec quoi on écrit sans
            déplier les réglages. */}
        {ecrit ? (
          <span
            aria-hidden
            className="mx-1 size-5 shrink-0 rounded-full ring-2 ring-outline-variant"
            style={{ backgroundColor: `var(--ink-${reglages.color})` }}
          />
        ) : null}

        <div className="ml-auto flex items-center gap-0.5">
          {Math.abs(zoom - 1) > 0.01 ? (
            <button
              type="button"
              onClick={props.onResetView}
              title="Revenir à la taille d'origine"
              aria-label={`Zoom ${Math.round(zoom * 100)} %. Revenir à la taille d'origine`}
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface-container px-3 m3-label-small tabular-nums text-on-surface-variant transition-colors hover:text-on-surface"
            >
              <Crosshair className="size-3.5" />
              {Math.round(zoom * 100)} %
            </button>
          ) : null}

          {/* Le rejet de la paume est invisible : le doigt cesse d'écrire sans
              rien dire. L'état est donc **écrit**, pas seulement suggéré par une
              icône teintée — sur une tablette il n'y a pas de survol pour lire
              une infobulle. */}
          {penOnly || penDetected ? (
            <button
              type="button"
              onClick={() => props.onPenOnly(!penOnly)}
              aria-pressed={penOnly}
              aria-label={
                penOnly ? "Le doigt n'écrit pas — rétablir" : "Stylet détecté : le doigt fait défiler"
              }
              title={
                penOnly
                  ? "Le doigt n'écrit pas. Toucher pour le rétablir."
                  : "Un stylet a été détecté : le doigt fait défiler, pour que la paume ne marque pas la page."
              }
              className="flex min-h-11 items-center gap-1.5 rounded-full bg-primary-container px-3 m3-label-small text-on-primary-container"
            >
              <Pen className="size-3.5" />
              Stylet
            </button>
          ) : (
            <Tool
              onClick={() => props.onPenOnly(true)}
              icon={PenOff}
              label="Empêcher le doigt d'écrire"
            />
          )}
          <Tool onClick={props.onUndo} icon={Undo2} label="Annuler le dernier trait" />
          <Tool onClick={props.onRedo} icon={Redo2} label="Rétablir le trait annulé" />
          <Tool onClick={props.onClear} icon={Trash2} label="Effacer toute la page" danger />
          <Tool
            onClick={props.onToggleFull}
            icon={full ? X : Maximize2}
            label={full ? "Quitter le plein écran" : "Écrire en plein écran"}
            active={full}
          />
        </div>
      </div>

      {/* --- Avec quoi ---------------------------------------------------- */}
      <div className="flex flex-wrap items-center gap-0.5 border-t border-outline-variant/60 pt-1">
        {ecrit ? (
          <>
            <Group label="Couleur">
              {INKS.map((entry) => (
                <button
                  key={entry.name}
                  type="button"
                  onClick={() => props.onSettings({ ...reglages, color: entry.name })}
                  aria-label={entry.label}
                  aria-pressed={reglages.color === entry.name}
                  title={entry.label}
                  className="grid size-11 place-items-center rounded-full"
                >
                  <span
                    className={cn(
                      "block rounded-full transition-all",
                      reglages.color === entry.name
                        ? "size-6 ring-2 ring-primary ring-offset-2 ring-offset-surface"
                        : "size-5",
                    )}
                    style={{ backgroundColor: `var(--ink-${entry.name})` }}
                  />
                </button>
              ))}
            </Group>

            <Group label="Épaisseur">
              {tailles.map((entry) => (
                <button
                  key={entry.size}
                  type="button"
                  onClick={() => props.onSettings({ ...reglages, size: entry.size })}
                  aria-label={entry.label}
                  aria-pressed={reglages.size === entry.size}
                  title={entry.label}
                  className={cn(
                    "grid size-11 place-items-center rounded-full transition-colors",
                    reglages.size === entry.size
                      ? "bg-primary-container text-on-primary-container"
                      : "text-on-surface-variant",
                  )}
                >
                  <span
                    className="block rounded-full bg-current"
                    style={{ width: entry.size * 3, height: entry.size * 3 }}
                  />
                </button>
              ))}
            </Group>
          </>
        ) : null}

        {tool === "shape" ? (
          <Group label="Forme">
            {SHAPES.map((name) => (
              <Tool
                key={name}
                active={shape === name}
                onClick={() => props.onShape(name)}
                icon={SHAPE_ICONS[name].icon}
                label={SHAPE_ICONS[name].label}
              />
            ))}
          </Group>
        ) : null}

        {tool === "eraser" ? (
          <Group label="Gomme">
            {/* Rayer un mot d'un geste, ou reprendre le détail d'une lettre :
                deux besoins opposés, deux gommes. */}
            <button
              type="button"
              onClick={() => props.onErasePrecise(false)}
              aria-pressed={!erasePrecise}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full px-4 m3-label-large transition-colors",
                erasePrecise
                  ? "text-on-surface-variant hover:text-on-surface"
                  : "bg-primary-container text-on-primary-container",
              )}
              title="Effacer le trait entier d'un seul passage"
            >
              <Eraser className="size-4" />
              Trait entier
            </button>
            <button
              type="button"
              onClick={() => props.onErasePrecise(true)}
              aria-pressed={erasePrecise}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full px-4 m3-label-large transition-colors",
                erasePrecise
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
              title="Couper le trait sous la pointe, sans emporter le reste"
            >
              <Scissors className="size-4" />
              Précise
            </button>
            <button
              type="button"
              onClick={() => props.onEraseHighlightsOnly(!eraseHighlightsOnly)}
              aria-pressed={eraseHighlightsOnly}
              className={cn(
                "flex min-h-11 items-center gap-2 rounded-full px-4 m3-label-large transition-colors",
                eraseHighlightsOnly
                  ? "bg-primary-container text-on-primary-container"
                  : "text-on-surface-variant hover:text-on-surface",
              )}
              title="N'effacer que les surlignages, en laissant l'écriture"
            >
              <Highlighter className="size-4" />
              Surlignages seulement
            </button>
          </Group>
        ) : null}

        {tool === "lasso" ? (
          selection > 0 ? (
            <Group label="Sélection">
              <span className="px-2 m3-label-small tabular-nums text-on-surface-variant">
                {selection} trait{selection > 1 ? "s" : ""}
              </span>
              <Tool
                onClick={props.onDeleteSelection}
                icon={Trash2}
                label="Supprimer la sélection"
                danger
              />
            </Group>
          ) : (
            <p className="px-2 m3-body-small text-on-surface-variant">
              Entoure des traits pour les déplacer ou les supprimer.
            </p>
          )
        ) : null}

        {/* Le papier n'a pas de sens sur un document importé : on n'annote pas
            un polycopié sur du quadrillage. */}
        {!hasBackdrop ? (
          <Group label="Papier" className="ml-auto">
            {PAPERS.map((name) => {
              const entry = PAPER_LABELS[name];
              return (
                <Tool
                  key={name}
                  active={paper === name}
                  onClick={() => props.onPaper(name)}
                  icon={entry.icon}
                  label={entry.label}
                />
              );
            })}
          </Group>
        ) : null}
      </div>
    </div>
  );
}

function Group({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={cn("flex items-center gap-0.5", className)}>
      {children}
    </div>
  );
}

function Tool({
  active,
  onClick,
  icon: Icon,
  label,
  danger,
}: {
  active?: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={label}
      title={label}
      className={cn(
        "grid size-11 place-items-center rounded-full transition-colors",
        active
          ? "bg-primary-container text-on-primary-container"
          : cn("text-on-surface-variant", danger ? "hover:text-error" : "hover:text-on-surface"),
      )}
    >
      <Icon className="size-5" />
    </button>
  );
}
