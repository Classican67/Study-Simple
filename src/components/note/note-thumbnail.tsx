"use client";

import * as React from "react";
import { FileText } from "lucide-react";

import { PdfPage } from "@/components/note/pdf-page";
import type { NotePreview } from "@/lib/notes";
import { cn } from "@/lib/utils";

/**
 * Vignette d'une note.
 *
 * Une liste de titres ne dit rien : deux notes de cours se ressemblent jusqu'à
 * ce qu'on les ouvre. La vignette montre la première page — la page du document
 * importé, ou l'écriture elle-même.
 *
 * Elle est dessinée à partir de l'**aperçu** enregistré avec la note, jamais en
 * relisant ses blocs : une page dense pèse des centaines de kilooctets, et une
 * liste de vingt notes deviendrait plus lourde que les notes.
 */
export function NoteThumbnail({
  preview,
  className,
  style,
}: {
  preview: NotePreview;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (!preview) {
    return (
      <div
        style={style}
        className={cn(
          "grid place-items-center bg-surface-lowest text-on-surface-variant/40",
          className,
        )}
      >
        <FileText className="size-8" />
      </div>
    );
  }

  if (preview.kind === "image") {
    return (
      <div style={style} className={cn("overflow-hidden bg-surface-lowest", className)}>
        {/* `object-cover` : une vignette est un cadre fixe, et une photo au
            format libre y laisserait des bandes. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={`/api/uploads/${preview.file}`}
          alt="Photo annotée"
          loading="lazy"
          className="h-full w-full object-cover"
        />
      </div>
    );
  }

  if (preview.kind === "pdf") {
    return (
      <div style={style} className={cn("overflow-hidden bg-surface-lowest", className)}>
        <PdfPage file={preview.file} page={preview.page} className="h-full w-full object-cover" />
      </div>
    );
  }

  return <InkThumbnail preview={preview} className={className} style={style} />;
}

function InkThumbnail({
  preview,
  className,
  style,
}: {
  preview: Extract<NotePreview, { kind: "ink" }>;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const largeur = canvas.clientWidth;
    const hauteur = canvas.clientHeight;
    if (largeur === 0) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(largeur * dpr);
    canvas.height = Math.round(hauteur * dpr);
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, largeur, hauteur);

    const styles = getComputedStyle(canvas);
    // Le trait est simplifié à l'extrême : une vignette n'a pas à rendre la
    // pression, seulement à faire reconnaître la page.
    context.lineCap = "round";
    context.lineJoin = "round";
    context.lineWidth = Math.max(0.8, largeur / 180);

    for (const stroke of preview.strokes) {
      context.strokeStyle =
        styles.getPropertyValue(`--ink-${stroke.color}`).trim() || styles.color;
      context.beginPath();
      // Les points sont en millièmes entiers de la largeur de la page.
      context.moveTo((stroke.points[0] / 1000) * largeur, (stroke.points[1] / 1000) * largeur);
      for (let i = 2; i + 1 < stroke.points.length; i += 2) {
        context.lineTo((stroke.points[i] / 1000) * largeur, (stroke.points[i + 1] / 1000) * largeur);
      }
      context.stroke();
    }
  }, [preview]);

  return (
    <canvas
      ref={ref}
      style={style}
      role="img"
      aria-label="Aperçu de la page manuscrite"
      className={cn("block bg-surface-lowest text-on-surface", className)}
    />
  );
}
