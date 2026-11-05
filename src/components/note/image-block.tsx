"use client";

import * as React from "react";
import { AlignCenter, AlignLeft, AlignRight } from "lucide-react";

import {
  IMAGE_BLOC_LARGEUR_MIN,
  MAX_LEGENDE,
  type ImageAlignement,
  type ImageBlockContent,
} from "@/lib/notes";
import { cn } from "@/lib/utils";

/**
 * Une image dans le fil de la note, à la taille qu'on veut.
 *
 * On la tire par un de ses bords, comme dans un traitement de texte, et les
 * largeurs courantes sont à un geste. Tout est gardé en **proportion de la
 * colonne** : elle occupe la même place sur un téléphone et sur un iPad.
 *
 * Une poignée est un curseur (`role="slider"`), réglable aux flèches : sans cela,
 * l'image ne se redimensionnerait qu'à la souris ou au doigt.
 */

const ALIGNEMENTS: { valeur: ImageAlignement; label: string; icon: React.ElementType }[] = [
  { valeur: "left", label: "Aligner à gauche", icon: AlignLeft },
  { valeur: "center", label: "Centrer", icon: AlignCenter },
  { valeur: "right", label: "Aligner à droite", icon: AlignRight },
];

const LARGEURS = [0.25, 0.5, 0.75, 1];

export function ImageBlock({
  content,
  onChange,
}: {
  content: ImageBlockContent;
  onChange: (next: ImageBlockContent) => void;
}) {
  const colonne = React.useRef<HTMLDivElement>(null);
  // Largeur pendant le geste : l'enregistrement n'a lieu qu'au lâcher.
  const [vive, setVive] = React.useState<number | null>(null);
  const largeur = vive ?? content.largeur;
  const justification = {
    left: "justify-start",
    center: "justify-center",
    right: "justify-end",
  }[content.align];

  const borner = (valeur: number) =>
    Math.min(1, Math.max(IMAGE_BLOC_LARGEUR_MIN, Math.round(valeur * 1000) / 1000));

  function largeurDepuis(clientX: number): number {
    const rect = colonne.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return content.largeur;
    const x = clientX - rect.left;
    // Centrée, l'image grandit des deux côtés : la main n'en parcourt que la moitié.
    if (content.align === "center") return borner((Math.abs(x - rect.width / 2) * 2) / rect.width);
    if (content.align === "right") return borner((rect.width - x) / rect.width);
    return borner(x / rect.width);
  }

  function poignee(cote: "gauche" | "droite") {
    const cachee =
      (cote === "gauche" && content.align === "left") ||
      (cote === "droite" && content.align === "right");
    if (cachee) return null;
    return (
      <div
        role="slider"
        tabIndex={0}
        aria-label={`Largeur de l'image, bord ${cote}`}
        aria-orientation="horizontal"
        aria-valuemin={Math.round(IMAGE_BLOC_LARGEUR_MIN * 100)}
        aria-valuemax={100}
        aria-valuenow={Math.round(largeur * 100)}
        aria-valuetext={`${Math.round(largeur * 100)} %`}
        data-poignee-image={cote}
        onPointerDown={(event) => {
          event.preventDefault();
          event.currentTarget.setPointerCapture(event.pointerId);
          setVive(content.largeur);
        }}
        onPointerMove={(event) => {
          if (vive === null) return;
          setVive(largeurDepuis(event.clientX));
        }}
        onPointerUp={(event) => {
          if (vive === null) return;
          const finale = largeurDepuis(event.clientX);
          setVive(null);
          if (finale !== content.largeur) onChange({ ...content, largeur: finale });
        }}
        onPointerCancel={() => setVive(null)}
        onKeyDown={(event) => {
          const pas = event.shiftKey ? 0.1 : 0.02;
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            onChange({ ...content, largeur: borner(content.largeur + pas) });
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            onChange({ ...content, largeur: borner(content.largeur - pas) });
          }
        }}
        className={cn(
          "absolute top-1/2 grid h-16 w-11 -translate-y-1/2 cursor-ew-resize place-items-center",
          cote === "gauche" ? "left-0 -translate-x-1/2" : "right-0 translate-x-1/2",
        )}
        style={{ touchAction: "none" }}
      >
        <span aria-hidden className="h-12 w-1.5 rounded-full bg-primary elevation-1" />
      </div>
    );
  }

  return (
    <figure className="space-y-2">
      <div ref={colonne} className={cn("flex", justification)}>
        <div className="relative" style={{ width: `${largeur * 100}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/uploads/${content.file}`}
            alt={content.legende}
            draggable={false}
            decoding="async"
            className="block h-auto w-full rounded-lg"
            style={{ aspectRatio: `1 / ${content.ratio}` }}
          />
          {poignee("gauche")}
          {poignee("droite")}
          {vive !== null ? (
            <span className="absolute left-1/2 top-2 -translate-x-1/2 rounded-full bg-surface-highest px-3 py-1 m3-label-medium text-on-surface elevation-1">
              {Math.round(vive * 100)} %
            </span>
          ) : null}
        </div>
      </div>

      <figcaption className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <input
          value={content.legende}
          maxLength={MAX_LEGENDE}
          onChange={(event) => onChange({ ...content, legende: event.target.value })}
          aria-label="Légende de l'image"
          placeholder="Légende…"
          className="min-h-11 min-w-40 flex-1 bg-transparent px-1 m3-body-small text-on-surface outline-none placeholder:text-on-surface-variant"
        />
        <div role="group" aria-label="Largeur de l'image" className="flex items-center">
          {LARGEURS.map((valeur) => (
            <button
              key={valeur}
              type="button"
              aria-pressed={content.largeur === valeur}
              onClick={() => onChange({ ...content, largeur: valeur })}
              className={cn(
                "state-layer grid h-11 min-w-11 place-items-center rounded-full px-1 m3-label-medium tabular-nums",
                content.largeur === valeur
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface-variant",
              )}
            >
              {valeur * 100} %
            </button>
          ))}
        </div>
        <div role="group" aria-label="Alignement de l'image" className="flex items-center">
          {ALIGNEMENTS.map(({ valeur, label, icon: Icon }) => (
            <button
              key={valeur}
              type="button"
              aria-label={label}
              title={label}
              aria-pressed={content.align === valeur}
              onClick={() => onChange({ ...content, align: valeur })}
              className={cn(
                "state-layer grid size-11 place-items-center rounded-full",
                content.align === valeur
                  ? "bg-secondary-container text-on-secondary-container"
                  : "text-on-surface-variant",
              )}
            >
              <Icon className="size-5" />
            </button>
          ))}
        </div>
      </figcaption>
    </figure>
  );
}
