"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Rend une page de PDF, pour servir de fond à une page manuscrite.
 *
 * Le rendu est fait **dans le navigateur** par pdf.js : le serveur n'a alors
 * ni moteur PDF ni images dérivées à stocker, et la netteté suit la largeur
 * réellement affichée plutôt qu'une taille décidée à l'avance.
 *
 * La page est rendue une fois, à deux fois la largeur d'affichage — assez pour
 * un écran à haute densité sans transformer chaque page en plusieurs mégaoctets.
 */

/** pdf.js est lourd : on ne le charge qu'au premier document rencontré. */
let pdfjs: typeof import("pdfjs-dist") | null = null;

async function loadPdfjs() {
  if (pdfjs) return pdfjs;
  const lib = await import("pdfjs-dist");
  /*
   * Le worker est servi depuis public/, copié là par scripts/copy-pdf-worker.mjs.
   *
   * Sans worker, pdf.js analyse le document sur le fil principal et gèle
   * l'interface. Et le faire résoudre par le bundler échoue en silence :
   * `new URL("pdfjs-dist/…", import.meta.url)` est pris pour un chemin relatif
   * au module et aboutit à un 404, dont on ne voit que « ce PDF n'a pas pu
   * être lu ».
   */
  lib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  pdfjs = lib;
  return lib;
}

// Un même document sert de fond à toutes ses pages : on ne le télécharge et ne
// l'analyse qu'une fois.
const documents = new Map<string, Promise<import("pdfjs-dist").PDFDocumentProxy>>();

export function openDocument(file: string) {
  const cached = documents.get(file);
  if (cached) return cached;
  const promise = loadPdfjs().then((lib) =>
    lib.getDocument({ url: `/api/uploads/${file}` }).promise,
  );
  documents.set(file, promise);
  return promise;
}

/*
 * Le format des pages est relevé **par le serveur**, à l'import.
 *
 * Il l'était ici : pdf.js retéléchargeait le document entier juste après
 * l'envoi, pour n'en lire que les dimensions. Sur iPad, un polycopié de trente
 * mégaoctets repartait donc du serveur aussitôt après y être monté, et l'import
 * n'en sortait jamais. Cf. `pageRatios` dans `src/lib/documents.ts`.
 */

/** Limite de Safari pour un côté de canevas. Au-delà, il ne peint plus rien. */
const SIDE_MAX = 4096;

/**
 * Palier de résolution.
 *
 * Le zoom se règle en continu, mais rerendre la page à chaque image du geste
 * refait tout le travail de pdf.js pour une netteté qui ne se voit pas. On ne
 * change de résolution que par bonds d'un tiers, et **jamais vers le bas** :
 * revenir en arrière rendrait le fond flou en dézoomant, alors que les pixels
 * étaient déjà là.
 */
function palier(largeur: number): number {
  return Math.pow(1.33, Math.ceil(Math.log(Math.max(1, largeur)) / Math.log(1.33)));
}

export function PdfPage({
  file,
  page,
  width,
  className,
}: {
  file: string;
  page: number;
  /**
   * Largeur d'affichage, en pixels CSS.
   *
   * Elle suit le zoom : sans elle, la page était rasterisée une fois pour
   * toutes à deux fois sa largeur d'origine, et agrandir quatre fois donnait un
   * fond aussi crénelé que l'encre l'était.
   */
  width?: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState(false);
  // Résolution déjà obtenue, et pour quelle page : on ne redescend jamais, et
  // on ne remonte que par paliers. La page est retenue avec elle, sinon un
  // changement de document hériterait de la résolution du précédent et ne
  // redessinerait pas.
  const rendu = React.useRef({ cle: "", largeur: 0 });
  const cle = `${file}#${page}`;

  // `window` n'existe pas au rendu serveur : la densité y est supposée à deux,
  // ce que l'effet corrigera au montage si besoin.
  const densite = typeof window === "undefined" ? 2 : Math.min(window.devicePixelRatio || 1, 2);
  const cible = palier((width ?? 0) * densite || 1600);

  React.useEffect(() => {
    let annule = false;
    const canvas = ref.current;
    if (!canvas) return;

    // Une nouvelle page : la résolution acquise ne vaut plus.
    let tache: { cancel: () => void } | null = null;

    (async () => {
      try {
        const doc = await openDocument(file);
        if (annule) return;
        const pdfPage = await doc.getPage(page);
        if (annule) return;

        const base = pdfPage.getViewport({ scale: 1 });
        const voulue = Math.min(cible, SIDE_MAX, (SIDE_MAX * base.width) / base.height);
        if (rendu.current.cle === cle && voulue <= rendu.current.largeur) return;

        const viewport = pdfPage.getViewport({ scale: voulue / base.width });
        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) return;
        const rendre = pdfPage.render({ canvas, canvasContext: context, viewport });
        tache = rendre;
        await rendre.promise;
        if (!annule) rendu.current = { cle, largeur: voulue };
      } catch (cause) {
        // Un rendu annulé n'est pas une panne : on change de résolution en
        // cours de route dès qu'on zoome.
        if (annule || (cause instanceof Error && cause.name === "RenderingCancelledException")) return;
        // Document supprimé, illisible, ou pdf.js indisponible : la page
        // manuscrite reste utilisable, simplement sans son fond.
        console.error(
          "[pdf] rendu impossible :",
          cause instanceof Error ? `${cause.name}: ${cause.message}` : cause,
        );
        setError(true);
      }
    })();

    return () => {
      annule = true;
      // Un rendu laissé en cours garde le canevas occupé : pdf.js refuse alors
      // le suivant sur la même page, et le fond reste blanc.
      tache?.cancel();
    };
  }, [file, page, cle, cible]);

  if (error) {
    return (
      <div
        className={cn(
          "grid place-items-center bg-surface-container p-4 text-center m3-body-small text-on-surface-variant",
          className,
        )}
      >
        Document illisible. Tes annotations sont conservées.
      </div>
    );
  }

  return (
    <canvas
      ref={ref}
      aria-label={`Page ${page} du document importé`}
      role="img"
      className={cn("block h-full w-full", className)}
    />
  );
}
