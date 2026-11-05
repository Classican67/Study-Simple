"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  BarChart3,
  CalendarClock,
  CornerDownLeft,
  FileText,
  HardDriveUpload,
  Layers,
  Loader2,
  NotebookPen,
  PenLine,
  Plus,
  Search,
  Sparkle,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { createNote } from "@/app/(app)/notes/actions";
import { search, type SearchAnswer } from "@/app/(app)/search/actions";
import type { SearchResult } from "@/lib/decks";
import type { NoteSearchResult } from "@/lib/note-queries";
import { deckColor } from "@/lib/deck-colors";
import { excerpt, fold, highlight, searchTerms, type SearchScope } from "@/lib/search";
import { cn } from "@/lib/utils";

/**
 * Recherche — une notion, où qu'elle soit.
 *
 * Sur une carte, dans ce qu'on a écrit, ou au fond d'un polycopié importé : chaque
 * page trouvée d'un document est un résultat à part entière, qui ouvre la note à
 * cette page, le mot surligné.
 *
 * Ouverte au clavier par Ctrl/⌘ + K, la convention des applications modernes.
 * La liste se parcourt aux flèches et se valide par Entrée : sur un paquet
 * fourni, atteindre un résultat sans lâcher le clavier change tout.
 */

// La frappe est plus rapide que la base : sans ce délai, chaque lettre
// lancerait une requête dont le résultat serait aussitôt périmé.
const DEBOUNCE_MS = 180;

/** La colonne latérale ouvre la recherche par cet événement : un seul dialogue monté. */
export const OUVRIR_RECHERCHE = "fiches:recherche";

export function SearchDialog({
  deckId = null,
  deckTitle,
}: {
  /** Restreint la recherche à ce paquet. Sans lui, elle porte sur tout le compte. */
  deckId?: string | null;
  deckTitle?: string;
}) {
  const [open, setOpen] = React.useState(false);

  // Ctrl/⌘ + K, où que soit le focus — sauf dans un champ de saisie, où le
  // raccourci appartient à ce que l'utilisateur est en train d'écrire.
  React.useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key.toLowerCase() !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      event.preventDefault();
      setOpen(true);
    }
    const ouvrir = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OUVRIR_RECHERCHE, ouvrir);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OUVRIR_RECHERCHE, ouvrir);
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="toolbar-icon"
          size="icon"
          // Le déclencheur voisine des titres qui prennent toute la largeur :
          // sans cela, flexbox le comprime sous la cible tactile de 48 px.
          className="shrink-0"
          title={deckTitle ? `Rechercher dans « ${deckTitle} »` : "Rechercher (Ctrl+K)"}
          aria-label={deckTitle ? `Rechercher dans ${deckTitle}` : "Rechercher"}
        >
          <Search />
        </Button>
      </DialogTrigger>

      <DialogContent
        title={deckTitle ? `Rechercher dans « ${deckTitle} »` : "Rechercher"}
        description={
          deckTitle
            ? "Dans ce paquet, ou dans toutes tes notes."
            : "Dans tes paquets, tes notes et leurs documents. Les accents et la casse sont ignorés."
        }
        className="sm:max-w-2xl"
      >
        <SearchPanel deckId={deckId} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Les gestes les plus courants, au même endroit que la recherche.
 *
 * Ce qu'on vient chercher dans ce champ, c'est souvent d'aller quelque part : un
 * raccourci de plus à retenir ne vaudrait pas une liste qui se filtre en tapant.
 */
type Action = { id: string; label: string; icon: React.ElementType; href?: string };

const ACTIONS: Action[] = [
  { id: "note", label: "Nouvelle note", icon: Plus },
  { id: "reviser", label: "Réviser maintenant", icon: CalendarClock, href: "/study" },
  { id: "bilan", label: "Voir le bilan", icon: BarChart3, href: "/stats" },
  { id: "notes", label: "Aller aux notes", icon: NotebookPen, href: "/notes" },
  { id: "paquets", label: "Aller aux paquets", icon: Layers, href: "/" },
  { id: "sauvegarde", label: "Sauvegarde", icon: HardDriveUpload, href: "/sauvegarde" },
  { id: "stylet", label: "Diagnostic du stylet", icon: PenLine, href: "/diagnostic-stylet" },
];

/** Une ligne de résultat : une carte, une note, ou une page de l'un de ses documents. */
type Ligne =
  | { kind: "action"; action: Action }
  | { kind: "card"; card: SearchResult }
  | { kind: "note"; note: NoteSearchResult }
  | { kind: "page"; note: NoteSearchResult; page: NoteSearchResult["pages"][number] };

function lignes(answer: SearchAnswer): Ligne[] {
  const notes = answer.notes.flatMap((note): Ligne[] => [
    { kind: "note", note },
    ...note.pages.map((page) => ({ kind: "page" as const, note, page })),
  ]);
  const cartes = answer.cards.map((card): Ligne => ({ kind: "card", card }));
  // Les cartes d'abord : c'est court, et une réponse exacte se lit tout de suite.
  return [...cartes, ...notes];
}

function cleDe(ligne: Ligne): string {
  if (ligne.kind === "action") return `action-${ligne.action.id}`;
  if (ligne.kind === "card") return ligne.card.cardId;
  if (ligne.kind === "note") return ligne.note.noteId;
  return `${ligne.note.noteId}-${ligne.page.file}-${ligne.page.page}`;
}

function SearchPanel({
  deckId,
  onNavigate,
}: {
  deckId: string | null;
  onNavigate: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  // Dans un paquet, c'est lui qu'on interroge d'abord.
  const [scope, setScope] = React.useState<SearchScope>(deckId ? "cards" : "all");
  const [active, setActive] = React.useState(0);

  /**
   * Les résultats sont conservés AVEC la requête et la portée qui les ont
   * produits. Tout le reste — « en cours », « rien trouvé », liste affichée —
   * s'en déduit au rendu, au lieu d'être recopié dans des états qu'il faudrait
   * remettre à zéro depuis un effet à chaque frappe.
   */
  const [found, setFound] = React.useState<{
    query: string;
    scope: SearchScope;
    items: Ligne[];
    failed?: boolean;
  } | null>(null);

  // Chaque requête porte un numéro : une réponse lente arrivée après une plus
  // récente doit être jetée, sinon la liste revient en arrière toute seule.
  const requestId = React.useRef(0);

  const tooShort = query.trim().length < 2;
  const fresh = found !== null && found.query === query && found.scope === scope;
  const trouves = fresh ? found.items : [];
  // Sur un mot précis, seules les actions qui lui ressemblent passent devant.
  const actions = React.useMemo(() => {
    const requete = fold(query.trim());
    if (deckId) return [];
    return ACTIONS.filter((a) => !requete || fold(a.label).includes(requete)).map(
      (action): Ligne => ({ kind: "action", action }),
    );
  }, [query, deckId]);
  const results = [...actions, ...trouves];
  const failed = fresh && found.failed === true;
  const pending = !tooShort && !fresh;
  const searched = fresh;

  React.useEffect(() => {
    if (tooShort) {
      // Rien à chercher : on invalide simplement les requêtes en vol.
      requestId.current++;
      return;
    }

    const id = ++requestId.current;
    const timer = window.setTimeout(async () => {
      // Une panne serveur ne doit pas se déguiser en « aucun résultat » : ce
      // sont deux situations opposées, et les confondre fait chercher un
      // problème de contenu là où il y a un problème d'application.
      const outcome = await search(scope, deckId, query).then(
        (answer) => ({ query, scope, items: lignes(answer) }),
        () => ({ query, scope, items: [] as Ligne[], failed: true }),
      );
      if (id !== requestId.current) return;
      setFound(outcome);
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, scope, deckId, tooShort]);

  const terms = React.useMemo(() => searchTerms(query), [query]);
  // Les résultats ont pu raccourcir depuis le dernier déplacement au clavier.
  const activeIndex = results.length === 0 ? 0 : Math.min(active, results.length - 1);

  async function go(ligne: Ligne) {
    onNavigate();
    if (ligne.kind === "action") {
      if (ligne.action.href) router.push(ligne.action.href);
      else {
        const id = await createNote().catch(() => null);
        if (id) router.push(`/notes/${id}`);
      }
      return;
    }
    // L'ancre amène directement sur la carte dans l'éditeur du paquet.
    if (ligne.kind === "card") router.push(`/decks/${ligne.card.deckId}#card-${ligne.card.cardId}`);
    else if (ligne.kind === "note") router.push(`/notes/${ligne.note.noteId}`);
    else {
      // La note s'ouvre à la page trouvée, avec la loupe déjà ouverte sur le mot.
      const adresse = new URLSearchParams({
        cherche: query.trim(),
        doc: ligne.page.file,
        page: String(ligne.page.page),
      });
      router.push(`/notes/${ligne.note.noteId}?${adresse}`);
    }
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (results.length === 0) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      void go(results[activeIndex]);
    }
  }

  return (
    <div className="space-y-4">
      {/* Où l'on cherche. Au-dessus du champ : le choix précède la frappe. */}
      <div
        role="group"
        aria-label="Chercher dans"
        className="flex gap-1 rounded-full bg-surface-high p-1"
      >
        {(
          [
            { value: "all", label: "Tout", icon: Sparkle },
            { value: "cards", label: deckId ? "Ce paquet" : "Paquets", icon: Layers },
            { value: "notes", label: "Notes", icon: NotebookPen },
          ] as const
        ).map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setScope(value);
              setActive(0);
            }}
            aria-pressed={scope === value}
            className={cn(
              "flex min-h-11 flex-1 items-center justify-center gap-2 rounded-full px-4 m3-label-large transition-colors",
              scope === value
                ? "bg-primary-container text-on-primary-container"
                : "text-on-surface-variant hover:text-on-surface",
            )}
          >
            <Icon className="size-4" />
            {label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-on-surface-variant" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            // Nouvelle requête : on repart du premier résultat.
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          autoFocus
          type="search"
          // Le clavier logiciel affiche « Rechercher » plutôt que « Entrée ».
          enterKeyHint="search"
          autoComplete="off"
          spellCheck={false}
          placeholder={scope === "cards" ? "Terme, définition…" : "Une notion, un mot de ton cours…"}
          aria-label="Rechercher"
          className="h-14 w-full rounded-full bg-surface-high pl-12 pr-12 m3-body-large text-on-surface placeholder:text-on-surface-variant/70 focus:outline-none focus:ring-2 focus:ring-primary"
        />
        {query ? (
          <button
            type="button"
            onClick={() => setQuery("")}
            aria-label="Effacer"
            className="state-layer absolute right-2 top-1/2 grid size-11 -translate-y-1/2 place-items-center rounded-full text-on-surface-variant"
          >
            <X className="size-5" />
          </button>
        ) : null}
      </div>

      {pending ? (
        <p className="flex items-center justify-center gap-2 py-8 m3-body-medium text-on-surface-variant">
          <Loader2 className="size-4 animate-spin" />
          Recherche…
        </p>
      ) : null}

      {!pending && failed ? (
        <p role="alert" className="py-8 text-center m3-body-medium text-error">
          La recherche n&apos;a pas abouti. Réessaie dans un instant.
        </p>
      ) : null}

      {!pending && searched && !failed && trouves.length === 0 ? (
        <p className="py-8 text-center m3-body-medium text-on-surface-variant">
          {scope === "all" ? "Rien" : `Aucune ${scope === "notes" ? "note" : "carte"}`} ne contient{" "}
          {terms.length > 1 ? "tous ces mots" : "ce mot"}.
        </p>
      ) : null}

      {results.length > 0 ? (
        <>
          {trouves.length > 0 ? (
            <p className="m3-label-medium text-on-surface-variant">
              {trouves.length} résultat{trouves.length > 1 ? "s" : ""}
            </p>
          ) : null}
          {/* `listbox` et `option` : la liste est parcourue aux flèches depuis
              le champ, pas au Tab — c'est le motif attendu par les lecteurs
              d'écran pour une recherche à suggestions. */}
          <ul role="listbox" aria-label="Résultats" className="scroll-slim max-h-[45dvh] space-y-1 overflow-y-auto">
            {results.map((ligne, index) => (
              <li key={cleDe(ligne)}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => void go(ligne)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "state-layer flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                    // Une page se range sous la note qui la porte.
                    ligne.kind === "page" && "pl-8",
                    index === activeIndex ? "bg-surface-high" : "bg-transparent",
                  )}
                >
                  {ligne.kind === "action" ? (
                    <>
                      <span className="grid size-8 shrink-0 place-items-center rounded-sm bg-primary-container text-on-primary-container">
                        <ligne.action.icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1 self-center m3-title-small text-on-surface">
                        {ligne.action.label}
                      </span>
                      <ArrowRight className="mt-1.5 size-4 shrink-0 text-on-surface-variant" />
                    </>
                  ) : null}
                  {ligne.kind === "action" ? null : ligne.kind === "page" ? (
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-sm bg-tertiary-container text-on-tertiary-container">
                      <FileText className="size-4" />
                    </span>
                  ) : ligne.kind === "card" ? (
                    <span
                      className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-sm text-white"
                      style={{ backgroundColor: deckColor(ligne.card.deckColor) }}
                    >
                      <Layers className="size-4" />
                    </span>
                  ) : (
                    <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-sm bg-secondary-container text-on-secondary-container">
                      <NotebookPen className="size-4" />
                    </span>
                  )}

                  {ligne.kind === "action" ? null : (
                  <span className="min-w-0 flex-1">
                    <span className="block truncate m3-title-small text-on-surface">
                      {ligne.kind === "page" ? (
                        `Page ${ligne.page.page}`
                      ) : (
                        <Highlighted
                          text={ligne.kind === "card" ? ligne.card.term : ligne.note.title}
                          terms={terms}
                        />
                      )}
                    </span>
                    <span className="mt-0.5 block line-clamp-2 m3-body-small text-on-surface-variant">
                      <Highlighted
                        text={
                          ligne.kind === "card"
                            ? excerpt(ligne.card.definition, terms)
                            : ligne.kind === "page"
                              ? ligne.page.extrait
                              : ligne.note.excerpt ||
                                `Dans ses documents : ${ligne.note.totalPages} page${ligne.note.totalPages > 1 ? "s" : ""}`
                        }
                        terms={terms}
                      />
                    </span>
                    {/* D'où vient le résultat : le paquet n'a d'intérêt qu'en
                        recherche globale, le dossier que s'il y en a un. */}
                    {ligne.kind === "card" ? (
                      deckId === null ? (
                        <span className="mt-1 block truncate m3-label-small text-on-surface-variant/80">
                          {ligne.card.deckTitle}
                        </span>
                      ) : null
                    ) : ligne.kind === "page" ? (
                      ligne.page.ocr ? (
                        <span className="mt-1 block m3-label-small text-on-surface-variant/80">
                          Lu sur le scan
                        </span>
                      ) : null
                    ) : ligne.note.folder ? (
                      <span className="mt-1 block truncate m3-label-small text-on-surface-variant/80">
                        {ligne.note.folder}
                      </span>
                    ) : null}
                  </span>
                  )}

                  {ligne.kind !== "action" && index === activeIndex ? (
                    <CornerDownLeft className="mt-1 size-4 shrink-0 text-on-surface-variant" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}

/** Rend un texte en soulignant les occurrences de la requête. */
function Highlighted({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {highlight(text, terms).map((segment, index) =>
        segment.match ? (
          <mark key={index} className="rounded-xs bg-primary-container px-0.5 text-on-primary-container">
            {segment.text}
          </mark>
        ) : (
          <React.Fragment key={index}>{segment.text}</React.Fragment>
        ),
      )}
    </>
  );
}
