"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { ImageCropper } from "@/components/image-cropper";
import { InkCanvas, type InkTool } from "@/components/note/ink-canvas";
import { InkPalette, type InkSettings } from "@/components/note/ink-palette";
import { COTE_MAX, lireFormatImage } from "@/components/note/photo-note";
import { uploadPageImage } from "@/app/(app)/notes/actions";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-path";
import {
  DOCUMENT_ACCEPT,
  EnvoiInterrompu,
  envoyerDocument,
  estDocument,
  type EnvoiDocument,
} from "@/lib/document-upload";
import type { Ruler, Shape } from "@/lib/ink";
import {
  MAX_DOCUMENT_PAGES,
  MAX_RATIO,
  insertDocumentPages,
  insertImagePage,
  insertPage,
  pageBands,
  pageKind,
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
  noteId,
  readOnly = false,
  scrollId,
  onFullChange,
}: {
  content: DrawingContent;
  onChange: (next: DrawingContent) => void;
  /** La note qui porte la page : l'import d'un document passe par sa route. */
  noteId?: string;
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
  const genre = courante ? pageKind(courante) : null;
  /*
   * Une page du document ou une photo : son image **est** son fond.
   *
   * La photo était rangée avec les pages ajoutées, et la palette y proposait
   * donc des lignes et des carreaux — sans rien à dessiner, la page n'ayant pas
   * de fond de cahier. Glisser des photos au milieu d'une pile rendait le défaut
   * courant.
   */
  const fondImpose = genre === "document" || genre === "image";
  // Une feuille ajoutée ou une photo se retire ; une page du document, non.
  const retirable = genre === "blank" || genre === "image";
  const fond = genre === "blank" ? (courante as BlankPage).paper : content.paper;

  function choisirFond(paper: Paper) {
    if (genre !== "blank") {
      onChange({ ...content, paper });
      return;
    }
    onChange({
      ...content,
      pages: pages.map((p, i) => (i === pageIndex && pageKind(p) === "blank" ? { ...p, paper } : p)),
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

  /*
   * Une photo ou une image, glissée comme une page après la page courante.
   *
   * Depuis la barre d'outils, et donc aussi sur une page déjà faite d'une photo
   * ou d'un document : on annote un polycopié, on photographie le tableau pour
   * le mettre juste après. Le bouton « Photo » du bas de la note, lui, crée une
   * nouvelle page manuscrite à part.
   *
   * Le serveur ne fait qu'enregistrer le fichier ; l'insertion se fait ici et
   * part par l'enregistrement ordinaire (cf. `uploadPageImage`). Elle entre ainsi
   * dans l'historique : Annuler la retire, et le fichier est nettoyé.
   */
  const imageRef = React.useRef<HTMLInputElement>(null);
  const [aRecadrer, setARecadrer] = React.useState<File | null>(null);
  const [envoiImage, setEnvoiImage] = React.useState(false);
  const [erreurImage, setErreurImage] = React.useState<string | null>(null);

  async function ajouterImage(file: File) {
    if (!scrollId) return;
    // Vérifié avant l'envoi : un fichier enregistré pour une page refusée
    // resterait sur le disque sans que rien ne le désigne.
    if (actuel.current.pages.length >= MAX_DOCUMENT_PAGES) {
      setErreurImage("Cette page manuscrite a déjà le nombre maximal de pages.");
      return;
    }
    setEnvoiImage(true);
    setErreurImage(null);
    try {
      const ratio = await lireFormatImage(file);
      const data = new FormData();
      data.set("photo", file);
      const result = await uploadPageImage(scrollId, data);
      if (!result.ok) {
        setErreurImage(result.error);
        return;
      }
      const courant = actuel.current;
      const rang = courant.pages.length > 0 ? Math.min(pageIndex, courant.pages.length - 1) : 0;
      const suivant = insertImagePage(courant, rang, result.image, ratio);
      if (suivant === courant) return;
      onChange(suivant);
      const bandes = pageBands(suivant.pages);
      const cible = Math.min(rang + 1, bandes.length - 1);
      setPageIndex(cible);
      // Sans le défilement, la page arrive hors de l'écran : rien ne bouge, et
      // l'on recommence en croyant que ça n'a pas marché.
      requestAnimationFrame(() => {
        const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${scrollId}"]`);
        if (surface) surface.scrollTop = bandes[cible].top * surface.clientWidth;
      });
    } catch {
      // Une action peut être rejetée, pas seulement répondre non : sans ce
      // filet, le bouton tournerait pour toujours.
      setErreurImage("L'image n'a pas pu être envoyée. Vérifie ta connexion.");
    } finally {
      setEnvoiImage(false);
    }
  }

  /*
   * Un document — PDF ou Word —, glissé comme des pages après la page courante.
   *
   * Le bouton « Document » du bas de la note en faisait une page manuscrite à
   * part, au bout de la note, et il n'existait pas en plein écran : ajouter le
   * polycopié du jour à une note déjà commencée était impossible. Le serveur
   * convertit et enregistre le fichier ; l'insertion se fait ici, comme pour une
   * photo, et entre dans l'historique.
   */
  const interrompreDocument = React.useRef<(() => void) | null>(null);
  const [envoiDocument, setEnvoiDocument] = React.useState<EnvoiDocument | null>(null);
  React.useEffect(() => () => interrompreDocument.current?.(), []);

  async function ajouterDocument(file: File) {
    if (!scrollId || !noteId) return;
    if (actuel.current.pages.length >= MAX_DOCUMENT_PAGES) {
      setErreurImage("Cette page manuscrite a déjà le nombre maximal de pages.");
      return;
    }
    setErreurImage(null);
    setEnvoiImage(true);
    const requete = envoyerDocument<{ file?: string; ratios?: number[] }>(
      `/api/notes/${noteId}/document?bloc=${encodeURIComponent(scrollId)}`,
      file,
      setEnvoiDocument,
    );
    interrompreDocument.current = requete.interrompre;
    try {
      const charge = await requete.promesse;
      if (!charge.file || !charge.ratios?.length) {
        setErreurImage("L'import a échoué.");
        return;
      }
      const courant = actuel.current;
      const rang = courant.pages.length > 0 ? Math.min(pageIndex, courant.pages.length - 1) : 0;
      const suivant = insertDocumentPages(courant, rang, charge.file, charge.ratios);
      if (suivant === courant) {
        setErreurImage("Ce document ferait dépasser le nombre maximal de pages.");
        return;
      }
      onChange(suivant);
      const bandes = pageBands(suivant.pages);
      const cible = Math.min(rang + 1, bandes.length - 1);
      setPageIndex(cible);
      // Sans le défilement, les pages arrivent hors de l'écran : rien ne bouge,
      // et l'on recommence en croyant que ça n'a pas marché.
      requestAnimationFrame(() => {
        const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${scrollId}"]`);
        if (surface) surface.scrollTop = bandes[cible].top * surface.clientWidth;
      });
    } catch (erreur) {
      if (!(erreur instanceof EnvoiInterrompu)) {
        setErreurImage(erreur instanceof Error ? erreur.message : "L'import a échoué.");
      }
    } finally {
      interrompreDocument.current = null;
      setEnvoiDocument(null);
      setEnvoiImage(false);
    }
  }

  const surfaceRef = React.useRef<HTMLDivElement>(null);
  // Zone de la feuille en plein écran : ce que la palette laisse.
  const zoneRef = React.useRef<HTMLDivElement>(null);
  // Hauteur disponible pour la feuille en plein écran, palette déduite.
  const [fullHeight, setFullHeight] = React.useState(0);

  /*
   * Hauteur de la feuille en plein écran, **tenue à jour**.
   *
   * Elle était mesurée une fois, à l'ouverture. Tourner l'iPad laissait alors la
   * feuille à la hauteur de l'autre orientation : ouverte en paysage puis
   * tournée en portrait, elle s'arrêtait aux deux tiers de l'écran, le bas du
   * document coupé au-dessus d'un vide. On mesure la zone elle-même — ce que la
   * palette et une alerte éventuelle laissent — à chaque changement de taille.
   */
  React.useEffect(() => {
    if (!full) return;
    const zone = zoneRef.current;
    if (!zone) return;
    const mesurer = () => setFullHeight(zone.clientHeight);
    const observer = new ResizeObserver(mesurer);
    observer.observe(zone);
    mesurer();
    return () => observer.disconnect();
  }, [full]);

  /*
   * À l'ouverture, la page est allongée pour remplir l'écran.
   *
   * Sans cela, une page au format par défaut laisse une bande vide sous elle :
   * on ouvre le plein écran et la surface d'écriture n'occupe que les deux
   * tiers. On ne raccourcit jamais — cela effacerait ce qui est écrit plus bas.
   */
  React.useEffect(() => {
    if (!full) return;
    const zone = zoneRef.current;
    const width = surfaceRef.current?.getBoundingClientRect().width ?? 0;
    if (!zone || width === 0) return;
    // Une pile de pages a la hauteur de ses pages : l'allonger n'ajoutait qu'une
    // bande grise sous la dernière — sous une photo en paysage, les trois quarts
    // de l'écran. On ajoute une page, on n'étire pas la pile.
    if (content.pages.length > 0) return;
    const voulu = Math.min(MAX_RATIO, zone.clientHeight / width);
    if (voulu > content.ratio + 0.01) onChange({ ...content, ratio: Number(voulu.toFixed(3)) });
    // Une seule fois, à l'ouverture : reprendre à chaque changement de contenu
    // rallongerait la page sans fin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full]);

  /*
   * Hauteur de la palette posée au-dessus de la page, en ligne.
   *
   * La fenêtre de la page lui laisse sa place : amenée en haut de l'écran, la
   * palette et la page y tiennent ensemble. Sur téléphone la barre passe sur
   * quatre rangées, sur iPad sur deux — elle ne se devine pas.
   */
  const paletteRef = React.useRef<HTMLDivElement>(null);
  const [reserve, setReserve] = React.useState(0);
  React.useEffect(() => {
    if (full) return;
    const el = paletteRef.current;
    if (!el) return;
    const mesurer = () => setReserve(Math.round(el.getBoundingClientRect().height));
    const observer = new ResizeObserver(mesurer);
    observer.observe(el);
    mesurer();
    return () => observer.disconnect();
  }, [full, readOnly]);

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
      paperEditable={!fondImpose}
      canAddPage={pages.length > 0 && pages.length < MAX_DOCUMENT_PAGES}
      canRemovePage={retirable && pages.length > 1}
      canUndo={historique.annuler}
      canRedo={historique.retablir}
      onAddImage={readOnly || !scrollId ? undefined : () => imageRef.current?.click()}
      addingImage={envoiImage}
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
      height={full && fullHeight > 0 ? fullHeight : undefined}
      // La palette, et l'intervalle qui la sépare de la page.
      reserve={full || readOnly ? 0 : reserve + 8}
      className={full ? "rounded-none border-0" : "rounded-xl border border-outline-variant"}
    />
  );

  const alerteImage = erreurImage ? (
    <p role="alert" className="px-2 m3-body-small text-error">
      {erreurImage}
    </p>
  ) : null;

  // Trente mégaoctets depuis un iPad prennent une minute, et la conversion d'un
  // document Word plusieurs secondes : on dit où l'on en est, et on laisse
  // interrompre.
  const suiviDocument = envoiDocument ? (
    <div role="status" className="flex flex-wrap items-center gap-2 px-2 m3-body-small text-on-surface-variant">
      <Loader2 aria-hidden className="size-4 animate-spin" />
      {envoiDocument.phase === "envoi"
        ? `Envoi du document : ${envoiDocument.progres} %`
        : "Conversion du document…"}
      <button
        type="button"
        onClick={() => interrompreDocument.current?.()}
        className="state-layer min-h-11 rounded-full px-3 m3-label-large text-primary"
      >
        Interrompre
      </button>
    </div>
  ) : null;

  // Le sélecteur vit dans le plein écran quand il est ouvert : le recadreur est
  // en position fixe, et placé dehors il passerait sous la feuille.
  const selecteurImage = readOnly ? null : (
    <>
      <input
        ref={imageRef}
        type="file"
        // `image/*` : c'est ce qui fait proposer « Prendre une photo » par iOS.
        // Les documents s'y ajoutent : un PDF ou un Word devient des pages, lui
        // aussi. Le bouton n'acceptait que des images, et les documents étaient
        // grisés dans le sélecteur.
        accept={`image/*,${DOCUMENT_ACCEPT}`}
        data-page-image=""
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (estDocument(file)) {
            void ajouterDocument(file);
            return;
          }
          if (file.size > MAX_UPLOAD_BYTES * 6) {
            setErreurImage("Image beaucoup trop lourde.");
            return;
          }
          setARecadrer(file);
        }}
      />
      {aRecadrer ? (
        <ImageCropper
          key={`${aRecadrer.name}-${aRecadrer.size}-${aRecadrer.lastModified}`}
          file={aRecadrer}
          maxSide={COTE_MAX}
          type="image/jpeg"
          onCancel={() => setARecadrer(null)}
          onConfirm={(recadree) => {
            setARecadrer(null);
            void ajouterImage(recadree);
          }}
        />
      ) : null}
    </>
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
          <div ref={zoneRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {canvas}
          </div>
          {alerteImage}
      {suiviDocument}
          {palette}
          {selecteurImage}
        </div>
      </>
    );
  }

  return (
    <div className="space-y-2">
      {readOnly ? null : <div ref={paletteRef}>{palette}</div>}
      {alerteImage}
      {suiviDocument}
      {canvas}
      {selecteurImage}
    </div>
  );
}
