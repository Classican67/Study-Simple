"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Layers, Loader2, NotebookPen, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { search, type SearchAnswer } from "@/app/(app)/search/actions";
import type { SearchResult } from "@/lib/decks";
import type { NoteSearchResult } from "@/lib/note-queries";
import { deckColor } from "@/lib/deck-colors";
import { excerpt, highlight, searchTerms, type SearchScope } from "@/lib/search";
import { cn } from "@/lib/utils";

/**
 * Recherche — dans les cartes ou dans les notes, au choix.
 *
 * Les deux ne se cherchent pas pareil : on cherche un terme à réviser, ou un
 * cours à relire. Mêler les deux listes obligerait à trier du regard ce qu'on
 * sait déjà en tapant.
 *
 * Ouverte au clavier par Ctrl/⌘ + K, la convention des applications modernes.
 * La liste se parcourt aux flèches et se valide par Entrée : sur un paquet
 * fourni, atteindre un résultat sans lâcher le clavier change tout.
 */

// La frappe est plus rapide que la base : sans ce délai, chaque lettre
// lancerait une requête dont le résultat serait aussitôt périmé.
const DEBOUNCE_MS = 180;

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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
            : "Dans tes paquets ou dans tes notes. Les accents et la casse sont ignorés."
        }
        className="sm:max-w-2xl"
      >
        <SearchPanel deckId={deckId} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
}

/** Une ligne de résultat, carte ou note : la liste en mêle les deux formes. */
type Ligne =
  | { kind: "card"; card: SearchResult }
  | { kind: "note"; note: NoteSearchResult };

function lignes(answer: SearchAnswer): Ligne[] {
  return answer.scope === "notes"
    ? answer.notes.map((note) => ({ kind: "note" as const, note }))
    : answer.cards.map((card) => ({ kind: "card" as const, card }));
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
  const [scope, setScope] = React.useState<SearchScope>("cards");
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
  const results = fresh ? found.items : [];
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

  function go(ligne: Ligne) {
    onNavigate();
    // L'ancre amène directement sur la carte dans l'éditeur du paquet.
    if (ligne.kind === "card") router.push(`/decks/${ligne.card.deckId}#card-${ligne.card.cardId}`);
    else router.push(`/notes/${ligne.note.noteId}`);
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
      go(results[activeIndex]);
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
          placeholder={scope === "notes" ? "Titre, contenu…" : "Terme, définition…"}
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

      {!pending && searched && !failed && results.length === 0 ? (
        <p className="py-8 text-center m3-body-medium text-on-surface-variant">
          Aucune {scope === "notes" ? "note" : "carte"} ne contient{" "}
          {terms.length > 1 ? "tous ces mots" : "ce mot"}.
        </p>
      ) : null}

      {!pending && results.length > 0 ? (
        <>
          <p className="m3-label-medium text-on-surface-variant">
            {results.length} résultat{results.length > 1 ? "s" : ""}
          </p>
          {/* `listbox` et `option` : la liste est parcourue aux flèches depuis
              le champ, pas au Tab — c'est le motif attendu par les lecteurs
              d'écran pour une recherche à suggestions. */}
          <ul role="listbox" aria-label="Résultats" className="scroll-slim max-h-[45dvh] space-y-1 overflow-y-auto">
            {results.map((ligne, index) => (
              <li key={ligne.kind === "card" ? ligne.card.cardId : ligne.note.noteId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => go(ligne)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "state-layer flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                    index === activeIndex ? "bg-surface-high" : "bg-transparent",
                  )}
                >
                  {ligne.kind === "card" ? (
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

                  <span className="min-w-0 flex-1">
                    <span className="block truncate m3-title-small text-on-surface">
                      <Highlighted
                        text={ligne.kind === "card" ? ligne.card.term : ligne.note.title}
                        terms={terms}
                      />
                    </span>
                    <span className="mt-0.5 block line-clamp-2 m3-body-small text-on-surface-variant">
                      <Highlighted
                        text={
                          ligne.kind === "card"
                            ? excerpt(ligne.card.definition, terms)
                            : ligne.note.excerpt
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
                    ) : ligne.note.folder ? (
                      <span className="mt-1 block truncate m3-label-small text-on-surface-variant/80">
                        {ligne.note.folder}
                      </span>
                    ) : null}
                  </span>

                  {index === activeIndex ? (
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
