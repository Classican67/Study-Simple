"use client";

import * as React from "react";

import { InkCanvas, type InkTool } from "@/components/note/ink-canvas";
import { InkPalette, type InkSettings } from "@/components/note/ink-palette";
import type { Ruler, Shape } from "@/lib/ink";
import {
  MAX_DOCUMENT_PAGES,
  MAX_RATIO,
  insertPage,
  isBackdropPage,
  pageBands,
  removePage,
  type BlankPage,
  type DrawingContent,
  type Paper,
} from "@/lib/notes";

/** Versions retenues pour Annuler : bien plus qu'on n'en remonte jamais. */
const HISTORIQUE_MAX = 200;

/**
 * Page manuscrite : le canevas, ses outils, et le plein écran.
 *
 * Le plein écran n'est pas un confort : sur iPad, écrire dans un bloc haut de
 * dix centimètres au milieu d'une page qui défile est intenable. La page prend
 * donc tout l'écran, la palette flotte par-dessus, et l'application disparaît —
 * on est devant une feuille.
 */

export function DrawingBlock({
  content: recu,
  onChange: remonter,
  readOnly = false,
  scrollId,
  onFullChange,
}: {
  content: DrawingContent;
  onChange: (next: DrawingContent) => void;
  readOnly?: boolean;
  /** Repère du bloc, pour que le volet de pages sache où défiler. */
  scrollId?: string;
  /** Prévient la page qu'on écrit — ou non — en plein écran. */
  onFullChange?: (full: boolean) => void;
}) {
  /*
   * La page vit ici, et le parent n'en est prévenu qu'après un temps de repos.
   *
   * L'enregistrement est différé de sept cents millisecondes : sans état local,
   * la palette et l'annulation travailleraient pendant tout ce temps sur la
   * version précédente — on annulait un trait et c'est l'avant-dernier qui
   * partait.
   */
  const [content, setContent] = React.useState(recu);
  // Notre propre écho, pour ne pas se remettre à zéro dessus.
  const mien = React.useRef<DrawingContent | null>(null);
  // Le contenu courant, lisible sans attendre un rendu : un trait posé puis un
  // toucher à deux doigts dans la même image liraient sinon la même version.
  const actuel = React.useRef(recu);

  /*
   * Historique : des instantanés du contenu, pas une pile de traits.
   *
   * Annuler retirait « le dernier trait » quelle que soit l'action annulée.
   * Après un coup de gomme, il effaçait donc un trait de plus au lieu de rendre
   * le trait gommé ; après « Effacer toute la page », il n'avait plus rien à
   * retirer et la page était perdue. Chaque action — trait, gomme, sélection
   * déplacée ou supprimée, page ajoutée, fond changé — laisse désormais la
   * version d'avant, et Annuler y revient telle quelle.
   *
   * Le coût est faible : les traits sont immuables, deux versions voisines
   * partagent tous ceux qu'elles ont en commun.
   */
  const passe = React.useRef<DrawingContent[]>([]);
  const futur = React.useRef<DrawingContent[]>([]);
  const [historique, setHistorique] = React.useState({ annuler: false, retablir: false });
  const direHistorique = React.useCallback(() => {
    setHistorique({ annuler: passe.current.length > 0, retablir: futur.current.length > 0 });
  }, []);

  React.useEffect(() => {
    if (recu === mien.current) return;
    actuel.current = recu;
    setContent(recu);
    // Un contenu venu d'ailleurs — chargement, duplication — n'a pas de passé
    // ici : y revenir écraserait ce qui vient d'arriver.
    passe.current = [];
    futur.current = [];
    direHistorique();
  }, [recu, direHistorique]);

  /** Montre et enregistre un contenu, sans rien inscrire à l'historique. */
  const appliquer = React.useCallback(
    (next: DrawingContent) => {
      mien.current = next;
      actuel.current = next;
      setContent(next);
      remonter(next);
    },
    [remonter],
  );

  const onChange = React.useCallback(
    (next: DrawingContent) => {
      const avant = actuel.current;
      // Allonger la page en plein écran n'est pas une action : l'annuler la
      // raccourcirait sous la main.
      if (next.strokes !== avant.strokes || next.pages !== avant.pages || next.paper !== avant.paper) {
        passe.current = [...passe.current, avant].slice(-HISTORIQUE_MAX);
        futur.current = [];
        direHistorique();
      }
      appliquer(next);
    },
    [appliquer, direHistorique],
  );

  const [tool, setTool] = React.useState<InkTool>("pen");
  /*
   * Le stylo et le surligneur retiennent chacun leur couleur et leur épaisseur.
   *
   * Un réglage commun oblige à tout refaire à chaque changement d'outil : on
   * surligne en jaune épais, on reprend le stylo, et il écrit en jaune épais.
   * C'est ce que font les applications de référence, et c'est ce qui rend
   * l'aller-retour entre les deux supportable.
   */
  const [pen, setPen] = React.useState<InkSettings>({ color: "default", size: 2.5 });
  const [highlighter, setHighlighter] = React.useState<InkSettings>({ color: "amber", size: 4 });
  // La gomme peut ne retirer que les surlignages : on surligne beaucoup, on se
  // trompe souvent, et effacer l'écriture par la même occasion est rageant.
  const [eraseHighlightsOnly, setEraseHighlightsOnly] = React.useState(false);
  const [erasePrecise, setErasePrecise] = React.useState(false);
  // Verrou : le doigt n'écrit pas, même avant qu'un stylet ait servi. Utile
  // quand on pose la main sur l'écran avant d'approcher le stylet.
  const [penOnly, setPenOnly] = React.useState(false);
  const [full, setFull] = React.useState(false);
  // Le rejet de la paume est invisible : le doigt cesse d'écrire sans rien dire.
  // On l'annonce, sinon on croit à une panne.
  const [penMode, setPenMode] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const [shape, setShape] = React.useState<Shape>("rect");
  // La sélection du lasso appartient au bloc : c'est lui qui propose de la
  // supprimer, et supprimer revient à réécrire la liste des traits.
  const [selection, setSelection] = React.useState<number[]>([]);
  // La règle est posée ou rangée ; elle n'est pas un outil, on continue
  // d'écrire au stylo pendant qu'elle est là.
  const [ruler, setRuler] = React.useState<Ruler | null>(null);
  // Remonter le canevas remet la vue à sa position d'origine : il n'y a rien à
  // réinitialiser à la main, les traits venant du contenu.
  const [viewKey, setViewKey] = React.useState(0);
  /*
   * Page courante : celle qui occupe le milieu de la fenêtre.
   *
   * Une surface peut porter quarante pages. « Ajouter une page » ne veut donc
   * rien dire sans savoir **après laquelle**, et le choix du fond porte sur la
   * page qu'on a sous les yeux, pas sur toute la pile.
   */
  const [pageIndex, setPageIndex] = React.useState(0);

  function undo() {
    const precedent = passe.current.at(-1);
    if (!precedent) return;
    passe.current = passe.current.slice(0, -1);
    futur.current = [...futur.current, actuel.current];
    direHistorique();
    // Les rangs retenus par le lasso désignent des traits d'une autre version.
    setSelection([]);
    appliquer(precedent);
  }

  function redo() {
    const suivant = futur.current.at(-1);
    if (!suivant) return;
    futur.current = futur.current.slice(0, -1);
    passe.current = [...passe.current, actuel.current];
    direHistorique();
    setSelection([]);
    appliquer(suivant);
  }

  function deleteSelection() {
    if (selection.length === 0) return;
    const retires = new Set(selection);
    const courant = actuel.current;
    setSelection([]);
    onChange({ ...courant, strokes: courant.strokes.filter((_, i) => !retires.has(i)) });
  }

  function clear() {
    const courant = actuel.current;
    if (courant.strokes.length === 0) return;
    onChange({ ...courant, strokes: [] });
  }

  /*
   * Ce que la palette peut proposer, selon la page qu'on regarde.
   *
   * Trois cas, et ils ne se confondent pas : une surface d'une seule page —
   * dont le fond appartient à la surface elle-même — une page du document
   * importé, dont l'image **est** le fond, et une page ajoutée, qui porte le
   * sien.
   */
  const pages = content.pages;
  const courante = pages[Math.min(pageIndex, pages.length - 1)];
  const surDocument = Boolean(courante) && isBackdropPage(courante);
  const ajoutee = Boolean(courante) && !isBackdropPage(courante);
  const fond = ajoutee ? (courante as BlankPage).paper : content.paper;

  function choisirFond(paper: Paper) {
    if (!ajoutee) {
      onChange({ ...content, paper });
      return;
    }
    onChange({
      ...content,
      pages: pages.map((p, i) => (i === pageIndex && !isBackdropPage(p) ? { ...p, paper } : p)),
    });
  }

  /**
   * Glisse une feuille après la page courante, et l'amène sous les yeux.
   *
   * Sans le défilement, la page apparaît hors de l'écran : rien ne bouge, et
   * l'on appuie une deuxième fois en croyant que ça n'a pas marché.
   */
  function ajouterPage() {
    if (pages.length === 0 || pages.length >= MAX_DOCUMENT_PAGES) return;
    const suivant = insertPage(content, pageIndex, fond);
    if (suivant === content) return;
    onChange(suivant);
    const bandes = pageBands(suivant.pages);
    const arrivee = bandes[Math.min(pageIndex + 1, bandes.length - 1)];
    setPageIndex(Math.min(pageIndex + 1, suivant.pages.length - 1));
    // Après le rendu : la surface n'a pas encore sa nouvelle hauteur.
    requestAnimationFrame(() => {
      const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${scrollId}"]`);
      if (surface) surface.scrollTop = arrivee.top * surface.clientWidth;
    });
  }

  function supprimerPage() {
    const suivant = removePage(content, pageIndex);
    if (suivant === content) return;
    setPageIndex(Math.max(0, Math.min(pageIndex, suivant.pages.length - 1)));
    onChange(suivant);
  }

  const surfaceRef = React.useRef<HTMLDivElement>(null);
  // Hauteur disponible pour la feuille en plein écran, palette déduite.
  const [fullHeight, setFullHeight] = React.useState(0);

  /*
   * À l'ouverture, la page est allongée pour remplir l'écran.
   *
   * Sans cela, une page au format par défaut laisse une bande vide sous elle :
   * on ouvre le plein écran et la surface d'écriture n'occupe que les deux
   * tiers. On ne raccourcit jamais — cela effacerait ce qui est écrit plus bas.
   */
  React.useEffect(() => {
    if (!full) return;
    const surface = surfaceRef.current;
    if (!surface) return;
    const { width, height } = surface.getBoundingClientRect();
    if (width === 0) return;
    // La palette occupe le bas : on retire sa hauteur de la place disponible.
    const palette = surface.querySelector('[role="toolbar"]');
    const dispo = height - (palette?.getBoundingClientRect().height ?? 0);
    setFullHeight(Math.round(dispo));
    // Une pile de pages a la hauteur de ses pages : l'allonger n'ajoutait qu'une
    // bande grise sous la dernière — sous une photo en paysage, les trois quarts
    // de l'écran. On ajoute une page, on n'étire pas la pile.
    if (content.pages.length > 0) return;
    const voulu = Math.min(MAX_RATIO, dispo / width);
    if (voulu > content.ratio + 0.01) onChange({ ...content, ratio: Number(voulu.toFixed(3)) });
    // Une seule fois, à l'ouverture : reprendre à chaque changement de contenu
    // rallongerait la page sans fin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

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

  /*
   * Hauteur de la palette en plein écran, publiée pour le repère de page.
   *
   * Elle ne se devine pas : sur téléphone la barre passe sur quatre rangées
   * (196 px), sur iPad sur deux. Un décalage fixe posait le repère sur les
   * couleurs.
   */
  React.useEffect(() => {
    if (!full) return;
    const palette = surfaceRef.current?.querySelector('[role="toolbar"]');
    if (!palette) return;
    const racine = document.documentElement;
    const publier = () =>
      racine.style.setProperty("--ink-palette-h", `${Math.round(palette.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(publier);
    observer.observe(palette);
    publier();
    return () => {
      observer.disconnect();
      racine.style.removeProperty("--ink-palette-h");
    };
  }, [full]);

  const reglages = tool === "highlighter" ? highlighter : pen;

  /*
   * Le reste de la page a besoin de savoir qu'on écrit en plein écran.
   *
   * Le repère de page flotte en bas de l'écran, là où la palette s'installe :
   * sans cela il se poserait dessus.
   */
  React.useEffect(() => {
    onFullChange?.(full);
  }, [full, onFullChange]);

  const palette = (
    <InkPalette
      tool={tool}
      pen={pen}
      highlighter={highlighter}
      shape={shape}
      paper={fond}
      eraseHighlightsOnly={eraseHighlightsOnly}
      erasePrecise={erasePrecise}
      penOnly={penOnly}
      penDetected={penMode}
      selection={selection.length}
      zoom={zoom}
      full={full}
      paperEditable={!surDocument}
      canAddPage={pages.length > 0 && pages.length < MAX_DOCUMENT_PAGES}
      canRemovePage={ajoutee && pages.length > 1}
      canUndo={historique.annuler}
      canRedo={historique.retablir}
      ruler={ruler}
      onTool={setTool}
      onSettings={tool === "highlighter" ? setHighlighter : setPen}
      onShape={setShape}
      onPaper={choisirFond}
      onAddPage={ajouterPage}
      onRemovePage={supprimerPage}
      onEraseHighlightsOnly={setEraseHighlightsOnly}
      onErasePrecise={setErasePrecise}
      onPenOnly={setPenOnly}
      onDeleteSelection={deleteSelection}
      onUndo={undo}
      onRedo={redo}
      onClear={clear}
      onResetView={() => {
        setZoom(1);
        setViewKey((k) => k + 1);
      }}
      onToggleFull={() => setFull((f) => !f)}
      onToggleRuler={() =>
        setRuler((current) => (current ? null : { y: (content.ratio || 0.75) / 2, angle: 0 }))
      }
    />
  );

  const canvas = (
    <InkCanvas
      key={viewKey}
      content={content}
      onChange={onChange}
      tool={tool}
      color={reglages.color}
      size={reglages.size}
      eraseHighlightsOnly={eraseHighlightsOnly}
      erasePrecise={erasePrecise}
      scrollId={scrollId}
      penOnly={penOnly}
      readOnly={readOnly}
      growable={full}
      onPenMode={setPenMode}
      onView={setZoom}
      onPage={setPageIndex}
      onFingerTap={
        readOnly
          ? undefined
          : (doigts) => {
              if (doigts === 2) undo();
              else if (doigts === 3) redo();
            }
      }
      shape={shape}
      selection={selection}
      onSelect={setSelection}
      ruler={ruler}
      onRuler={setRuler}
      // En ligne, la page se montre dans une fenêtre de hauteur raisonnable et
      // défile en elle-même — mais jamais plus haute que ce qu'elle porte : une
      // photo en paysage de 200 px flottait dans 520 px de gris. En plein
      // écran, elle occupe la place restante.
      height={full ? fullHeight : undefined}
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

        {/* z-50, pas z-40 : la barre de navigation du téléphone est aussi en
            z-40 et vient après la note dans le document — à égalité elle
            passait devant, et cachait la moitié de la palette. */}
        <div ref={surfaceRef} className="ink-surface fixed inset-0 z-50 flex flex-col bg-surface">
          {/* Pleine largeur, sans marge : la feuille doit occuper l'écran, pas
              flotter au milieu. Le défilement sert à descendre dans la page,
              qui s'allonge à mesure qu'on écrit. */}
          <div className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {canvas}
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
