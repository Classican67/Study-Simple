"use client";

import * as React from "react";
import { flushSync } from "react-dom";
import { BookPlus, ClipboardCopy, Crop, Files, Loader2, PenLine, Scissors, Trash2 } from "lucide-react";

import { ImageCropper } from "@/components/image-cropper";
import { InkCanvas, type InkTool } from "@/components/note/ink-canvas";
import { InkPalette, type InkSettings } from "@/components/note/ink-palette";
import { CarteDepuisNote } from "@/components/note/carte-depuis-note";
import { LoupeNote, type RechercheInitiale } from "@/components/note/loupe-note";
import { COTE_MAX, lireFormatImage } from "@/components/note/photo-note";
import { deposerFragment } from "@/components/note/rendu-fragment";
import { EditeurZone } from "@/components/note/zones-texte";
import { uploadPageImage } from "@/app/(app)/notes/actions";
import { blocsDuPressePapiers, tableEnLignes } from "@/lib/collage";
import { preparerImage } from "@/lib/image-client";
import { MAX_UPLOAD_BYTES } from "@/lib/upload-path";
import {
  DOCUMENT_ACCEPT,
  EnvoiInterrompu,
  envoyerDocument,
  estDocument,
  type EnvoiDocument,
} from "@/lib/document-upload";
import {
  collerFragment,
  extraireFragment,
  retirerSelection,
  type FragmentEncre,
} from "@/lib/fragment-encre";
import type { Surligne } from "@/lib/recherche-document";
import { boundsOf, INSTRUMENTS, instrumentOf, TOOLS, type Bounds, type Point, type Ruler, type Shape, type Tool } from "@/lib/ink";
import {
  abonnerFragment,
  fragmentDuCollage,
  garderFragment,
  lireFragment,
  versionFragment,
} from "@/lib/presse-papiers-encre";
import { usePositionBarre } from "@/components/note/ink-dock";
import { useStyletSeul } from "@/components/note/stylet-seul";
import {
  MAX_DOCUMENT_PAGES,
  MAX_IMAGES_POSEES,
  MAX_RATIO,
  MAX_ZONES_TEXTE,
  TAILLE_TEXTE_DEFAUT,
  insertDocumentPages,
  insertImagePage,
  insertPage,
  nouvelIdImage,
  pageBands,
  pageKind,
  removePage,
  type BlankPage,
  type DrawingContent,
  type ImagePosee,
  type Paper,
  type ZoneTexte,
} from "@/lib/notes";
import { cn } from "@/lib/utils";

/** Versions retenues pour Annuler : bien plus qu'on n'en remonte jamais. */
const HISTORIQUE_MAX = 200;

/*
 * Une note peut porter plusieurs pages manuscrites, et le clavier n'en vise
 * aucune : ⌘V doit coller dans celle qu'on vient de toucher. Hors de React, parce
 * que ce n'est un état d'aucune d'elles — et qu'un rendu par toucher serait pour
 * rien.
 */
const surfaces: symbol[] = [];
let surfaceTouchee: symbol | null = null;

function estLaSurfaceVisee(moi: symbol): boolean {
  return (surfaceTouchee ?? surfaces[0]) === moi;
}

/** Le clavier appartient-il à un champ de saisie ? */
function dansUnChamp(cible: EventTarget | null): boolean {
  const element = cible as HTMLElement | null;
  return Boolean(element?.closest?.("input, textarea, select, [contenteditable='true']"));
}

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
  feuille,
  rechercheInitiale,
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
  /**
   * La page **est** la note : elle s'ouvre en plein écran et n'en sort pas. Son
   * en-tête — retour, titre, actions de la note — prend place au-dessus d'elle.
   */
  feuille?: { gauche: React.ReactNode; droite: React.ReactNode; sous: React.ReactNode };
  /** Arrivée depuis la recherche : la loupe s'ouvre sur le mot, à la bonne page. */
  rechercheInitiale?: RechercheInitiale;
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
      if (
        next.strokes !== avant.strokes ||
        next.pages !== avant.pages ||
        next.paper !== avant.paper ||
        next.images !== avant.images ||
        next.textes !== avant.textes
      ) {
        passe.current = [...passe.current, avant].slice(-HISTORIQUE_MAX);
        futur.current = [];
        direHistorique();
      }
      appliquer(next);
    },
    [appliquer, direHistorique],
  );

  const [tool, setOutil] = React.useState<InkTool>("pen");
  /*
   * Le stylo et le surligneur retiennent chacun leur couleur et leur épaisseur.
   *
   * Un réglage commun oblige à tout refaire à chaque changement d'outil : on
   * surligne en jaune épais, on reprend le stylo, et il écrit en jaune épais.
   * C'est ce que font les applications de référence, et c'est ce qui rend
   * l'aller-retour entre les deux supportable.
   *
   * Deux états séparés suffisaient pour deux instruments ; à cinq, il faut un
   * tableau.
   *
   * Deux états séparés suffisaient pour deux instruments ; à cinq, il faut un
   * tableau — et surtout il faut que changer d'outil n'emporte pas les
   * réglages de celui qu'on quitte. On garde un crayon vert fin à côté d'un
   * feutre rouge épais, et l'on retrouve chacun comme on l'a laissé.
   *
   * Les couleurs de départ ne sont pas les mêmes : un surligneur jaune et une
   * plume noire, c'est ce qu'on attend en ouvrant la trousse.
   */
  /*
   * Les couleurs de départ, quand « encre » ne convient pas.
   *
   * Un surligneur noir, un crayon de cire noir et une aquarelle noire, ce sont
   * trois outils qu'on n'essaie jamais : ils ne montrent pas ce qu'ils savent
   * faire. Les autres partent en encre, qui est la couleur du texte.
   */
  const [settings, setSettings] = React.useState<Record<Tool, InkSettings>>(() => {
    const depart: Partial<Record<Tool, string>> = {
      marker: "blue",
      highlighter: "amber",
      crayon: "rose",
      watercolor: "blue",
    };
    // Construit depuis `TOOLS` : ajouter un instrument ne demande pas de
    // penser à venir lui ouvrir une ligne ici, et le typage ne pardonnerait
    // pas qu'on l'oublie.
    return Object.fromEntries(
      TOOLS.map((t) => [t, { color: depart[t] ?? "default", size: INSTRUMENTS[t].tailles[1] }]),
    ) as Record<Tool, InkSettings>;
  });

  /*
   * La place de la barre vit hors de React : cf. `usePositionBarre`.
   *
   * Deux pages manuscrites dans la même note partagent donc la même barre —
   * ce qui est le cas de deux barres qui sont la même barre.
   */
  const [position, placerBarre] = usePositionBarre();

  // La gomme peut ne retirer que les surlignages : on surligne beaucoup, on se
  // trompe souvent, et effacer l'écriture par la même occasion est rageant.
  const [eraseHighlightsOnly, setEraseHighlightsOnly] = React.useState(false);
  const [erasePrecise, setErasePrecise] = React.useState(false);
  // Verrou : le doigt n'écrit pas, même avant qu'un stylet ait servi. Posé
  // d'office, et gardé par l'appareil : cf. `useStyletSeul`.
  const [penOnly, setPenOnly] = useStyletSeul();

  const [full, setFull] = React.useState(Boolean(feuille));
  const ouverteEnFeuille = Boolean(feuille);
  // Le rejet de la paume est invisible : le doigt cesse d'écrire sans rien dire.
  // On l'annonce, sinon on croit à une panne.
  const [penMode, setPenMode] = React.useState(false);
  const [zoom, setZoom] = React.useState(1);
  const [shape, setShape] = React.useState<Shape>("rect");
  // La sélection du lasso appartient au bloc : c'est lui qui propose de la
  // supprimer, et supprimer revient à réécrire la liste des traits.
  const terminerTexte = React.useRef<(() => void) | null>(null);
  const [selection, setSelection] = React.useState<number[]>([]);
  const [imagesChoisies, setImagesChoisies] = React.useState<string[]>([]);
  const choisir = React.useCallback((rangs: number[], ids: string[] = []) => {
    setSelection(rangs);
    setImagesChoisies(ids);
  }, []);
  // Une sélection n'a de sens qu'avec le lasso : ses poignées disparaissent avec
  // lui, et revenir au lasso ne doit pas ressortir un cadre oublié.
  const setTool = React.useCallback(
    (outil: InkTool) => {
      if (outil !== "lasso") choisir([], []);
      terminerTexte.current?.();
      setOutil(outil);
    },
    [choisir],
  );
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
    choisir([], []);
    // Une copie, et non l'objet retenu : versée et annulée dans le même instant,
    // l'encre ramènerait le contenu au même objet, et le canevas, qui ne voit alors
    // aucun changement, garderait le trait qu'on vient d'annuler.
    appliquer({ ...precedent });
  }

  function redo() {
    const suivant = futur.current.at(-1);
    if (!suivant) return;
    futur.current = futur.current.slice(0, -1);
    passe.current = [...passe.current, actuel.current];
    direHistorique();
    choisir([], []);
    appliquer({ ...suivant });
  }

  function deleteSelection() {
    if (selection.length === 0 && imagesChoisies.length === 0) return;
    const courant = actuel.current;
    const suivant = retirerSelection(courant, selection, imagesChoisies);
    choisir([], []);
    onChange(suivant);
  }

  /**
   * Ce qu'on a sous les yeux : c'est là qu'arrive ce qu'on pose.
   *
   * La partie de la surface qui est **à l'écran**, pas la surface. Elle dépasse
   * souvent en bas — la note commence sous la barre et le titre — et une image
   * posée au milieu de la surface arrivait à cheval sur le bord de l'écran, sa
   * poignée hors de portée.
   */
  function zoneVisible(): { centre: Point; hauteur: number } {
    const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${scrollId}"]`);
    if (!surface || surface.scrollWidth === 0) return { centre: { x: 0.5, y: 0.35 }, hauteur: 0.5 };
    const rect = surface.getBoundingClientRect();
    const haut = Math.max(rect.top, 0);
    const bas = Math.min(rect.bottom, window.innerHeight);
    const unite = surface.scrollWidth;
    return {
      centre: {
        x: (surface.scrollLeft + surface.clientWidth / 2) / unite,
        y: (surface.scrollTop + (haut + bas) / 2 - rect.top) / unite,
      },
      hauteur: Math.max(0, bas - haut) / unite,
    };
  }

  const centreVisible = () => zoneVisible().centre;

  function copierSelection(): FragmentEncre | null {
    const fragment = extraireFragment(actuel.current, selection, imagesChoisies);
    if (!fragment) return null;
    void deposerFragment(garderFragment(fragment));
    return fragment;
  }

  function couperSelection() {
    if (copierSelection()) deleteSelection();
  }

  /** Repose un fragment, et le laisse retenu : on veut presque toujours le placer. */
  function coller(fragment: FragmentEncre, centre: Point = centreVisible()) {
    const pose = collerFragment(actuel.current, fragment, centre);
    onChange(pose.content);
    setOutil("lasso");
    choisir(pose.rangs, pose.ids);
  }

  function dupliquerSelection() {
    const fragment = extraireFragment(actuel.current, selection, imagesChoisies);
    if (!fragment) return;
    const { cadre } = fragment;
    // Décalé juste assez pour qu'on voie qu'il y en a deux.
    coller(fragment, {
      x: (cadre.minX + cadre.maxX) / 2 + 0.03,
      y: (cadre.minY + cadre.maxY) / 2 + 0.03,
    });
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
    // Une surface simple n'a pas encore de pile : `insertPage` la convertit.
    // Refuser ici privait de feuille la page de toute note neuve.
    if (pages.length >= MAX_DOCUMENT_PAGES) return;
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
   * Une image posée **sur** la page, et non devenue une page.
   *
   * Elle arrive au milieu de ce qu'on regarde, déjà retenue par le cadre : le
   * geste suivant est toujours de la placer. Le serveur n'enregistre que le
   * fichier, pour la même raison que `ajouterImage`.
   */
  const poseRef = React.useRef<HTMLInputElement>(null);
  const [aRecadrerPose, setARecadrerPose] = React.useState<{
    file: File;
    /** L'image déjà posée dont on remplace le fichier, s'il y en a une. */
    remplace: string | null;
  } | null>(null);

  async function poserImage(fichier: File, centre?: Point) {
    if (!scrollId) return;
    if (actuel.current.images.length >= MAX_IMAGES_POSEES) {
      setErreurImage("Cette page porte déjà le nombre maximal d'images.");
      return;
    }
    setEnvoiImage(true);
    setErreurImage(null);
    try {
      const { file, ratio } = await preparerImage(fichier);
      const data = new FormData();
      data.set("photo", file);
      const result = await uploadPageImage(scrollId, data);
      if (!result.ok) {
        setErreurImage(result.error);
        return;
      }
      const zone = zoneVisible();
      const lieu = centre ?? zone.centre;
      // Toute l'image à l'écran, poignées comprises : la moitié de la largeur,
      // moins si elle est trop haute pour ce qu'on voit de la page.
      const w = Math.max(0.1, Math.min(0.5, (zone.hauteur * 0.6) / Math.max(ratio, 0.01)));
      const image: ImagePosee = {
        id: nouvelIdImage(),
        file: result.image,
        x: Math.max(0, Math.min(1 - w, lieu.x - w / 2)),
        y: Math.max(0, lieu.y - (w * ratio) / 2),
        w,
        ratio,
        angle: 0,
      };
      const courant = actuel.current;
      const bas = image.y + w * ratio;
      onChange({
        ...courant,
        images: [...courant.images, image],
        // Une surface simple s'allonge pour la recevoir ; une pile, non.
        ratio:
          courant.pages.length === 0 && bas > courant.ratio - 0.05
            ? Math.min(MAX_RATIO, bas + 0.1)
            : courant.ratio,
      });
      setOutil("lasso");
      choisir([], [image.id]);
    } catch {
      setErreurImage("L'image n'a pas pu être ajoutée. Vérifie ta connexion.");
    } finally {
      setEnvoiImage(false);
    }
  }

  /** Remplace le fichier d'une image posée par sa version recadrée, à la même place. */
  async function remplacerImage(id: string, recadree: File) {
    if (!scrollId) return;
    setEnvoiImage(true);
    setErreurImage(null);
    try {
      const { file, ratio } = await preparerImage(recadree);
      const data = new FormData();
      data.set("photo", file);
      const result = await uploadPageImage(scrollId, data);
      if (!result.ok) {
        setErreurImage(result.error);
        return;
      }
      const courant = actuel.current;
      onChange({
        ...courant,
        images: courant.images.map((im) =>
          im.id === id
            ? {
                ...im,
                file: result.image,
                ratio,
                // Le centre ne bouge pas : l'image recadrée reste où on l'a mise.
                y: im.y + (im.w * im.ratio - im.w * ratio) / 2,
              }
            : im,
        ),
      });
    } catch {
      setErreurImage("L'image recadrée n'a pas pu être enregistrée.");
    } finally {
      setEnvoiImage(false);
    }
  }

  async function ouvrirRecadrage() {
    const image = actuel.current.images.find((im) => im.id === imagesChoisies[0]);
    if (!image) return;
    try {
      const reponse = await fetch(`/api/uploads/${image.file}`);
      if (!reponse.ok) throw new Error("image absente");
      const blob = await reponse.blob();
      setARecadrerPose({
        file: new File([blob], image.file, { type: blob.type }),
        remplace: image.id,
      });
    } catch {
      setErreurImage("Cette image n'a pas pu être relue.");
    }
  }

  /*
   * La loupe : seulement là où il y a quelque chose à lire.
   *
   * Une page qui ne porte que de l'encre n'a rien à proposer : l'écriture à la
   * main ne se lit pas, et un bouton qui ne trouve jamais rien est pire qu'absent.
   */
  const recherchable =
    Boolean(noteId && scrollId) &&
    (content.images.length > 0 || content.pages.some((p) => pageKind(p) !== "blank"));
  const initialeApplicable = rechercheInitiale
    ? content.pages.some((p) => "file" in p && p.file === rechercheInitiale.file) ||
      content.pages.some((p) => "image" in p && p.image === rechercheInitiale.file) ||
      content.images.some((im) => im.file === rechercheInitiale.file)
    : false;
  const [loupe, setLoupe] = React.useState(initialeApplicable);

  /*
   * La révision par caches.
   *
   * Ce qu'on surligne, c'est ce qu'il faut retenir. Le cacher fait de n'importe
   * quel polycopié annoté une page d'auto-interrogation, sans rien préparer. Rien
   * n'est enregistré : c'est une façon de regarder la page.
   */
  const rangsSurlignes = React.useMemo(
    () =>
      content.strokes
        .map((stroke, rang) => ({ rang, stroke }))
        .filter(({ stroke }) => instrumentOf(stroke.tool).dessous)
        .map(({ rang, stroke }) => ({ rang, cadre: boundsOf(stroke.points) }))
        .sort((a, b) => (a.cadre?.minY ?? 0) - (b.cadre?.minY ?? 0)),
    [content.strokes],
  );
  const [reveles, setReveles] = React.useState<Set<number> | null>(null);
  const basculerMasque = React.useCallback((rang: number) => {
    setReveles((avant) => {
      if (!avant) return avant;
      const suivant = new Set(avant);
      if (!suivant.delete(rang)) suivant.add(rang);
      return suivant;
    });
  }, []);
  const masquesCanvas = React.useMemo(
    () => (reveles ? { reveles, onToucher: basculerMasque } : null),
    [reveles, basculerMasque],
  );
  function revelerSuivant() {
    const prochain = rangsSurlignes.find(({ rang }) => !reveles?.has(rang));
    if (!prochain) return;
    basculerMasque(prochain.rang);
    const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${scrollId}"]`);
    if (surface && prochain.cadre) {
      surface.scrollTop = prochain.cadre.minY * surface.scrollWidth - surface.clientHeight / 3;
    }
  }
  const [surlignes, setSurlignes] = React.useState<{ tous: Surligne[]; actif: Surligne[] }>({
    tous: [],
    actif: [],
  });

  /*
   * Faire une carte de ce qu'on a entouré.
   *
   * La zone est prise telle qu'on la voit — le polycopié, la photo, l'écriture —,
   * pas seulement les traits retenus : c'est le schéma annoté qu'on veut retrouver
   * en révision.
   */
  const [zoneCarte, setZoneCarte] = React.useState<{ cadre: Bounds } | null>(null);
  function ouvrirCarte() {
    const fragment = extraireFragment(actuel.current, selection, imagesChoisies);
    if (fragment) setZoneCarte({ cadre: fragment.cadre });
  }

  /*
   * Les zones de texte.
   *
   * La zone n'entre dans le contenu qu'une fois écrite : toucher la page par mégarde
   * ne doit laisser ni zone vide ni entrée d'historique.
   */
  const [zoneEditee, setZoneEditee] = React.useState<{ zone: ZoneTexte; neuve: boolean } | null>(null);
  const [tailleTexte, setTailleTexte] = React.useState(TAILLE_TEXTE_DEFAUT);

  function ouvrirZone(point: Point, zone: ZoneTexte | null) {
    if (!zone && actuel.current.textes.length >= MAX_ZONES_TEXTE) {
      setErreurImage("Cette page porte déjà le nombre maximal de zones de texte.");
      return;
    }
    const nouvelle: ZoneTexte = {
      id: nouvelIdImage(),
      x: Math.max(0, Math.min(0.92, point.x)),
      y: Math.max(0, point.y - tailleTexte * 0.7),
      w: Math.max(0.2, Math.min(0.55, 1 - point.x - 0.02)),
      h: tailleTexte * 1.35,
      taille: tailleTexte,
      markup: "",
      angle: 0,
    };
    // Synchrone : iPadOS n'ouvre le clavier que pour un focus donné pendant le geste.
    flushSync(() => setZoneEditee({ zone: zone ?? nouvelle, neuve: !zone }));
  }

  function finirZone(markup: string, h: number) {
    const edition = zoneEditee;
    setZoneEditee(null);
    if (!edition) return;
    const { zone, neuve } = edition;
    const courant = actuel.current;
    if (!markup) {
      if (!neuve) onChange({ ...courant, textes: courant.textes.filter((z) => z.id !== zone.id) });
      return;
    }
    if (!neuve && zone.markup === markup && courant.textes.some((z) => z.id === zone.id && z.w === zone.w)) return;
    const posee = { ...zone, markup, h: h > 0 ? Math.round(h * 10000) / 10000 : zone.h };
    onChange({
      ...courant,
      textes: neuve
        ? [...courant.textes, posee]
        : courant.textes.map((z) => (z.id === zone.id ? posee : z)),
    });
  }

  const zoneChoisie = content.textes.find((z) => z.id === imagesChoisies[0]);
  const modifierZoneChoisie = zoneChoisie
    ? () => {
        choisir([], []);
        setOutil("texte");
        ouvrirZone({ x: zoneChoisie.x, y: zoneChoisie.y }, zoneChoisie);
      }
    : undefined;

  /** Corrige une hauteur lue à l'écran : ce n'est pas une action, elle n'a pas d'historique. */
  const mesurerZone = React.useCallback(
    (id: string, h: number) => {
      const courant = actuel.current;
      if (!courant.textes.some((z) => z.id === id)) return;
      appliquer({ ...courant, textes: courant.textes.map((z) => (z.id === id ? { ...z, h } : z)) });
    },
    [appliquer],
  );

  /**
   * Du texte collé sur la feuille : une zone, au milieu de ce qu'on regarde, retenue
   * pour qu'on la place tout de suite. Un tableau y devient des lignes.
   */
  function collerTexte(markups: string[]) {
    const markup = markups.join("\n\n");
    if (!markup.trim() || actuel.current.textes.length >= MAX_ZONES_TEXTE) return;
    const { centre } = zoneVisible();
    const w = 0.8;
    const zone: ZoneTexte = {
      id: nouvelIdImage(),
      x: Math.max(0.02, Math.min(1 - w - 0.02, centre.x - w / 2)),
      y: Math.max(0.02, centre.y - 0.1),
      w,
      h: 0.2,
      taille: tailleTexte,
      markup,
      angle: 0,
    };
    const courant = actuel.current;
    onChange({ ...courant, textes: [...courant.textes, zone] });
    setOutil("lasso");
    choisir([], [zone.id]);
  }

  /** Ce qui attend dans le presse-papiers de l'app, pour allumer « Coller ». */
  React.useSyncExternalStore(abonnerFragment, versionFragment, () => 0);
  const fragmentGarde = readOnly ? null : lireFragmentSurClient();

  /*
   * Le clavier et le collage visent la dernière surface touchée.
   *
   * Les gestionnaires sont repassés par une référence : ils lisent la sélection
   * courante, et réinstaller les écouteurs à chaque trait ne servirait à rien.
   */
  const moi = React.useRef(Symbol("surface"));
  const encre = React.useRef<{ verser: () => void } | null>(null);
  const actions = React.useRef({
    copierSelection,
    couperSelection,
    dupliquerSelection,
    deleteSelection,
    undo,
    redo,
    coller,
    poserImage,
    choisir,
    collerTexte,
    ouvrirLoupe: () => {},
    aSelection: selection.length > 0 || imagesChoisies.length > 0,
  });
  React.useEffect(() => {
    actions.current = {
      copierSelection,
      couperSelection,
      dupliquerSelection,
      deleteSelection,
      undo,
      redo,
      coller,
      poserImage,
      choisir,
      collerTexte,
      ouvrirLoupe: () => {
        if (recherchable) setLoupe(true);
      },
      aSelection: selection.length > 0 || imagesChoisies.length > 0,
    };
  });

  React.useEffect(() => {
    if (readOnly) return;
    const moiMeme = moi.current;
    surfaces.push(moiMeme);

    const clavier = (event: KeyboardEvent) => {
      if (dansUnChamp(event.target) || !estLaSurfaceVisee(moiMeme)) return;
      encre.current?.verser();
      const a = actions.current;
      const commande = event.metaKey || event.ctrlKey;
      const touche = event.key.toLowerCase();

      if (commande && touche === "z") {
        event.preventDefault();
        if (event.shiftKey) a.redo();
        else a.undo();
        return;
      }
      if (commande && touche === "y") {
        event.preventDefault();
        a.redo();
        return;
      }
      if (commande && touche === "f") {
        event.preventDefault();
        a.ouvrirLoupe();
        return;
      }
      if (!a.aSelection) return;
      // Copier ne prend la main que si l'on n'a pas sélectionné de texte ailleurs.
      if (commande && touche === "c" && !window.getSelection()?.toString()) {
        event.preventDefault();
        a.copierSelection();
      } else if (commande && touche === "x") {
        event.preventDefault();
        a.couperSelection();
      } else if (commande && touche === "d") {
        event.preventDefault();
        a.dupliquerSelection();
      } else if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        a.deleteSelection();
      } else if (event.key === "Escape") {
        // À la capture, avant le plein écran : on ne referme qu'une chose à la fois.
        event.preventDefault();
        event.stopImmediatePropagation();
        a.choisir([], []);
      }
    };

    const coller = (event: ClipboardEvent) => {
      if (event.defaultPrevented || dansUnChamp(event.target) || !estLaSurfaceVisee(moiMeme)) return;
      const donnees = event.clipboardData;
      if (!donnees) return;
      const a = actions.current;

      const fragment = fragmentDuCollage(donnees.getData("text/html"));
      if (fragment) {
        event.preventDefault();
        a.coller(fragment);
        return;
      }
      const image = Array.from(donnees.files).find((f) => f.type.startsWith("image/"));
      if (image) {
        event.preventDefault();
        void a.poserImage(image);
        return;
      }
      // Une feuille n'a pas d'autre endroit pour du texte : il devient une zone.
      if (ouverteEnFeuille) {
        const blocs = blocsDuPressePapiers(donnees.getData("text/html"), donnees.getData("text/plain"));
        if (blocs.length > 0) {
          event.preventDefault();
          a.collerTexte(blocs.map((b) => (b.kind === "text" ? b.markup : tableEnLignes(b.rows))));
          return;
        }
      }
      // Rien d'autre à coller — dépôt refusé par le navigateur, le plus souvent :
      // ce que l'app a gardé reste valable. Du texte, lui, revient à la note.
      if (donnees.types.length === 0) {
        const garde = lireFragment();
        if (garde) {
          event.preventDefault();
          a.coller(garde);
        }
      }
    };

    window.addEventListener("keydown", clavier, true);
    window.addEventListener("paste", coller);
    return () => {
      window.removeEventListener("keydown", clavier, true);
      window.removeEventListener("paste", coller);
      const rang = surfaces.indexOf(moiMeme);
      if (rang >= 0) surfaces.splice(rang, 1);
      if (surfaceTouchee === moiMeme) surfaceTouchee = null;
    };
  }, [readOnly, ouverteEnFeuille]);

  /** Une image ou un document lâché sur la page atterrit là où on l'a lâché. */
  function deposer(event: React.DragEvent<HTMLDivElement>) {
    if (readOnly || !scrollId) return;
    const file = Array.from(event.dataTransfer.files)[0];
    if (!file) return;
    event.preventDefault();
    event.stopPropagation();
    if (estDocument(file)) {
      void ajouterDocument(file);
      return;
    }
    if (!file.type.startsWith("image/")) {
      setErreurImage("Seules les images et les documents peuvent être déposés ici.");
      return;
    }
    const surface = document.querySelector<HTMLElement>(`[data-ink-scroll="${scrollId}"]`);
    const rect = surface?.getBoundingClientRect();
    const centre =
      surface && rect && surface.scrollWidth > 0
        ? {
            x: (event.clientX - rect.left + surface.scrollLeft) / surface.scrollWidth,
            y: (event.clientY - rect.top + surface.scrollTop) / surface.scrollWidth,
          }
        : undefined;
    void poserImage(file, centre);
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

  // Échap ferme le plein écran, comme partout ailleurs dans l'app. Une feuille,
  // elle, n'a pas d'autre état où revenir : on en sort par son bouton de retour.
  React.useEffect(() => {
    if (!full) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !ouverteEnFeuille) setFull(false);
    };
    window.addEventListener("keydown", onKey);
    // La page derrière ne doit pas défiler sous la feuille.
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previous;
    };
  }, [full, ouverteEnFeuille]);

  /*
   * Ce que la barre laisse en bas de l'écran, publié pour le repère de page.
   *
   * Cela ne se devine pas : la barre passe sur quatre rangées sur téléphone et
   * sur deux sur iPad, un décalage fixe posait le repère sur les couleurs. Et
   * depuis qu'elle se déplace, elle n'est pas toujours en bas : collée à
   * gauche, en haut, ou repliée en bulle, elle ne prend plus rien au repère —
   * qui doit alors redescendre, sans quoi il flotterait au milieu de l'écran
   * pour rien.
   */
  React.useEffect(() => {
    if (!full) return;
    const racine = document.documentElement;
    const barre = surfaceRef.current?.querySelector('[data-testid="barre-flottante"]');
    if (!barre || position.bord !== "bottom" || position.reduit) {
      racine.style.setProperty("--ink-palette-h", "0px");
      return () => racine.style.removeProperty("--ink-palette-h");
    }
    const publier = () =>
      racine.style.setProperty("--ink-palette-h", `${Math.round(barre.getBoundingClientRect().height)}px`);
    const observer = new ResizeObserver(publier);
    observer.observe(barre);
    publier();
    return () => {
      observer.disconnect();
      racine.style.removeProperty("--ink-palette-h");
    };
  }, [full, position.bord, position.reduit, tool]);

  /** Les formes se tracent au stylo : elles n'ont pas de réglages à elles. */
  const instrumentCourant: Tool = (TOOLS as readonly string[]).includes(tool)
    ? (tool as Tool)
    : "pen";
  const reglages = settings[instrumentCourant];

  /*
   * Le reste de la page a besoin de savoir qu'on écrit en plein écran.
   *
   * Le repère de page flotte en bas de l'écran, là où la palette s'installe :
   * sans cela il se poserait dessus.
   */
  React.useEffect(() => {
    onFullChange?.(full);
  }, [full, onFullChange]);

  const viser = (event?: React.PointerEvent) => {
    surfaceTouchee = moi.current;
    // Une commande touchée juste après un trait : il doit être dans le contenu avant
    // qu'elle ne le lise. Sur la feuille elle-même, l'encre attend sa pause.
    const cible = event?.target as HTMLElement | undefined;
    if (!cible?.closest?.('[data-testid="drawing-canvas"]')) encre.current?.verser();
  };

  const palette = (
    <InkPalette
      tool={tool}
      settings={settings}
      shape={shape}
      position={position}
      onPosition={placerBarre}
      paper={fond}
      eraseHighlightsOnly={eraseHighlightsOnly}
      erasePrecise={erasePrecise}
      penOnly={penOnly}
      penDetected={penMode}
      selection={selection.length}
      selectionImages={imagesChoisies.length}
      onPaste={fragmentGarde ? () => coller(fragmentGarde) : undefined}
      onMasques={
        rangsSurlignes.length > 0 ? () => setReveles((avant) => (avant ? null : new Set())) : undefined
      }
      masques={
        reveles
          ? {
              reveles: rangsSurlignes.filter(({ rang }) => reveles.has(rang)).length,
              total: rangsSurlignes.length,
              onSuivant: revelerSuivant,
              onTout: () =>
                setReveles((avant) =>
                  avant && avant.size === rangsSurlignes.length
                    ? new Set()
                    : new Set(rangsSurlignes.map(({ rang }) => rang)),
                ),
            }
          : null
      }
      onSearch={recherchable ? () => setLoupe((ouverte) => !ouverte) : undefined}
      bandeau={feuille ? { gauche: feuille.gauche, droite: feuille.droite } : undefined}
      tailleTexte={tailleTexte}
      onTailleTexte={readOnly ? undefined : setTailleTexte}
      searchOpen={loupe}
      zoom={zoom}
      full={full}
      paperEditable={!fondImpose}
      canAddPage={pages.length < MAX_DOCUMENT_PAGES}
      canRemovePage={retirable && pages.length > 1}
      canUndo={historique.annuler}
      canRedo={historique.retablir}
      onAddImage={readOnly || !scrollId ? undefined : () => imageRef.current?.click()}
      onPlaceImage={readOnly || !scrollId ? undefined : () => poseRef.current?.click()}
      addingImage={envoiImage}
      ruler={ruler}
      onTool={setTool}
      onSettings={(next) =>
        setSettings((avant) => ({ ...avant, [instrumentCourant]: next }))
      }
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
      onToggleFull={feuille ? undefined : () => setFull((f) => !f)}
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
      imagesChoisies={imagesChoisies}
      onSelect={choisir}
      surlignes={surlignes.tous}
      surligneActif={surlignes.actif}
      masques={masquesCanvas}
      poigneeRef={encre}
      zoneEditee={zoneEditee?.zone.id ?? null}
      onTexte={readOnly ? undefined : ouvrirZone}
      onFinTexte={() => terminerTexte.current?.()}
      onMesureTexte={readOnly ? undefined : mesurerZone}
      editeur={
        zoneEditee
          ? (largeurPage) => (
              <EditeurZone
                key={zoneEditee.zone.id}
                zone={zoneEditee.zone}
                pageW={largeurPage}
                terminerRef={terminerTexte}
                onFin={finirZone}
                onLargeur={(w) =>
                  setZoneEditee((avant) => (avant ? { ...avant, zone: { ...avant.zone, w } } : avant))
                }
              />
            )
          : undefined
      }
      barreSelection={
        <BarreSelection
          onCouper={couperSelection}
          onCopier={() => copierSelection()}
          onDupliquer={dupliquerSelection}
          onCarte={scrollId ? ouvrirCarte : undefined}
          onModifier={
            selection.length === 0 && imagesChoisies.length === 1
              ? modifierZoneChoisie
              : undefined
          }
          onRecadrer={
            selection.length === 0 &&
            imagesChoisies.length === 1 &&
            content.images.some((im) => im.id === imagesChoisies[0])
              ? ouvrirRecadrage
              : undefined
          }
          onSupprimer={deleteSelection}
        />
      }
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

  const loupeOuverte =
    loupe && noteId && scrollId ? (
      <LoupeNote
        noteId={noteId}
        scrollId={scrollId}
        content={content}
        initiale={initialeApplicable ? rechercheInitiale : undefined}
        // Sous l'en-tête de la feuille, ou sous la barre de l'app.
        className={feuille ? "top-32 md:top-[4.75rem]" : full ? "top-3" : "top-20"}
        onSurlignes={setSurlignes}
        onFermer={() => {
          setLoupe(false);
          setSurlignes({ tous: [], actif: [] });
        }}
      />
    ) : null;

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
      {zoneCarte && scrollId ? (
        <CarteDepuisNote
          scrollId={scrollId}
          content={content}
          cadre={zoneCarte.cadre}
          onClose={() => setZoneCarte(null)}
        />
      ) : null}
      <input
        ref={poseRef}
        type="file"
        accept="image/*"
        data-pose-image=""
        className="sr-only"
        tabIndex={-1}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          if (file.size > MAX_UPLOAD_BYTES * 6) {
            setErreurImage("Image beaucoup trop lourde.");
            return;
          }
          setARecadrerPose({ file, remplace: null });
        }}
      />
      {aRecadrerPose ? (
        <ImageCropper
          key={`${aRecadrerPose.file.name}-${aRecadrerPose.file.size}-${aRecadrerPose.file.lastModified}`}
          file={aRecadrerPose.file}
          maxSide={COTE_MAX}
          type="image/jpeg"
          onCancel={() => setARecadrerPose(null)}
          onConfirm={(recadree) => {
            const { remplace } = aRecadrerPose;
            setARecadrerPose(null);
            if (remplace) void remplacerImage(remplace, recadree);
            else void poserImage(recadree);
          }}
        />
      ) : null}
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
        {feuille ? null : (
          <div
            aria-hidden
            className="grid place-items-center rounded-xl border border-dashed border-outline-variant py-10 m3-body-medium text-on-surface-variant"
            style={{ aspectRatio: `1 / ${Math.min(content.ratio, 1)}` }}
          >
            Page ouverte en plein écran
          </div>
        )}

        {/* z-50, pas z-40 : la barre de navigation du téléphone est aussi en
            z-40 et vient après la note dans le document — à égalité elle
            passait devant, et cachait la moitié de la palette. */}
        <div
          ref={surfaceRef}
          onPointerDownCapture={viser}
          onDragOver={(event) => event.preventDefault()}
          onDrop={deposer}
          className="ink-surface fixed inset-0 z-50 flex flex-col bg-surface"
        >
          {feuille ? palette : null}
          {feuille?.sous}
          {loupeOuverte}
          {/* Pleine largeur, sans marge : la feuille doit occuper l'écran, pas
              flotter au milieu. Le défilement sert à descendre dans la page,
              qui s'allonge à mesure qu'on écrit. */}
          <div ref={zoneRef} className="scroll-slim min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {canvas}
          </div>
          {alerteImage}
          {suiviDocument}
          {/* La barre est en position fixe : elle ne prend pas de place dans la
              colonne, et la feuille occupe donc tout l'écran — c'est ce qui
              fait la différence entre « une page avec une barre en dessous » et
              « une page, avec les outils posés dessus ». */}
          {feuille ? null : palette}
          {selecteurImage}
        </div>
      </>
    );
  }

  return (
    <div
      className="space-y-2"
      onPointerDownCapture={viser}
      onDragOver={(event) => event.preventDefault()}
      onDrop={deposer}
    >
      {readOnly ? null : <div ref={paletteRef}>{palette}</div>}
      {loupeOuverte}
      {alerteImage}
      {suiviDocument}
      {canvas}
      {selecteurImage}
    </div>
  );
}

/** Le presse-papiers de l'app n'existe que sur l'appareil. */
function lireFragmentSurClient(): FragmentEncre | null {
  return typeof window === "undefined" ? null : lireFragment();
}

/**
 * Les actions de ce que le lasso a retenu, posées sous son cadre.
 *
 * Là où est la main : aller les chercher dans la palette, en bas de l'écran,
 * obligerait à quitter des yeux ce qu'on vient de sélectionner.
 */
function BarreSelection({
  onCouper,
  onCopier,
  onDupliquer,
  onCarte,
  onModifier,
  onRecadrer,
  onSupprimer,
}: {
  onCouper: () => void;
  onCopier: () => void;
  onDupliquer: () => void;
  onCarte?: () => void;
  onModifier?: () => void;
  onRecadrer?: () => void;
  onSupprimer: () => void;
}) {
  const actions = [
    { label: "Couper la sélection", icon: Scissors, onClick: onCouper },
    { label: "Copier la sélection", icon: ClipboardCopy, onClick: onCopier },
    { label: "Dupliquer la sélection", icon: Files, onClick: onDupliquer },
    ...(onModifier ? [{ label: "Modifier le texte", icon: PenLine, onClick: onModifier }] : []),
    ...(onCarte ? [{ label: "Créer une carte", icon: BookPlus, onClick: onCarte }] : []),
    ...(onRecadrer ? [{ label: "Recadrer l'image", icon: Crop, onClick: onRecadrer }] : []),
    { label: "Supprimer ce qui est sélectionné", icon: Trash2, onClick: onSupprimer, danger: true },
  ];
  return (
    <div
      role="toolbar"
      aria-label="Actions de la sélection"
      data-testid="barre-selection"
      className="flex items-center gap-0.5 rounded-full bg-surface-highest p-0.5 text-on-surface elevation-2"
    >
      {actions.map(({ label, icon: Icon, onClick, danger }) => (
        <button
          key={label}
          type="button"
          onClick={onClick}
          aria-label={label}
          title={label}
          className={cn(
            "state-layer grid size-11 shrink-0 place-items-center rounded-full",
            danger ? "text-error" : "text-on-surface-variant",
          )}
        >
          <Icon className="size-5" />
        </button>
      ))}
    </div>
  );
}
