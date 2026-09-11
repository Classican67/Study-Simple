"use client";

import * as React from "react";
import {
  Crosshair,
  Eraser,
  Grid3x3,
  Highlighter,
  Maximize2,
  Minus,
  Pen,
  Redo2,
  Square,
  Trash2,
  Undo2,
  X,
} from "lucide-react";

import { InkCanvas, type InkTool } from "@/components/note/ink-canvas";
import { PAPERS, type DrawingContent, type Paper, type Stroke } from "@/lib/notes";
import { cn } from "@/lib/utils";

/**
 * Page manuscrite : le canevas, ses outils, et le plein écran.
 *
 * Le plein écran n'est pas un confort : sur iPad, écrire dans un bloc haut de
 * dix centimètres au milieu d'une page qui défile est intenable. La page prend
 * donc tout l'écran, la palette flotte par-dessus, et l'application disparaît —
 * on est devant une feuille.
 */

const INKS = [
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

const PAPER_LABELS: Record<Paper, { label: string; icon: React.ElementType }> = {
  blank: { label: "Uni", icon: Square },
  ruled: { label: "Lignes", icon: Minus },
  grid: { label: "Carreaux", icon: Grid3x3 },
  dots: { label: "Points", icon: Grid3x3 },
};

export function DrawingBlock({
  content,
  onChange,
  readOnly = false,
}: {
  content: DrawingContent;
  onChange: (next: DrawingContent) => void;
  readOnly?: boolean;
}) {
  const [tool, setTool] = React.useState<InkTool>("pen");
  const [ink, setInk] = React.useState("default");
  const [size, setSize] = React.useState(2.5);
  const [full, setFull] = React.useState(false);
  const [strokeCount, setStrokeCount] = React.useState(content.strokes.length);
  // Le rejet de la paume est invisible : le doigt cesse d'écrire sans rien dire.
  // On l'annonce, sinon on croit à une panne.
  const [penMode, setPenMode] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  // Remonter le canevas remet la vue à sa position d'origine : il n'y a rien à
  // réinitialiser à la main, les traits venant du contenu.
  const [viewKey, setViewKey] = React.useState(0);

  // Pile d'annulation, à part du contenu : ce qu'on vient de retirer n'a pas à
  // être enregistré, seulement à pouvoir revenir.
  const undone = React.useRef<Stroke[]>([]);

  function undo() {
    const last = content.strokes.at(-1);
    if (!last) return;
    undone.current = [...undone.current, last];
    onChange({ ...content, strokes: content.strokes.slice(0, -1) });
  }

  function redo() {
    const last = undone.current.at(-1);
    if (!last) return;
    undone.current = undone.current.slice(0, -1);
    onChange({ ...content, strokes: [...content.strokes, last] });
  }

  function clear() {
    if (content.strokes.length === 0) return;
    undone.current = [...content.strokes].reverse();
    onChange({ ...content, strokes: [] });
  }

  // Échap ferme le plein écran, comme partout ailleurs dans l'app.
  React.useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    // La page derrière ne doit pas défiler sous la feuille.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [full]);

  const palette = (
    <Palette
      tool={tool}
      ink={ink}
      size={size}
      paper={content.paper}
      strokes={strokeCount}
      penMode={penMode}
      zoom={zoom}
      onResetView={() => {
        setZoom(1);
        setViewKey((k) => k + 1);
      }}
      full={full}
      onTool={setTool}
      onInk={(name) => {
        setInk(name);
        if (tool === "eraser") setTool("pen");
      }}
      onSize={setSize}
      onPaper={(paper) => onChange({ ...content, paper })}
      onUndo={undo}
      onRedo={redo}
      onClear={clear}
      onToggleFull={() => setFull((f) => !f)}
    />
  );

  const canvas = (
    <InkCanvas
      key={viewKey}
      content={content}
      onChange={onChange}
      tool={tool}
      color={ink}
      size={size}
      readOnly={readOnly}
      growable={full}
      onStrokeCount={setStrokeCount}
      onPenMode={setPenMode}
      onView={setZoom}
      className={full ? "rounded-none border-0" : "rounded-xl border border-outline-variant"}
    />
  );

  if (full) {
    return (
      <>
        {/* Le bloc garde sa place dans le document pendant l'édition plein
            écran : sans lui, la note se replierait derrière la feuille et le
            défilement sauterait à la fermeture. */}
        <div
          aria-hidden
          className="grid place-items-center rounded-xl border border-dashed border-outline-variant py-10 m3-body-medium text-on-surface-variant"
          style={{ aspectRatio: `1 / ${Math.min(content.ratio, 1)}` }}
        >
          Page ouverte en plein écran
        </div>

        <div className="fixed inset-0 z-40 flex flex-col bg-surface">
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className="mx-auto w-full max-w-4xl">{canvas}</div>
          </div>
          {palette}
        </div>
      </>
    );
  }

  return (
    <div className="space-y-2">
      {readOnly ? null : palette}
      {canvas}
    </div>
  );
}

function Palette({
  tool,
  ink,
  size,
  paper,
  strokes,
  penMode,
  zoom,
  full,
  onTool,
  onResetView,
  onInk,
  onSize,
  onPaper,
  onUndo,
  onRedo,
  onClear,
  onToggleFull,
}: {
  tool: InkTool;
  ink: string;
  size: number;
  paper: Paper;
  strokes: number;
  penMode: boolean;
  zoom: number;
  full: boolean;
  onTool: (tool: InkTool) => void;
  onInk: (name: string) => void;
  onSize: (size: number) => void;
  onPaper: (paper: Paper) => void;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onToggleFull: () => void;
  onResetView: () => void;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Outils d'écriture"
      className={cn(
        "flex flex-wrap items-center gap-1",
        // En plein écran la palette flotte au-dessus de la feuille, à portée du
        // pouce, avec la zone sûre des encoches.
        full &&
          "pb-safe shrink-0 justify-center border-t border-outline-variant bg-surface-container px-3 py-2 elevation-3",
      )}
    >
      <Group label="Outil">
        <Tool active={tool === "pen"} onClick={() => onTool("pen")} icon={Pen} label="Stylo" />
        <Tool
          active={tool === "highlighter"}
          onClick={() => onTool("highlighter")}
          icon={Highlighter}
          label="Surligneur"
        />
        <Tool active={tool === "eraser"} onClick={() => onTool("eraser")} icon={Eraser} label="Gomme" />
      </Group>

      <Group label="Couleur">
        {INKS.map((entry) => (
          <button
            key={entry.name}
            type="button"
            onClick={() => onInk(entry.name)}
            aria-label={entry.label}
            aria-pressed={tool !== "eraser" && ink === entry.name}
            title={entry.label}
            className="grid size-11 place-items-center rounded-full"
          >
            <span
              className={cn(
                "block rounded-full transition-all",
                tool !== "eraser" && ink === entry.name
                  ? "size-6 ring-2 ring-primary ring-offset-2 ring-offset-surface"
                  : "size-5",
              )}
              style={{ backgroundColor: `var(--ink-${entry.name})` }}
            />
          </button>
        ))}
      </Group>

      <Group label="Épaisseur">
        {SIZES.map((entry) => (
          <button
            key={entry.size}
            type="button"
            onClick={() => onSize(entry.size)}
            aria-label={entry.label}
            aria-pressed={size === entry.size}
            title={entry.label}
            className={cn(
              "grid size-11 place-items-center rounded-full transition-colors",
              size === entry.size ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant",
            )}
          >
            <span
              className="block rounded-full bg-current"
              style={{ width: entry.size * 3, height: entry.size * 3 }}
            />
          </button>
        ))}
      </Group>

      <Group label="Papier">
        {PAPERS.map((name) => {
          const entry = PAPER_LABELS[name];
          return (
            <button
              key={name}
              type="button"
              onClick={() => onPaper(name)}
              aria-label={entry.label}
              aria-pressed={paper === name}
              title={`Papier : ${entry.label}`}
              className={cn(
                "grid size-11 place-items-center rounded-full transition-colors",
                paper === name ? "bg-primary-container text-on-primary-container" : "text-on-surface-variant",
              )}
            >
              <entry.icon className={cn("size-4", name === "dots" && "opacity-60")} />
            </button>
          );
        })}
      </Group>

      <div className="ml-auto flex items-center gap-0.5">
        {/* Le zoom ne se voit qu'une fois utilisé : afficher « 100 % » en
            permanence n'apprend rien. */}
        {Math.abs(zoom - 1) > 0.01 ? (
          <button
            type="button"
            onClick={onResetView}
            title="Revenir à la taille d'origine"
            aria-label={`Zoom ${Math.round(zoom * 100)} %. Revenir à la taille d'origine`}
            className="mr-1 flex min-h-11 items-center gap-1.5 rounded-full bg-surface-container px-3 m3-label-small tabular-nums text-on-surface-variant transition-colors hover:text-on-surface"
          >
            <Crosshair className="size-3.5" />
            {Math.round(zoom * 100)} %
          </button>
        ) : null}

        {penMode ? (
          <span
            title="Un stylet a été détecté : le doigt ne dessine plus et sert à faire défiler, pour que la paume ne marque pas la page."
            className="mr-1 flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1.5 m3-label-small text-on-surface-variant"
          >
            <Pen className="size-3.5" />
            Stylet
          </span>
        ) : null}
        <Tool onClick={onUndo} icon={Undo2} label="Annuler le dernier trait" />
        <Tool onClick={onRedo} icon={Redo2} label="Rétablir le trait annulé" />
        <Tool onClick={onClear} icon={Trash2} label="Effacer toute la page" danger />
        <Tool
          onClick={onToggleFull}
          icon={full ? X : Maximize2}
          label={full ? "Quitter le plein écran" : "Écrire en plein écran"}
          active={full}
        />
        <span className="sr-only" aria-live="polite">
          {strokes} trait{strokes > 1 ? "s" : ""}
        </span>
      </div>
    </div>
  );
}

function Group({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div role="group" aria-label={label} className="flex items-center gap-0.5">
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
