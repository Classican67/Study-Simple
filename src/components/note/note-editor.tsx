"use client";

import * as React from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  Copy,
  Image as ImageIcon,
  Loader2,
  Maximize2,
  MoreVertical,
  PenLine,
  Table2,
  Trash2,
  Type,
  X,
} from "lucide-react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { ExportPdf } from "@/components/note/export-pdf";
import { ImageBlock } from "@/components/note/image-block";
import { ImportDocument } from "@/components/note/import-document";
import type { RechercheInitiale } from "@/components/note/loupe-note";
import { PhotoNote } from "@/components/note/photo-note";
import { PageNavigator } from "@/components/note/page-navigator";
import { DrawingBlock } from "@/components/note/drawing-block";
import { EtatSauvegarde, LitigesSauvegarde, useSauvegarde } from "@/components/note/sauvegarde";
import { TableBlock } from "@/components/note/table-block";
import { TextBlock } from "@/components/note/text-block";
import { Button } from "@/components/ui/button";
import { blocsDuPressePapiers, contenuDuBloc, type BlocColle } from "@/lib/collage";
import { blocPourPresse, copierDansLePresse } from "@/lib/copie-bloc";
import { preparerImage } from "@/lib/image-client";
import {
  parseImageBlock,
  parseTable,
  parseText,
  UNTITLED,
  type BlockKind,
  type DrawingContent,
  type ImageBlockContent,
  type TableContent,
  type TextContent,
} from "@/lib/notes";
import { analyserDessin, serialiserDessin, souvenirDessin } from "@/lib/drawing-cache";
import { cn } from "@/lib/utils";
import {
  addBlock,
  addBlocks,
  addImageBlock,
  deleteBlock,
  duplicateBlock,
  renameNote,
  reorderBlocks,
} from "@/app/(app)/notes/actions";
import { noteRestructuree } from "@/lib/hors-ligne/client";

export type EditableBlock = { id: string; kind: BlockKind; content: string };

// Le tracé au stylet produit des dizaines d'événements par seconde : on ne
// remonte au serveur qu'une fois la main levée depuis un moment.
const SAVE_DELAY = 700;

const KIND_LABELS: Record<BlockKind, string> = {
  text: "Texte",
  table: "Tableau",
  drawing: "Page manuscrite",
  image: "Image",
};

const KINDS: { kind: Exclude<BlockKind, "image">; label: string; icon: React.ElementType }[] = [
  { kind: "text", label: "Texte", icon: Type },
  { kind: "table", label: "Tableau", icon: Table2 },
  { kind: "drawing", label: "Croquis", icon: PenLine },
];

export function NoteEditor({
  noteId,
  initialTitle,
  initialBlocks,
  noteModifiee,
  horsLigne = false,
  format = "blocs",
  retour = "/notes",
  actions,
  recherche,
}: {
  noteId: string;
  initialTitle: string;
  initialBlocks: EditableBlock[];
  /** Date de dernière modification côté serveur : cf. `useSauvegarde`. */
  noteModifiee: number;
  /**
   * Ouverte depuis la page hors ligne. On y lit et on y annote les blocs
   * existants — leur contenu passe par le journal local, qui l'enverra au
   * retour du réseau. Ce qui a besoin du serveur pour exister (un bloc
   * créé, dupliqué, déplacé ou supprimé, un titre, un import, un export) est
   * retiré plutôt que proposé pour échouer.
   */
  horsLigne?: boolean;
  /** « feuille » : une seule surface, ouverte en plein écran. Cf. `Note.format`. */
  format?: string;
  /** Où mène le bouton de retour d'une feuille. */
  retour?: string;
  /** Ce qui s'applique à la note entière : ranger, maîtrisée, supprimer… */
  actions?: React.ReactNode;
  recherche?: RechercheInitiale;
}) {
  const [blocks, setBlocks] = React.useState(initialBlocks);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  // Une page manuscrite ouverte en plein écran pose sa palette en bas de
  // l'écran : le repère de page doit lui laisser la place.
  const [canvasFull, setCanvasFull] = React.useState(false);

  /*
   * Enregistrement : journal local d'abord, serveur ensuite.
   *
   * L'éditeur n'appelle plus l'action serveur. Il dépose la modification dans
   * `useSauvegarde`, qui l'écrit sur l'appareil **avant** toute tentative
   * réseau, puis la rejoue jusqu'à ce que le serveur la confirme. Un échec
   * n'est donc plus un message d'erreur suivi d'un contenu perdu : c'est une
   * entrée en attente, qui repart au retour du réseau ou à la réouverture de
   * la note.
   *
   * L'ancien chemin — un appel, un message si ça rate — laissait le sort du
   * travail dépendre du hasard : avait-on écrit à nouveau juste après la
   * coupure ? Si oui l'enregistrement suivant rattrapait tout, si non rien ne
   * repartait jamais.
   */
  const blocsCourants = React.useRef(blocks);
  React.useEffect(() => {
    blocsCourants.current = blocks;
  });

  const sauvegarde = useSauvegarde({
    noteId,
    noteModifiee,
    contenus: () => new Map(blocsCourants.current.map((b) => [b.id, b.content])),
    onReprise: (reprises) =>
      setBlocks((current) =>
        current.map((bloc) => {
          const reprise = reprises.find((r) => r.blockId === bloc.id);
          return reprise ? { ...bloc, content: reprise.content } : bloc;
        }),
      ),
  });

  function persist(blockId: string, kind: BlockKind, content: string) {
    void sauvegarde.enregistrer({ blockId, kind, content });
  }

  /*
   * Vidanger avant que l'onglet ne disparaisse.
   *
   * L'enregistrement est différé de 700 ms ; passer à une autre application sur
   * iPad, ou verrouiller l'écran, laissait ces 700 ms dans le vide. Les blocs
   * déposent ici de quoi forcer leur vidange, et `visibilitychange` la
   * déclenche — il arrive **avant** que le système ne gèle ou n'évince
   * l'onglet, ce qui laisse à l'écriture du journal le temps d'aboutir.
   */
  // Un ensemble stable, et non une ref : il se lit pendant le rendu pour être
  // passé aux blocs.
  const vidanges = React.useMemo(() => new Set<() => void>(), []);
  React.useEffect(() => {
    const tout = () => {
      for (const vidanger of vidanges) vidanger();
    };
    const surVisibilite = () => {
      if (document.visibilityState === "hidden") tout();
    };
    document.addEventListener("visibilitychange", surVisibilite);
    window.addEventListener("pagehide", tout);
    return () => {
      document.removeEventListener("visibilitychange", surVisibilite);
      window.removeEventListener("pagehide", tout);
    };
  }, [vidanges]);

  async function add(kind: BlockKind, afterBlockId: string | null) {
    setBusy(afterBlockId ?? "end");
    const created = await addBlock(noteId, kind, afterBlockId);
    setBusy(null);
    if (!created) {
      setError("Impossible d'ajouter ce bloc.");
      return;
    }
    noteRestructuree(noteId);
    setBlocks((current) => {
      const block = { id: created.id, kind: created.kind as BlockKind, content: created.content };
      if (!afterBlockId) return [...current, block];
      const at = current.findIndex((b) => b.id === afterBlockId);
      return at === -1 ? [...current, block] : [...current.slice(0, at + 1), block, ...current.slice(at + 1)];
    });
  }

  /** Pose les blocs d'un collage à la suite d'un bloc, ou à la fin de la note. */
  async function insererBlocs(blocs: BlocColle[], afterBlockId: string | null) {
    if (blocs.length === 0) return;
    setBusy(afterBlockId ?? "end");
    try {
      const crees = await addBlocks(noteId, blocs.map(contenuDuBloc), afterBlockId);
      if (!crees) {
        setError("Le collage n'a pas pu être ajouté à la note.");
        return;
      }
      setError(null);
      noteRestructuree(noteId);
      setBlocks((current) => {
        const nouveaux = crees.map((b) => ({ id: b.id, kind: b.kind as BlockKind, content: b.content }));
        if (!afterBlockId) return [...current, ...nouveaux];
        const at = current.findIndex((b) => b.id === afterBlockId);
        return at === -1
          ? [...current, ...nouveaux]
          : [...current.slice(0, at + 1), ...nouveaux, ...current.slice(at + 1)];
      });
    } catch {
      setError("Le collage n'a pas pu être enregistré. Vérifie ta connexion.");
    } finally {
      setBusy(null);
    }
  }

  /** Une image dans le fil de la note, à la suite d'un bloc ou à la fin. */
  async function insererImage(fichier: File, afterBlockId: string | null) {
    setBusy(afterBlockId ?? "end");
    try {
      const { file, ratio } = await preparerImage(fichier);
      const data = new FormData();
      data.set("photo", file);
      data.set("ratio", String(ratio));
      const result = await addImageBlock(noteId, data, afterBlockId);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setError(null);
      noteRestructuree(noteId);
      const bloc = { id: result.block.id, kind: "image" as BlockKind, content: result.block.content };
      setBlocks((current) => {
        if (!afterBlockId) return [...current, bloc];
        const at = current.findIndex((b) => b.id === afterBlockId);
        return at === -1 ? [...current, bloc] : [...current.slice(0, at + 1), bloc, ...current.slice(at + 1)];
      });
    } catch {
      setError("L'image n'a pas pu être ajoutée. Vérifie ta connexion.");
    } finally {
      setBusy(null);
    }
  }

  /*
   * Le fichier choisi pour un bloc image, et le bloc après lequel le poser.
   * Un seul sélecteur pour toute la note : `apres` dit d'où il a été ouvert.
   */
  const imageRef = React.useRef<HTMLInputElement>(null);
  const apresImage = React.useRef<string | null>(null);
  const choisirImage = (afterBlockId: string | null) => {
    apresImage.current = afterBlockId;
    imageRef.current?.click();
  };

  /*
   * Coller quand aucun champ n'a le focus.
   *
   * Une page manuscrite prend d'abord ce qui la regarde — elle s'en charge, et le
   * signale par `defaultPrevented`. Le reste rejoint le bas de la note : du texte
   * collé ne doit pas se perdre parce qu'on n'avait pas cliqué au bon endroit.
   */
  const feuille = format === "feuille" && blocks.length === 1 && blocks[0].kind === "drawing";
  const feuilleRef = React.useRef(feuille);
  const collerDansLaNote = React.useRef(insererBlocs);
  const collerImage = React.useRef(insererImage);
  React.useEffect(() => {
    feuilleRef.current = feuille;
    collerDansLaNote.current = insererBlocs;
    collerImage.current = insererImage;
  });
  React.useEffect(() => {
    if (horsLigne) return;
    const coller = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const cible = event.target as HTMLElement | null;
      if (cible?.closest?.("input, textarea, select, [contenteditable='true']")) return;
      const donnees = event.clipboardData;
      if (!donnees) return;
      const image = Array.from(donnees.files).find((f) => f.type.startsWith("image/"));
      if (image) {
        event.preventDefault();
        void collerImage.current(image, null);
        return;
      }
      const blocs = blocsDuPressePapiers(donnees.getData("text/html"), donnees.getData("text/plain"));
      if (blocs.length === 0) return;
      // Une feuille a déjà pris ce texte, en zone : ici, c'est qu'elle n'a pas pu.
      if (feuilleRef.current) return;
      event.preventDefault();
      void collerDansLaNote.current(blocs, null);
    };
    window.addEventListener("paste", coller);
    return () => window.removeEventListener("paste", coller);
  }, [horsLigne]);

  async function duplicate(blockId: string) {
    setBusy(blockId);
    const created = await duplicateBlock(blockId);
    setBusy(null);
    if (!created) {
      setError("Impossible de dupliquer ce bloc.");
      return;
    }
    setError(null);
    noteRestructuree(noteId);
    setBlocks((current) => {
      const at = current.findIndex((b) => b.id === blockId);
      const copie = { id: created.id, kind: created.kind as BlockKind, content: created.content };
      return at === -1 ? [...current, copie] : [...current.slice(0, at + 1), copie, ...current.slice(at + 1)];
    });
  }

  async function remove(blockId: string) {
    setBlocks((current) => current.filter((b) => b.id !== blockId));
    const result = await deleteBlock(blockId);
    if (!result.ok) setError(result.error ?? "Suppression impossible.");
    else noteRestructuree(noteId);
  }

  function move(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    setBlocks(next);
    void reorderBlocks(noteId, next.map((b) => b.id)).then((result) => {
      if (!result.ok) setError(result.error ?? "Réordonnancement impossible.");
      else noteRestructuree(noteId);
    });
  }

  // Le repère de page et la pastille d'enregistrement sont communs aux deux formes.
  const reperes = (
    <>
      {/* Repère de page, flottant : un polycopié de quarante pages devient
          quarante blocs, et retrouver la page 27 demanderait sinon de faire
          défiler à l'aveugle. */}
      {/* Au-dessus du plein écran (z-50, et placé après lui dans le document) :
          c'est justement là qu'on annote un polycopié, et le repère y devenait
          inaccessible. Sa hauteur suit celle de la palette, publiée par la page
          manuscrite : quatre rangées sur téléphone, et le repère se posait sur
          les couleurs. */}
      <div
        className={cn(
          "pointer-events-none fixed left-1/2 z-50 -translate-x-1/2 transition-[bottom]",
          canvasFull ? "bottom-[calc(var(--ink-palette-h,10rem)+0.75rem)]" : "bottom-24 md:bottom-6",
        )}
      >
        {/* `empty:hidden` : sous deux pages le repère ne rend rien, et son
            enveloppe restait seule — un petit trait flottant sur la photo. */}
        <div className="pointer-events-auto rounded-full border border-outline-variant bg-surface-container px-1 elevation-2 empty:hidden">
          <PageNavigator
            pages={blocks
              .filter((b) => b.kind === "drawing")
              .map((b) => ({ id: b.id, content: b.content }))}
          />
        </div>
      </div>

      {/* Discret mais présent : sans retour, on ne sait pas si le croquis
          qu'on vient de tracer est parti. Et surtout, la pastille **nomme** la
          panne quand il y en a une — « hors ligne », « session expirée » ne
          demandent pas la même chose — et s'ouvre sur la porte de sortie :
          réessayer, se reconnecter, ou emporter son travail dans un fichier. */}
      {/* Elle monte au-dessus de la barre d'outils quand celle-ci est en bas de
          l'écran, comme le repère de page — et redescend dès que la barre est
          ailleurs ou repliée. Sans cela la pastille se posait **sur** la barre :
          elles sont toutes deux en z-50, et la dernière du document gagne. */}
      <EtatSauvegarde
        noteId={noteId}
        outils={sauvegarde}
        className={cn(
          "fixed right-4 z-50 transition-[bottom]",
          canvasFull ? "bottom-[calc(var(--ink-palette-h,0px)+0.75rem)]" : "bottom-24 md:bottom-6",
        )}
      />
    </>
  );

  if (feuille) {
    const page = blocks[0];
    const feuilleProps = {
      gauche: (
        <>
          <Link
            href={retour}
            aria-label="Revenir aux notes"
            title="Revenir aux notes"
            className="grid size-11 shrink-0 place-items-center rounded-xl text-on-bandeau"
          >
            <ArrowLeft className="size-5" />
          </Link>
          {horsLigne ? (
            <h1 className="min-w-0 flex-1 truncate m3-title-medium text-on-bandeau">
              {initialTitle.trim() || UNTITLED}
            </h1>
          ) : (
            <NoteTitle noteId={noteId} initial={initialTitle} onError={setError} compact />
          )}
        </>
      ),
      droite: (
        <ActionsFeuille>
          {actions}
          {horsLigne ? null : <ExportPdf noteId={noteId} />}
        </ActionsFeuille>
      ),
      sous: (
        <div className="shrink-0">
          {error ? (
            <p role="alert" className="border-b border-outline-variant px-4 py-2 m3-body-medium text-error">
              {error}
            </p>
          ) : null}
          {sauvegarde.repris > 0 ? (
            <div
              role="status"
              className="flex flex-wrap items-center gap-3 bg-secondary-container px-4 py-2 m3-body-medium text-on-secondary-container"
            >
              <span className="flex-1">
                {sauvegarde.repris === 1
                  ? "Une modification non enregistrée a été retrouvée sur cet appareil et remise en place."
                  : `${sauvegarde.repris} modifications non enregistrées ont été retrouvées sur cet appareil et remises en place.`}
              </span>
              <Button variant="text" onClick={sauvegarde.oublierReprise}>
                J&apos;ai compris
              </Button>
            </div>
          ) : null}
          <LitigesSauvegarde outils={sauvegarde} />
        </div>
      ),
    };

    return (
      <>
        <BlockCard
          key={page.id}
          block={page}
          index={0}
          total={1}
          busy={false}
          onSave={(content) => persist(page.id, page.kind, content)}
          registre={vidanges}
          onLocalChange={(content) =>
            setBlocks((current) => current.map((b) => (b.id === page.id ? { ...b, content } : b)))
          }
          onCanvasFull={setCanvasFull}
          noteId={noteId}
          onAdd={() => {}}
          onAddImage={() => {}}
          onDuplicate={() => {}}
          onMove={() => {}}
          onDelete={() => {}}
          structure={false}
          feuille={feuilleProps}
          recherche={recherche}
        />
        {reperes}
      </>
    );
  }

  return (
    // Pleine largeur : une note se lit et s'écrit large, surtout sur iPad.
    // Le plafond de la mise en page suffit, en remettre un ici laissait de
    // larges bandes vides de chaque côté.
    <div className="w-full space-y-4">
      {horsLigne ? (
        <h1 className="m3-display-small text-on-surface">{initialTitle.trim() || UNTITLED}</h1>
      ) : (
        <NoteTitle noteId={noteId} initial={initialTitle} onError={setError} />
      )}

      {error ? (
        <p role="alert" className="m3-body-medium text-error">
          {error}
        </p>
      ) : null}

      {/* Du travail écrit hors ligne vient d'être remis en place : le dire,
          sinon la page semble simplement avoir gardé son contenu et l'on ne
          sait pas que ce qui manquait est revenu. */}
      {sauvegarde.repris > 0 ? (
        <div
          role="status"
          className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary-container px-4 py-3 m3-body-medium text-on-secondary-container"
        >
          <span className="flex-1">
            {sauvegarde.repris === 1
              ? "Une modification non enregistrée a été retrouvée sur cet appareil et remise en place."
              : `${sauvegarde.repris} modifications non enregistrées ont été retrouvées sur cet appareil et remises en place.`}
          </span>
          <Button variant="text" onClick={sauvegarde.oublierReprise}>
            J&apos;ai compris
          </Button>
        </div>
      ) : null}

      {/* Des versions que l'app ne s'autorise pas à remettre d'office : la note
          a changé depuis qu'elles ont été écrites. Le choix est posé ici, pas
          derrière la pastille — celle-ci est masquée quand tout est enregistré,
          et c'est justement le cas. */}
      <LitigesSauvegarde outils={sauvegarde} />

      <div className="space-y-2">
        {blocks.map((block, index) => (
          <BlockCard
            key={block.id}
            block={block}
            index={index}
            total={blocks.length}
            busy={busy === block.id}
            onSave={(content) => persist(block.id, block.kind, content)}
            registre={vidanges}
            onLocalChange={(content) =>
              setBlocks((current) =>
                current.map((b) => (b.id === block.id ? { ...b, content } : b)),
              )
            }
            onCanvasFull={setCanvasFull}
            noteId={noteId}
            onAdd={(kind) => add(kind, block.id)}
            onAddImage={() => choisirImage(block.id)}
            onPasteImage={horsLigne ? undefined : (image) => void insererImage(image, block.id)}
            onPasteBlocs={horsLigne ? undefined : (collage) => void insererBlocs(collage, block.id)}
            onDuplicate={() => duplicate(block.id)}
            onMove={(direction) => move(index, direction)}
            onDelete={() => remove(block.id)}
            structure={!horsLigne}
            recherche={recherche}
          />
        ))}
      </div>

      {horsLigne ? <div className="pb-8" /> : (
      <div className="flex flex-wrap items-center justify-center gap-2 pb-8">
        {KINDS.map(({ kind, label, icon: Icon }) => (
          <Button key={kind} variant="outlined" onClick={() => add(kind, null)} disabled={busy === "end"}>
            {busy === "end" ? <Loader2 className="animate-spin" /> : <Icon />}
            {label}
          </Button>
        ))}
        <Button variant="outlined" onClick={() => choisirImage(null)} disabled={busy === "end"}>
          <ImageIcon />
          Image
        </Button>
        {/* Un document devient une page annotable par page : c'est le geste de
            l'étudiant qui reprend le polycopié du cours. */}
        <ExportPdf
          noteId={noteId}
          disabled={!blocks.some((b) => b.kind === "drawing" || b.kind === "image")}
        />
        {/* Photographier une page pour l'annoter : le tableau du cours, la
            page d'un camarade, un schéma d'un livre. */}
        <PhotoNote
          noteId={noteId}
          onError={setError}
          onAdded={(block) => {
            setError(null);
            setBlocks((current) => [
              ...current,
              { id: block.id, kind: block.kind as BlockKind, content: block.content },
            ]);
          }}
        />
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
      )}

      {horsLigne ? null : (
        <input
          ref={imageRef}
          type="file"
          accept="image/*"
          data-bloc-image=""
          className="sr-only"
          tabIndex={-1}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (file) void insererImage(file, apresImage.current);
          }}
        />
      )}

      {reperes}
    </div>
  );
}

/** Ce qui s'applique à la note entière : ça ne sert pas toutes les trente secondes. */
function ActionsFeuille({ children }: { children: React.ReactNode }) {
  const [ouvert, setOuvert] = React.useState(false);
  return (
    <>
      <button
        type="button"
        aria-expanded={ouvert}
        aria-label="Actions de la note"
        title="Actions de la note"
        onClick={() => setOuvert((o) => !o)}
        className="grid size-11 shrink-0 place-items-center rounded-xl text-on-bandeau"
      >
        <MoreVertical className="size-5" />
      </button>
      {ouvert ? (
        <>
          <button
            type="button"
            aria-label="Fermer les actions"
            tabIndex={-1}
            className="fixed inset-0 z-30 cursor-default"
            onClick={() => setOuvert(false)}
          />
          <div
            role="group"
            aria-label="Actions de la note"
            className="absolute right-1 top-full z-40 mt-1 flex w-max max-w-[calc(100vw-1rem)] flex-wrap items-center justify-end gap-1 rounded-2xl bg-surface-high p-2 text-on-surface elevation-3"
          >
            {children}
          </div>
        </>
      ) : null}
    </>
  );
}

function NoteTitle({
  noteId,
  initial,
  onError,
  compact = false,
}: {
  noteId: string;
  initial: string;
  onError: (message: string | null) => void;
  compact?: boolean;
}) {
  const [title, setTitle] = React.useState(initial);
  const saved = React.useRef(initial);

  async function save() {
    if (title === saved.current) return;
    try {
      const result = await renameNote(noteId, title);
      if (result.ok) {
        saved.current = title;
        onError(null);
        noteRestructuree(noteId);
      } else {
        onError(result.error ?? "Renommage impossible.");
      }
    } catch {
      /*
       * Une action serveur peut être **rejetée**, pas seulement répondre non —
       * réseau coupé, session expirée. Non attrapée, la promesse remontait en
       * rejet non géré.
       *
       * Le titre ne passe pas par le journal des brouillons, qui range par
       * bloc : il reste dans le champ, et `saved` n'avance qu'en cas de
       * succès, donc le prochain départ du champ retente. C'est peu, mais un
       * titre se retape en deux secondes — une page manuscrite non.
       */
      onError("Titre non enregistré — il repartira en quittant le champ à nouveau.");
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
      className={cn(
        "bg-transparent outline-none",
        compact
          ? "h-11 min-w-0 flex-1 m3-title-medium text-on-bandeau placeholder:text-on-bandeau/70"
          : "w-full m3-display-small text-on-surface placeholder:text-on-surface-variant/50",
      )}
    />
  );
}

function BlockCard({
  noteId,
  block,
  index,
  total,
  busy,
  onSave,
  onLocalChange,
  onCanvasFull,
  onAdd,
  onAddImage,
  onPasteImage,
  onPasteBlocs,
  onDuplicate,
  onMove,
  onDelete,
  registre,
  structure,
  feuille,
  recherche,
}: {
  noteId: string;
  block: EditableBlock;
  index: number;
  total: number;
  busy: boolean;
  onSave: (content: string) => void;
  onLocalChange: (content: string) => void;
  onCanvasFull: (full: boolean) => void;
  onAdd: (kind: BlockKind) => void;
  onAddImage: () => void;
  onPasteImage?: (image: File) => void;
  onPasteBlocs?: (blocs: BlocColle[]) => void;
  onDuplicate: () => void;
  onMove: (direction: -1 | 1) => void;
  onDelete: () => void;
  /** Vidanges à déclencher avant que l'onglet ne parte. Cf. `NoteEditor`. */
  registre: Set<() => void>;
  /** Faux hors ligne : dupliquer, déplacer, supprimer et insérer demandent le serveur. */
  structure: boolean;
  /** La page est la note entière : pas de cadre de bloc autour d'elle. */
  feuille?: { gauche: React.ReactNode; droite: React.ReactNode; sous: React.ReactNode };
  recherche?: RechercheInitiale;
}) {
  const timer = React.useRef<number | null>(null);
  const [full, setFull] = React.useState(false);
  const [copie, setCopie] = React.useState(false);

  async function copierBloc() {
    const contenu = blocPourPresse(block.kind, block.content);
    if (!contenu || !(await copierDansLePresse(contenu))) return;
    setCopie(true);
    window.setTimeout(() => setCopie(false), 1500);
  }

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

  /*
   * Ce qui attend d'être enregistré — **un seul endroit pour les deux formes**.
   *
   * Page manuscrite : le canevas rend un objet. Le transformer en texte tout de
   * suite, puis le renvoyer dans l'état de l'éditeur, refaisait analyser et
   * repeindre la page entière au lever de chaque lettre. Le contenu est donc
   * gardé tel quel, et converti une seule fois, au moment d'enregistrer.
   *
   * Texte et tableau arrivent déjà sérialisés. Ils passaient auparavant
   * directement au minuteur, sans rien laisser derrière eux : une vidange
   * forcée — départ de page, onglet qui disparaît — ne trouvait donc rien à
   * enregistrer et les abandonnait. Les deux formes attendent ici.
   */
  const enAttente = React.useRef<{ texte: string } | { dessin: DrawingContent } | null>(null);

  const vidanger = React.useCallback(() => {
    const next = enAttente.current;
    enAttente.current = null;
    if (!next) return;
    if ("texte" in next) {
      onSave(next.texte);
      return;
    }
    const raw = serialiserDessin(next.dessin);
    // L'écho reviendra à l'identique : cf. `souvenirDessin`.
    souvenirDessin(raw, next.dessin);
    onLocalChange(raw);
    onSave(raw);
  }, [onLocalChange, onSave]);

  // Enregistrement différé : on écrit une fois la main levée, pas à chaque
  // point du tracé ni à chaque frappe.
  const schedule = React.useCallback(
    (content: string) => {
      onLocalChange(content);
      enAttente.current = { texte: content };
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(vidanger, SAVE_DELAY);
    },
    [onLocalChange, vidanger],
  );

  const scheduleDrawing = React.useCallback(
    (next: DrawingContent) => {
      enAttente.current = { dessin: next };
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(vidanger, SAVE_DELAY);
    },
    [vidanger],
  );

  // Un départ de page ne doit pas emporter la dernière modification : on
  // enregistre ce qui attendait au lieu de l'abandonner. Le minuteur seul était
  // annulé, et les traits des sept dernières centaines de millisecondes
  // partaient avec lui.
  const dernier = React.useRef(vidanger);
  React.useEffect(() => {
    dernier.current = vidanger;
  }, [vidanger]);

  // Même vidange, déclenchée de l'extérieur : l'onglet qui passe à l'arrière-
  // plan n'est pas un démontage, et n'appellerait donc rien.
  React.useEffect(() => {
    const forcer = () => dernier.current();
    registre.add(forcer);
    return () => {
      registre.delete(forcer);
    };
  }, [registre]);

  React.useEffect(
    () => () => {
      if (timer.current) window.clearTimeout(timer.current);
      dernier.current();
    },
    [],
  );

  if (feuille) {
    return (
      <BlockBody
        noteId={noteId}
        block={block}
        onChange={schedule}
        onDrawing={scheduleDrawing}
        onCanvasFull={onCanvasFull}
        feuille={feuille}
        recherche={recherche}
      />
    );
  }

  return (
    <section
      id={`bloc-${block.id}`}
      // `scroll-mt` dégage la barre supérieure collante : sans elle, la page
      // visée arriverait à moitié cachée dessous.
      style={{ scrollMarginTop: "5rem" }}
      aria-label={`Bloc ${index + 1} sur ${total}`}
      className="group rounded-2xl border border-outline-variant bg-surface-container p-3 transition-colors focus-within:border-primary/40 sm:p-4"
    >
      <div className="mb-2 flex items-center justify-end gap-0.5 opacity-60 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
        {block.kind === "text" || block.kind === "table" ? (
          <Button
            variant="text"
            size="icon"
            onClick={copierBloc}
            aria-label={copie ? `Bloc ${index + 1} copié` : `Copier le bloc ${index + 1}`}
            title="Copier — le collage garde les titres, les listes et le tableau"
          >
            {copie ? <Check /> : <ClipboardCopy />}
          </Button>
        ) : null}
        {/* Le croquis a son propre plein écran, taillé pour sa palette. */}
        {block.kind === "text" || block.kind === "table" ? (
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
        {structure ? (
          <>
        <Button
          variant="text"
          size="icon"
          onClick={onDuplicate}
          disabled={busy}
          aria-label={`Dupliquer le bloc ${index + 1}`}
          title="Dupliquer — la copie se place juste en dessous"
        >
          {busy ? <Loader2 className="animate-spin" /> : <Copy />}
        </Button>
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
          </>
        ) : null}
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
        <BlockBody noteId={noteId} block={block} onChange={schedule} onDrawing={scheduleDrawing} onCanvasFull={onCanvasFull} onPasteImage={onPasteImage} onPasteBlocs={onPasteBlocs} recherche={recherche} />
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
            <BlockBody noteId={noteId} block={block} onChange={schedule} onDrawing={scheduleDrawing} onCanvasFull={onCanvasFull} onPasteImage={onPasteImage} onPasteBlocs={onPasteBlocs} />
          </div>
        </div>
      ) : null}

      {/* Insertion entre deux blocs, au pied de celui-ci — comme pour les
          cartes, le geste se lit là où le nouveau bloc va apparaître. */}
      {structure ? (
      <div className="mt-3 flex flex-wrap items-center justify-center gap-x-2 border-t border-outline-variant pt-2 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
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
        <button
          type="button"
          onClick={onAddImage}
          disabled={busy}
          aria-label={`Insérer une image après le bloc ${index + 1}`}
          title="Insérer : Image"
          className="flex min-h-11 items-center gap-1.5 rounded-full px-3 m3-label-medium text-on-surface-variant transition-colors hover:text-primary disabled:opacity-50"
        >
          <ImageIcon className="size-4" />
          Image
        </button>
      </div>
      ) : null}
    </section>
  );
}

/** Rend le bloc selon son type, en lui donnant son contenu déjà analysé. */
const BlockBody = React.memo(function BlockBody({
  noteId,
  block,
  onChange,
  onDrawing,
  onCanvasFull,
  onPasteImage,
  onPasteBlocs,
  feuille,
  recherche,
}: {
  noteId: string;
  block: EditableBlock;
  onChange: (content: string) => void;
  /**
   * Chemin réservé à la page manuscrite : elle rend un **objet**, pas du texte.
   *
   * Sérialiser une page dense prend quelques dizaines de millisecondes ; le
   * faire au lever du stylet se voyait comme un accroc à la fin de chaque
   * lettre. La conversion est repoussée dans l'enregistrement différé, qui
   * arrive de toute façon après.
   */
  onDrawing: (next: DrawingContent) => void;
  onCanvasFull?: (full: boolean) => void;
  onPasteImage?: (image: File) => void;
  onPasteBlocs?: (blocs: BlocColle[]) => void;
  feuille?: { gauche: React.ReactNode; droite: React.ReactNode; sous: React.ReactNode };
  recherche?: RechercheInitiale;
}) {
  if (block.kind === "image") {
    const content: ImageBlockContent = parseImageBlock(block.content);
    return <ImageBlock content={content} onChange={(next) => onChange(JSON.stringify(next))} />;
  }
  if (block.kind === "table") {
    const content: TableContent = parseTable(block.content);
    return <TableBlock content={content} onChange={(next) => onChange(JSON.stringify(next))} />;
  }
  if (block.kind === "drawing") {
    return (
      <DrawingBlock
        content={analyserDessin(block.content)}
        scrollId={block.id}
        noteId={noteId}
        onFullChange={onCanvasFull}
        onChange={onDrawing}
        feuille={feuille}
        rechercheInitiale={recherche}
      />
    );
  }
  const content: TextContent = parseText(block.content);
  return (
    <TextBlock
      content={content}
      onChange={(next) => onChange(JSON.stringify(next))}
      onPasteImage={onPasteImage}
      onPasteBlocs={onPasteBlocs}
    />
  );
});
