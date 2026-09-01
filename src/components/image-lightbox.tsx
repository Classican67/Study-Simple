"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { Minus, Plus, X } from "lucide-react";

import { cn } from "@/lib/utils";

const MIN_SCALE = 1;
const MAX_SCALE = 5;
const STEP = 0.5;
// Grossissement appliqué au double-clic (ou double-tap) quand l'image est
// affichée entière.
const QUICK_ZOOM = 2.5;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/**
 * Vignette cliquable qui ouvre l'image en plein écran, zoomable et déplaçable.
 *
 * Les schémas de cours sont souvent illisibles à la taille d'une carte : c'est
 * la raison d'être de ce composant.
 */
export function ImageLightbox({
  src,
  alt,
  thumbnailClassName,
  onOpenChange,
}: {
  src: string;
  alt: string;
  thumbnailClassName?: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [scale, setScale] = React.useState(1);
  const [offset, setOffset] = React.useState({ x: 0, y: 0 });
  const dragRef = React.useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  // Le fait d'être en train de déplacer influence le rendu (on coupe la
  // transition CSS), il lui faut donc un état et pas seulement la ref : une
  // ref lue pendant le rendu ne provoque aucun re-rendu.
  const [dragging, setDragging] = React.useState(false);

  function reset() {
    setScale(1);
    setOffset({ x: 0, y: 0 });
    setDragging(false);
    dragRef.current = null;
  }

  function zoomTo(next: number) {
    const clamped = clamp(next, MIN_SCALE, MAX_SCALE);
    setScale(clamped);
    // Revenu à la taille d'origine, l'image doit se recentrer : sinon elle
    // reste décalée hors de l'écran après un déplacement.
    if (clamped === MIN_SCALE) setOffset({ x: 0, y: 0 });
  }

  function onPointerDown(event: React.PointerEvent<HTMLImageElement>) {
    if (scale === MIN_SCALE) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { x: event.clientX, y: event.clientY, ox: offset.x, oy: offset.y };
    setDragging(true);
  }

  function onPointerMove(event: React.PointerEvent<HTMLImageElement>) {
    const drag = dragRef.current;
    if (!drag) return;
    setOffset({
      x: drag.ox + (event.clientX - drag.x),
      y: drag.oy + (event.clientY - drag.y),
    });
  }

  function endDrag(event: React.PointerEvent<HTMLImageElement>) {
    if (dragRef.current && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
    setDragging(false);
  }

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) reset();
    // Prévient le parent : en révision, la carte doit cesser d'écouter le
    // clavier tant que la visionneuse est ouverte.
    onOpenChange?.(next);
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={handleOpenChange}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label={`${alt} — agrandir`}
          // La vignette peut se trouver dans une carte qui se retourne au clic
          // et se glisse au pointeur : on arrête la propagation aux deux
          // niveaux, sinon ouvrir l'image retournerait aussi la carte.
          onClick={(event) => event.stopPropagation()}
          onPointerDown={(event) => event.stopPropagation()}
          className={cn(
            "group relative inline-block max-w-full cursor-zoom-in overflow-hidden rounded-xl",
            "border border-outline-variant transition-colors hover:border-primary focus-visible:border-primary",
          )}
        >
          {/* La contrainte de taille porte sur l'image, pas sur le bouton : un
              bouton sans hauteur définie laissait l'image déborder et se faire
              couper par la zone défilante de la carte. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={alt}
            className={cn("block max-w-full object-contain", thumbnailClassName)}
          />
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 bg-black/0 transition-colors group-hover:bg-black/10"
          />
        </button>
      </DialogPrimitive.Trigger>

      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="pt-safe pb-safe fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-fade-in"
          // Le contenu est une image : rien à annoncer de plus que son alt,
          // déjà porté par le <img>.
          aria-label={alt}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <DialogPrimitive.Title className="sr-only">{alt}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            Image en plein écran. Double-tap ou double-clic pour zoomer, glisser pour déplacer,
            Échap pour fermer.
          </DialogPrimitive.Description>

          <div className="flex items-center justify-end gap-1 p-3">
            <button
              type="button"
              onClick={() => zoomTo(scale - STEP)}
              disabled={scale <= MIN_SCALE}
              aria-label="Dézoomer"
              className="grid size-11 place-items-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
            >
              <Minus className="size-4" />
            </button>
            <span className="min-w-16 text-center text-sm tabular-nums text-white/80">
              {/* Espace avant le signe, comme partout ailleurs dans l'app. */}
              {Math.round(scale * 100)}&nbsp;%
            </span>
            <button
              type="button"
              onClick={() => zoomTo(scale + STEP)}
              disabled={scale >= MAX_SCALE}
              aria-label="Zoomer"
              className="grid size-11 place-items-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20 disabled:opacity-30"
            >
              <Plus className="size-4" />
            </button>
            <DialogPrimitive.Close
              aria-label="Fermer"
              className="ml-2 grid size-11 place-items-center rounded-xl bg-white/10 text-white transition-colors hover:bg-white/20"
            >
              <X className="size-4" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden p-4 pt-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={src}
              alt={alt}
              onDoubleClick={() => zoomTo(scale > MIN_SCALE ? MIN_SCALE : QUICK_ZOOM)}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              draggable={false}
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                // Pas de transition pendant le déplacement, sinon l'image
                // traîne derrière le doigt.
                transition: dragging ? "none" : "transform 160ms ease-out",
              }}
              className={cn(
                "max-h-full max-w-full select-none object-contain",
                scale > MIN_SCALE ? "cursor-grab active:cursor-grabbing" : "cursor-zoom-in",
              )}
            />
          </div>

          {/* La légende complète déborde d'un écran de téléphone, et parle de
              raccourcis qui n'existent pas au doigt. */}
          <p className="px-4 pb-4 text-center text-xs text-white/50">
            <span className="lg:hidden">Double-tap pour zoomer · glisse pour déplacer</span>
            <span className="hidden lg:inline">
              Double-clic pour zoomer · glisser pour déplacer · Échap pour fermer
            </span>
          </p>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
