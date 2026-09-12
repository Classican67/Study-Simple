"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight, Layers } from "lucide-react";

import { NoteThumbnail } from "@/components/note/note-thumbnail";
import { buildPreview, pageBands, parseDrawing, type NotePreview } from "@/lib/notes";
import { cn } from "@/lib/utils";

/**
 * Navigation entre les pages manuscrites d'une note.
 *
 * Un polycopié de quarante pages, c'est quarante pages sur une même surface :
 * sans ce repère, retrouver la vingt-septième demande de faire défiler à
 * l'aveugle. On affiche donc où l'on est, et l'on saute d'une page à l'autre.
 *
 * Le volet montre les pages, pas leurs numéros : on cherche « le schéma annoté
 * en rouge », jamais « la page 27 ».
 *
 * Naviguer ne change rien au document — c'est un défilement, rien d'autre.
 */
export function PageNavigator({
  pages,
  className,
}: {
  /** Les blocs manuscrits de la note, dans l'ordre. */
  pages: { id: string; content: string }[];
  className?: string;
}) {
  const [active, setActive] = React.useState(0);
  const [open, setOpen] = React.useState(false);
  /*
   * Les aperçus sont fabriqués à l'ouverture du volet, pas au fil de
   * l'écriture : le contenu change à chaque trait posé, et le volet n'a pas
   * besoin d'être à la seconde près pour qu'on s'y retrouve.
   */
  const [previews, setPreviews] = React.useState<NotePreview[]>([]);

  /*
   * Les pages, à plat.
   *
   * Un bloc manuscrit vaut une page, un bloc portant un document en vaut
   * autant que le document — toutes empilées sur la même surface, repérées par
   * leur hauteur dans cette pile.
   *
   * Relire les blocs à chaque rendu coûte une analyse JSON par bloc, et un
   * document entier n'en fait plus qu'un : la dépense est bornée.
   */
  const entrees: { blockId: string; top: number; ratio: number; page: number | null }[] = [];
  for (const bloc of pages) {
    const contenu = parseDrawing(bloc.content);
    const bandes = pageBands(contenu.pages);
    if (bandes.length === 0) {
      entrees.push({ blockId: bloc.id, top: 0, ratio: contenu.ratio, page: null });
      continue;
    }
    for (const bande of bandes) {
      entrees.push({ blockId: bloc.id, top: bande.top, ratio: bande.ratio, page: bande.page });
    }
  }

  /*
   * La page courante est celle qui occupe le milieu de l'écran.
   *
   * Les pages d'un document défilent **dans** leur surface, et un événement de
   * défilement ne remonte pas : on écoute donc à la capture, sur la fenêtre,
   * ce qui attrape aussi bien la page que les surfaces qu'elle contient.
   */
  const nombre = entrees.length;
  const cles = entrees.map((e) => `${e.blockId}:${e.top}`).join("|");
  React.useEffect(() => {
    if (nombre < 2) return;
    let attente = 0;

    const calculer = () => {
      attente = 0;
      const surfaces = new Map<string, { haut: number; largeur: number; defilement: number }>();
      let index = 0;
      let meilleur = { index: 0, ecart: Infinity };
      const milieu = window.innerHeight / 2;

      for (const cle of cles.split("|")) {
        const [blockId, top] = cle.split(":");
        let surface = surfaces.get(blockId);
        if (!surface) {
          const el = document.querySelector<HTMLElement>(`[data-ink-scroll="${blockId}"]`);
          if (!el) {
            index++;
            continue;
          }
          surface = {
            haut: el.getBoundingClientRect().top,
            largeur: el.clientWidth,
            defilement: el.scrollTop,
          };
          surfaces.set(blockId, surface);
        }
        const y = surface.haut - surface.defilement + Number(top) * surface.largeur;
        const ecart = Math.abs(y - milieu);
        if (ecart < meilleur.ecart) meilleur = { index, ecart };
        index++;
      }
      setActive(meilleur.index);
    };

    const planifier = () => {
      if (attente) return;
      attente = window.requestAnimationFrame(calculer);
    };

    calculer();
    window.addEventListener("scroll", planifier, true);
    return () => {
      window.removeEventListener("scroll", planifier, true);
      if (attente) window.cancelAnimationFrame(attente);
    };
  }, [nombre, cles]);

  if (nombre < 2) return null;

  const aller = (index: number) => {
    const cible = Math.max(0, Math.min(nombre - 1, index));
    const entree = entrees[cible];
    document
      .getElementById(`bloc-${entree.blockId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
    const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${entree.blockId}"]`);
    surface?.scrollTo({ top: entree.top * surface.clientWidth, behavior: "smooth" });
    setActive(cible);
    setOpen(false);
  };

  const apercu = (index: number): NotePreview => {
    const entree = entrees[index];
    // Une page de document se montre telle qu'elle est, sans rien relire.
    if (entree.page !== null) {
      const bloc = pages.find((b) => b.id === entree.blockId);
      const contenu = bloc ? parseDrawing(bloc.content) : null;
      const bande = contenu?.pages.find((p) => p.page === entree.page);
      if (bande) return { kind: "pdf", file: bande.file, page: bande.page, ratio: bande.ratio };
    }
    const bloc = pages.find((b) => b.id === entree.blockId);
    return bloc ? buildPreview("drawing", bloc.content) : null;
  };

  return (
    <div className={cn("relative flex items-center gap-0.5", className)}>
      <button
        type="button"
        onClick={() => aller(active - 1)}
        disabled={active === 0}
        aria-label="Page manuscrite précédente"
        className="grid size-11 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
      >
        <ChevronLeft className="size-5" />
      </button>

      <button
        type="button"
        onClick={() => {
          if (!open) setPreviews(entrees.map((_, index) => apercu(index)));
          setOpen((o) => !o);
        }}
        aria-expanded={open}
        aria-label={`Page ${active + 1} sur ${nombre}. Choisir une page`}
        className="flex min-h-11 items-center gap-1.5 rounded-full bg-surface-container px-3 m3-label-medium tabular-nums text-on-surface-variant transition-colors hover:text-on-surface"
      >
        <Layers className="size-4" />
        {active + 1} / {nombre}
      </button>

      <button
        type="button"
        onClick={() => aller(active + 1)}
        disabled={active === nombre - 1}
        aria-label="Page manuscrite suivante"
        className="grid size-11 place-items-center rounded-full text-on-surface-variant transition-colors hover:text-on-surface disabled:opacity-40"
      >
        <ChevronRight className="size-5" />
      </button>

      {open ? (
        <>
          {/* Un voile invisible ferme le volet au premier clic à côté : sans
              lui, il resterait ouvert derrière le doigt. */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default"
          />
          <ul
            aria-label="Pages manuscrites"
            // Le volet s'ajuste à ce qu'il contient : une grille à trois
            // colonnes laissait un trou béant pour une note de deux pages.
            className="scroll-slim absolute bottom-full right-0 z-50 mb-2 flex max-h-[60vh] w-max max-w-[19rem] flex-wrap justify-center gap-2 overflow-y-auto rounded-2xl border border-outline-variant bg-surface-container p-2 elevation-3"
          >
            {entrees.map((entree, index) => (
              <li key={`${entree.blockId}-${entree.top}`} className="w-24">
                <button
                  type="button"
                  onClick={() => aller(index)}
                  aria-current={index === active ? "true" : undefined}
                  aria-label={`Page ${index + 1}`}
                  className="w-full rounded-xl p-1 text-left transition-colors hover:bg-surface-container-high"
                >
                  <NoteThumbnail
                    preview={previews[index] ?? null}
                    className={cn(
                      "w-full rounded-lg border-2 transition-colors",
                      index === active ? "border-primary" : "border-outline-variant",
                    )}
                    style={{ aspectRatio: `1 / ${entree.ratio}` }}
                  />
                  <span
                    className={cn(
                      "mt-1 block text-center tabular-nums m3-label-small",
                      index === active ? "text-primary" : "text-on-surface-variant",
                    )}
                  >
                    {index + 1}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
