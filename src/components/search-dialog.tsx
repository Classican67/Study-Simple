"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { CornerDownLeft, Layers, Loader2, Search, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/dialog";
import { search } from "@/app/(app)/search/actions";
import type { SearchResult } from "@/lib/decks";
import { deckColor } from "@/lib/deck-colors";
import { excerpt, highlight, searchTerms } from "@/lib/search";
import { cn } from "@/lib/utils";

/**
 * Recherche de cartes — globale, ou restreinte à un paquet.
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
        title={deckTitle ? `Rechercher dans « ${deckTitle} »` : "Rechercher une carte"}
        description={
          deckTitle
            ? "Dans ce paquet uniquement."
            : "Dans tous tes paquets. Les accents et la casse sont ignorés."
        }
        className="sm:max-w-2xl"
      >
        <SearchPanel deckId={deckId} onNavigate={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  );
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
  const [active, setActive] = React.useState(0);

  /**
   * Les résultats sont conservés AVEC la requête qui les a produits. Tout le
   * reste — « en cours », « rien trouvé », liste affichée — s'en déduit au
   * rendu, au lieu d'être recopié dans des états qu'il faudrait remettre à
   * zéro depuis un effet à chaque frappe.
   */
  const [found, setFound] = React.useState<{
    query: string;
    items: SearchResult[];
    failed?: boolean;
  } | null>(null);

  // Chaque requête porte un numéro : une réponse lente arrivée après une plus
  // récente doit être jetée, sinon la liste revient en arrière toute seule.
  const requestId = React.useRef(0);

  const tooShort = query.trim().length < 2;
  const fresh = found !== null && found.query === query;
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
      const outcome = await search(deckId, query).then(
        (items) => ({ query, items }),
        () => ({ query, items: [] as SearchResult[], failed: true }),
      );
      if (id !== requestId.current) return;
      setFound(outcome);
    }, DEBOUNCE_MS);

    return () => window.clearTimeout(timer);
  }, [query, deckId, tooShort]);

  const terms = React.useMemo(() => searchTerms(query), [query]);
  // Les résultats ont pu raccourcir depuis le dernier déplacement au clavier.
  const activeIndex = results.length === 0 ? 0 : Math.min(active, results.length - 1);

  function go(result: SearchResult) {
    onNavigate();
    // L'ancre amène directement sur la carte dans l'éditeur du paquet.
    router.push(`/decks/${result.deckId}#card-${result.cardId}`);
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
          placeholder="Terme, définition…"
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
          Aucune carte ne contient {terms.length > 1 ? "tous ces mots" : "ce mot"}.
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
            {results.map((result, index) => (
              <li key={result.cardId}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onClick={() => go(result)}
                  onMouseEnter={() => setActive(index)}
                  className={cn(
                    "state-layer flex w-full items-start gap-3 rounded-lg p-3 text-left transition-colors",
                    index === activeIndex ? "bg-surface-high" : "bg-transparent",
                  )}
                >
                  <span
                    className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-sm text-white"
                    style={{ backgroundColor: deckColor(result.deckColor) }}
                  >
                    <Layers className="size-4" />
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate m3-title-small text-on-surface">
                      <Highlighted text={result.term} terms={terms} />
                    </span>
                    <span className="mt-0.5 block line-clamp-2 m3-body-small text-on-surface-variant">
                      <Highlighted text={excerpt(result.definition, terms)} terms={terms} />
                    </span>
                    {/* Le paquet n'a d'intérêt qu'en recherche globale. */}
                    {deckId === null ? (
                      <span className="mt-1 block truncate m3-label-small text-on-surface-variant/80">
                        {result.deckTitle}
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
