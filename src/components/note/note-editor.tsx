"use client";

import * as React from "react";
import { ChevronDown, ChevronUp, Loader2, Maximize2, PenLine, Table2, Trash2, Type, X } from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ImportDocument } from "@/components/note/import-document";
import { DrawingBlock } from "@/components/note/drawing-block";
import { TableBlock } from "@/components/note/table-block";
import { TextBlock } from "@/components/note/text-block";
import { Button } from "@/components/ui/button";
import {
  parseDrawing,
  parseTable,
  parseText,
  type BlockKind,
  type DrawingContent,
  type TableContent,
  type TextContent,
} from "@/lib/notes";
import { cn } from "@/lib/utils";
import { addBlock, deleteBlock, renameNote, reorderBlocks, updateBlock } from "@/app/(app)/notes/actions";

export type EditableBlock = { id: string; kind: BlockKind; content: string };

// Le tracé au stylet produit des dizaines d'événements par seconde : on ne
// remonte au serveur qu'une fois la main levée depuis un moment.
const SAVE_DELAY = 700;

const KIND_LABELS: Record<BlockKind, string> = {
  text: "Texte",
  table: "Tableau",
  drawing: "Page manuscrite",
};

const KINDS: { kind: BlockKind; label: string; icon: React.ElementType }[] = [
  { kind: "text", label: "Texte", icon: Type },
  { kind: "table", label: "Tableau", icon: Table2 },
  { kind: "drawing", label: "Croquis", icon: PenLine },
];

export function NoteEditor({
  noteId,
  initialTitle,
  initialBlocks,
}: {
  noteId: string;
  initialTitle: string;
  initialBlocks: EditableBlock[];
}) {
  const [blocks, setBlocks] = React.useState(initialBlocks);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(0);

  async function persist(blockId: string, content: string) {
    setSaving((n) => n + 1);
    const result = await updateBlock(blockId, content);
    setSaving((n) => n - 1);
    if (!result.ok) setError(result.error ?? "Enregistrement impossible.");
    else setError(null);
  }

  async function add(kind: BlockKind, afterBlockId: string | null) {
    setBusy(afterBlockId ?? "end");
    const created = await addBlock(noteId, kind, afterBlockId);
    setBusy(null);
    if (!created) {
      setError("Impossible d'ajouter ce bloc.");
      return;
    }
    setBlocks((current) => {
      const block = { id: created.id, kind: created.kind as BlockKind, content: created.content };
      if (!afterBlockId) return [...current, block];
      const at = current.findIndex((b) => b.id === afterBlockId);
      return at === -1 ? [...current, block] : [...current.slice(0, at + 1), block, ...current.slice(at + 1)];
    });
  }

  async function remove(blockId: string) {
    setBlocks((current) => current.filter((b) => b.id !== blockId));
    const result = await deleteBlock(blockId);
    if (!result.ok) setError(result.error ?? "Suppression impossible.");
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
    void reorderBlocks(noteId, next.map((b) => b.id)).then((result) => {
      if (!result.ok) setError(result.error ?? "Réordonnancement impossible.");
    });
  }

  return (
    // Pleine largeur : une note se lit et s'écrit large, surtout sur iPad.
    // Le plafond de la mise en page suffit, en remettre un ici laissait de
    // larges bandes vides de chaque côté.
    <div className="w-full space-y-4">
      <NoteTitle noteId={noteId} initial={initialTitle} onError={setError} />

      {error ? (
        <p role="alert" className="m3-body-medium text-error">
          {error}
        </p>
      ) : null}

      <div className="space-y-2">
        {blocks.map((block, index) => (
          <BlockCard
            key={block.id}
            block={block}
            index={index}
            total={blocks.length}
            busy={busy === block.id}
            onSave={(content) => persist(block.id, content)}
            onLocalChange={(content) =>
              setBlocks((current) =>
                current.map((b) => (b.id === block.id ? { ...b, content } : b)),
              )
            }
            onAdd={(kind) => add(kind, block.id)}
            onMove={(direction) => move(index, direction)}
            onDelete={() => remove(block.id)}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 pb-8">
        {KINDS.map(({ kind, label, icon: Icon }) => (
          <Button key={kind} variant="outlined" onClick={() => add(kind, null)} disabled={busy === "end"}>
            {busy === "end" ? <Loader2 className="animate-spin" /> : <Icon />}
            {label}
          </Button>
        ))}
        {/* Un document devient une page annotable par page : c'est le geste de
            l'étudiant qui reprend le polycopié du cours. */}
        <ImportDocument
          noteId={noteId}
          onError={setError}
          onImported={(created) => {
            setError(null);
            // Ajoutées à la liste locale, comme tout autre bloc : recharger la
            // page ne suffisait pas — l'état est initialisé une seule fois, et
            // les pages importées n'apparaissaient donc jamais.
            setBlocks((current) => [
              ...current,
              ...created.map((b) => ({ id: b.id, kind: b.kind as BlockKind, content: b.content })),
            ]);
          }}
        />
      </div>

      {/* Discret mais présent : sans retour, on ne sait pas si le croquis
          qu'on vient de tracer est parti. */}
      <p
        aria-live="polite"
        className={cn(
          "fixed bottom-24 right-4 rounded-full bg-surface-container px-4 py-2 m3-label-medium text-on-surface-variant elevation-2 transition-opacity md:bottom-6",
          saving > 0 ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        Enregistrement…
      </p>
    </div>
  );
}

function NoteTitle({
  noteId,
  initial,
  onError,
}: {
  noteId: string;
  initial: string;
  onError: (message: string | null) => void;
}) {
  const [title, setTitle] = React.useState(initial);
  const saved = React.useRef(initial);

  async function save() {
    if (title === saved.current) return;
    const result = await renameNote(noteId, title);
    if (result.ok) {
      saved.current = title;
      onError(null);
    } else {
      onError(result.error ?? "Renommage impossible.");
    }
  }

  return (
    <input
      value={title}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={save}
      // Entrée valide et sort du champ : on ne soumet pas un formulaire, on
      // passe au corps de la note.
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      aria-label="Titre de la note"
      placeholder="Titre de la note"
      className="w-full bg-transparent m3-display-small text-on-surface outline-none placeholder:text-on-surface-variant/50"
    />
  );
}

function BlockCard({
  block,
  index,
  total,
  busy,
  onSave,
  onLocalChange,
  onAdd,
  onMove,
  onDelete,
}: {
  block: EditableBlock;
  index: number;
  total: number;
  busy: boolean;
  onSave: (content: string) => void;
  onLocalChange: (content: string) => void;
  onAdd: (kind: BlockKind) => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
}) {
  const timer = React.useRef<number | null>(null);
  const [full, setFull] = React.useState(false);

  // Échap referme, et la page derrière ne défile pas sous le bloc agrandi.
  React.useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onKey);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [full]);

  // Enregistrement différé : on écrit une fois la main levée, pas à chaque
  // point du tracé ni à chaque frappe.
  const schedule = React.useCallback(
    (content: string) => {
      onLocalChange(content);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => onSave(content), SAVE_DELAY);
    },
    [onLocalChange, onSave],
  );

  // Un départ de page ne doit pas emporter la dernière modification.
  React.useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);

  return (
    <section
      aria-label={`Bloc ${index + 1} sur ${total}`}
      className="group rounded-2xl border border-outline-variant bg-surface-container p-3 transition-colors focus-within:border-primary/40 sm:p-4"
    >
      <div className="mb-2 flex items-center justify-end gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {/* Le croquis a son propre plein écran, taillé pour sa palette. */}
        {block.kind !== "drawing" ? (
          <Button
            variant="text"
            size="icon"
            onClick={() => setFull(true)}
            aria-label={`Agrandir le bloc ${index + 1}`}
            title="Plein écran"
          >
            <Maximize2 />
          </Button>
        ) : null}
        <Button
          variant="text"
          size="icon"
          onClick={() => onMove(-1)}
          disabled={index === 0}
          aria-label={`Monter le bloc ${index + 1}`}
        >
          <ChevronUp />
        </Button>
        <Button
          variant="text"
          size="icon"
          onClick={() => onMove(1)}
          disabled={index === total - 1}
          aria-label={`Descendre le bloc ${index + 1}`}
        >
          <ChevronDown />
        </Button>
        <ConfirmDialog
          trigger={
            <Button
              variant="text"
              size="icon"
              aria-label={`Supprimer le bloc ${index + 1}`}
              className="hover:text-error"
            >
              <Trash2 />
            </Button>
          }
          title="Supprimer ce bloc ?"
          description="Son contenu sera définitivement effacé."
          confirmLabel="Supprimer"
          action={async () => onDelete()}
        />
      </div>

      {full ? (
        // Le bloc garde sa place pendant l'édition plein écran : sans lui, la
        // note se replierait derrière et le défilement sauterait en sortant.
        <div
          aria-hidden
          className="grid min-h-40 place-items-center rounded-xl border border-dashed border-outline-variant m3-body-medium text-on-surface-variant"
        >
          Bloc ouvert en plein écran
        </div>
      ) : (
        <BlockBody block={block} onChange={schedule} />
      )}

      {full ? (
        <div className="fixed inset-0 z-40 flex flex-col bg-surface">
          <div className="flex shrink-0 items-center justify-between gap-2 border-b border-outline-variant px-3 py-2">
            <span className="m3-title-medium text-on-surface">{KIND_LABELS[block.kind]}</span>
            <Button
              variant="text"
              size="icon"
              onClick={() => setFull(false)}
              aria-label="Quitter le plein écran"
            >
              <X />
            </Button>
          </div>
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 sm:p-6">
            <BlockBody block={block} onChange={schedule} />
          </div>
        </div>
      ) : null}

      {/* Insertion entre deux blocs, au pied de celui-ci — comme pour les
          cartes, le geste se lit là où le nouveau bloc va apparaître. */}
      <div className="mt-3 flex items-center gap-2 border-t border-outline-variant pt-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        <span className="h-px flex-1 bg-outline-variant" />
        {KINDS.map(({ kind, label, icon: Icon }) => (
          <button
            key={kind}
            type="button"
            onClick={() => onAdd(kind)}
            disabled={busy}
            aria-label={`Insérer un bloc ${label.toLowerCase()} après le bloc ${index + 1}`}
            title={`Insérer : ${label}`}
            className="flex min-h-11 items-center gap-1.5 rounded-full px-3 m3-label-medium text-on-surface-variant transition-colors hover:text-primary disabled:opacity-50"
          >
            {busy ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4" />}
            {label}
          </button>
        ))}
        <span className="h-px flex-1 bg-outline-variant" />
      </div>
    </section>
  );
}

/** Rend le bloc selon son type, en lui donnant son contenu déjà analysé. */
function BlockBody({
  block,
  onChange,
}: {
  block: EditableBlock;
  onChange: (content: string) => void;
}) {
  if (block.kind === "table") {
    const content: TableContent = parseTable(block.content);
    return <TableBlock content={content} onChange={(next) => onChange(JSON.stringify(next))} />;
  }
  if (block.kind === "drawing") {
    const content: DrawingContent = parseDrawing(block.content);
    return <DrawingBlock content={content} onChange={(next) => onChange(JSON.stringify(next))} />;
  }
  const content: TextContent = parseText(block.content);
  return <TextBlock content={content} onChange={(next) => onChange(JSON.stringify(next))} />;
}
