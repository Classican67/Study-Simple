"use client";

import * as React from "react";
import { Check, Loader2, Maximize, RotateCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  FULL_CROP,
  fitWithin,
  moveCrop,
  resizeCrop,
  toSourceRect,
  type Corner,
  type CropRect,
} from "@/lib/crop";
import { cn } from "@/lib/utils";

/**
 * Recadrage d'une photo avant envoi.
 *
 * Le rectangle se déplace au doigt comme à la souris ; les poignées de coin
 * font 44 px, la taille d'une cible tactile, tout en n'affichant qu'un repère
 * discret.
 *
 * L'export passe par un canvas, ce qui permet au passage de **réduire** la
 * photo : un cliché d'iPad pèse plusieurs mégaoctets pour 12 mégapixels, dont
 * une carte de révision n'a aucun usage.
 */

// Plus grand côté de l'image enregistrée. Au-delà, on ne gagne que du poids.
const MAX_SIDE = 1600;
const OUTPUT_TYPE = "image/webp";
const OUTPUT_QUALITY = 0.9;

type Drag =
  | { kind: "move"; startX: number; startY: number; origin: CropRect }
  | { kind: "resize"; corner: Corner };

export function ImageCropper({
  file,
  onCancel,
  onConfirm,
}: {
  file: File;
  onCancel: () => void;
  onConfirm: (cropped: File) => void;
}) {
  // Initialiseur paresseux : le fichier ne change pas pendant la vie du
  // composant (le parent le remonte pour chaque nouvelle photo), donc l'URL
  // se crée une fois, sans passer par un effet qui poserait un état.
  const [source, setSource] = React.useState<string>(() => URL.createObjectURL(file));
  const [crop, setCrop] = React.useState<CropRect>(FULL_CROP);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const imageRef = React.useRef<HTMLImageElement>(null);
  const dragRef = React.useRef<Drag | null>(null);
  // Les URL d'objet doivent être révoquées, sinon chaque rotation fuit.
  const urlRef = React.useRef<string | null>(null);

  // Suit l'URL courante pour pouvoir la révoquer au démontage : sans cela,
  // chaque rotation laisserait un blob en mémoire.
  React.useEffect(() => {
    urlRef.current = source;
  }, [source]);

  React.useEffect(() => {
    return () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    };
  }, []);

  function replaceSource(next: string) {
    URL.revokeObjectURL(source);
    setSource(next);
  }

  // Position du pointeur, ramenée en fraction de l'image affichée.
  function pointerToFraction(event: React.PointerEvent) {
    const bounds = imageRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width === 0) return null;
    return {
      x: (event.clientX - bounds.left) / bounds.width,
      y: (event.clientY - bounds.top) / bounds.height,
    };
  }

  function startMove(event: React.PointerEvent) {
    const point = pointerToFraction(event);
    if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "move", startX: point.x, startY: point.y, origin: crop };
  }

  function startResize(event: React.PointerEvent, corner: Corner) {
    // Sans cela, la poignée déclencherait aussi le déplacement du rectangle.
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = { kind: "resize", corner };
  }

  function onPointerMove(event: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const point = pointerToFraction(event);
    if (!point) return;

    if (drag.kind === "move") {
      setCrop(moveCrop(drag.origin, point.x - drag.startX, point.y - drag.startY));
    } else {
      setCrop((current) => resizeCrop(current, drag.corner, point.x, point.y));
    }
  }

  function endDrag(event: React.PointerEvent) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragRef.current = null;
  }

  // Le cadre est focalisable : les flèches le déplacent, ce qui rend le
  // recadrage utilisable sans pointeur.
  function onKeyDown(event: React.KeyboardEvent) {
    const step = event.shiftKey ? 0.05 : 0.01;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    setCrop((current) => moveCrop(current, move[0], move[1]));
  }

  /**
   * Rotation par quarts de tour. On produit immédiatement une image droite
   * plutôt que de porter un angle dans tous les calculs : le recadrage opère
   * alors toujours sur une image à l'endroit.
   */
  async function rotate() {
    const image = imageRef.current;
    if (!image) return;
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalHeight;
      canvas.height = image.naturalWidth;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas indisponible");

      context.translate(canvas.width / 2, canvas.height / 2);
      context.rotate(Math.PI / 2);
      context.drawImage(image, -image.naturalWidth / 2, -image.naturalHeight / 2);

      const blob = await toBlob(canvas, OUTPUT_TYPE, 1);
      replaceSource(URL.createObjectURL(blob));
      // Les proportions ont changé : un ancien rectangle n'aurait plus de sens.
      setCrop(FULL_CROP);
    } catch {
      setError("Rotation impossible.");
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const image = imageRef.current;
    if (!image) return;
    setBusy(true);
    setError(null);

    try {
      const { sx, sy, sw, sh } = toSourceRect(crop, image.naturalWidth, image.naturalHeight);
      const target = fitWithin(sw, sh, MAX_SIDE);

      const canvas = document.createElement("canvas");
      canvas.width = target.width;
      canvas.height = target.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas indisponible");

      // Lissage de qualité : une photo réduite d'un facteur 3 sans lissage
      // devient crénelée, et un schéma manuscrit illisible.
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(image, sx, sy, sw, sh, 0, 0, target.width, target.height);

      const blob = await toBlob(canvas, OUTPUT_TYPE, OUTPUT_QUALITY);
      onConfirm(new File([blob], "photo.webp", { type: OUTPUT_TYPE }));
    } catch {
      setError("Recadrage impossible. Réessaie, ou envoie la photo sans la recadrer.");
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onCancel()}>
      <DialogContent
        title="Recadrer la photo"
        description="Déplace le cadre ou tire ses coins. L'image est réduite avant l'envoi."
        className="sm:max-w-3xl"
      >
        <div className="space-y-4">
          <div className="relative mx-auto w-fit select-none overflow-hidden rounded-xl bg-black/80">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              ref={imageRef}
              src={source}
              alt="Photo à recadrer"
              draggable={false}
              className="max-h-[min(55dvh,26rem)] w-auto max-w-full"
            />

            {/* Cadre de recadrage, positionné en pourcentages de l'image. */}
            <div
              role="application"
              aria-label="Cadre de recadrage. Les flèches le déplacent."
              tabIndex={0}
              onPointerDown={startMove}
              onPointerMove={onPointerMove}
              onPointerUp={endDrag}
              onPointerCancel={endDrag}
              onKeyDown={onKeyDown}
              // `touch-none` : sans cela le navigateur fait défiler la page
              // au lieu de laisser déplacer le cadre.
              className="absolute cursor-move touch-none outline-none ring-2 ring-white ring-offset-0"
              style={{
                left: `${crop.x * 100}%`,
                top: `${crop.y * 100}%`,
                width: `${crop.width * 100}%`,
                height: `${crop.height * 100}%`,
                // Assombrit tout ce qui est hors du cadre, sans surcouche.
                boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
              }}
            >
              {(["nw", "ne", "sw", "se"] as Corner[]).map((corner) => (
                <span
                  key={corner}
                  onPointerDown={(event) => startResize(event, corner)}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  className={cn(
                    // 44 px de zone de saisie, 12 px de repère visible.
                    "absolute grid size-11 touch-none place-items-center",
                    corner[0] === "n" ? "-top-5" : "-bottom-5",
                    corner[1] === "w" ? "-left-5" : "-right-5",
                    corner === "nw" && "cursor-nwse-resize",
                    corner === "se" && "cursor-nwse-resize",
                    corner === "ne" && "cursor-nesw-resize",
                    corner === "sw" && "cursor-nesw-resize",
                  )}
                >
                  <span className="size-3 rounded-full bg-white shadow" />
                </span>
              ))}
            </div>
          </div>

          {error ? (
            <p role="alert" className="text-center text-sm text-danger">
              {error}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex gap-2">
              <Button type="button" variant="secondary" onClick={() => setCrop(FULL_CROP)}>
                <Maximize />
                Toute l&apos;image
              </Button>
              <Button type="button" variant="secondary" onClick={rotate} disabled={busy}>
                <RotateCw />
                Pivoter
              </Button>
            </div>

            <div className="flex flex-1 gap-2 sm:flex-none">
              <Button
                type="button"
                variant="secondary"
                onClick={onCancel}
                className="flex-1 sm:flex-none"
              >
                Annuler
              </Button>
              <Button type="button" onClick={confirm} disabled={busy} className="flex-1 sm:flex-none">
                {busy ? <Loader2 className="animate-spin" /> : <Check />}
                Utiliser
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// `canvas.toBlob` ne renvoie rien en cas d'échec : on en fait une promesse
// qui rejette, pour que l'appelant puisse afficher un message.
function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("encodage impossible"))),
      type,
      quality,
    );
  });
}
