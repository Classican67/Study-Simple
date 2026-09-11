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

/** Format de chaque page du document : hauteur rapportée à la largeur. */
export async function pageRatios(file: string): Promise<number[]> {
  const doc = await openDocument(file);
  const ratios: number[] = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const { width, height } = page.getViewport({ scale: 1 });
    ratios.push(Number((height / width).toFixed(4)));
  }
  return ratios;
}

export function PdfPage({
  file,
  page,
  className,
}: {
  file: string;
  page: number;
  className?: string;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);
  const [error, setError] = React.useState(false);

  React.useEffect(() => {
    let annule = false;
    const canvas = ref.current;
    if (!canvas) return;

    (async () => {
      try {
        const doc = await openDocument(file);
        if (annule) return;
        const pdfPage = await doc.getPage(page);
        if (annule) return;

        const largeur = canvas.clientWidth || 800;
        const base = pdfPage.getViewport({ scale: 1 });
        // Deux fois la largeur affichée : net sur un écran à haute densité,
        // sans faire de chaque page plusieurs mégaoctets.
        const viewport = pdfPage.getViewport({ scale: (largeur * 2) / base.width });

        canvas.width = Math.round(viewport.width);
        canvas.height = Math.round(viewport.height);
        const context = canvas.getContext("2d");
        if (!context) return;
        await pdfPage.render({ canvas, canvasContext: context, viewport }).promise;
      } catch (cause) {
        // Document supprimé, illisible, ou pdf.js indisponible : la page
        // manuscrite reste utilisable, simplement sans son fond.
        if (!annule) {
          console.error("[pdf] rendu impossible :", cause);
          setError(true);
        }
      }
    })();

    return () => {
      annule = true;
    };
  }, [file, page]);

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
