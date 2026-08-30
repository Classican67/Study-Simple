"use client";

import * as React from "react";

/**
 * Confettis de fin de série.
 *
 * Dessinés sur un canvas plutôt qu'en éléments animés : deux cents particules
 * en DOM feraient travailler le moteur de mise en page à chaque image, ce qui
 * saccade sur un iPad.
 *
 * L'animation est purement décorative. Elle est donc marquée `aria-hidden`, et
 * n'est pas jouée du tout si le système demande à réduire les animations.
 */

const COUNT = 140;
const DURATION = 2600;
const GRAVITY = 0.00042;
const DRAG = 0.995;

// Reprend la palette de l'app plutôt que des couleurs vives arbitraires.
const COLORS = [
  "oklch(64% 0.21 292)",
  "oklch(56% 0.17 250)",
  "oklch(58% 0.14 160)",
  "oklch(70% 0.16 70)",
  "oklch(60% 0.19 15)",
];

type Piece = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  angle: number;
  spin: number;
  // Ratio d'aplatissement : un confetti qui tourne se voit de profil.
  flip: number;
  flipSpeed: number;
};

function createPieces(width: number, height: number): Piece[] {
  return Array.from({ length: COUNT }, () => ({
    // Départ réparti sur toute la largeur, un peu au-dessus du cadre.
    x: Math.random() * width,
    y: -Math.random() * height * 0.3,
    vx: (Math.random() - 0.5) * 0.28,
    vy: Math.random() * 0.18 + 0.08,
    size: Math.random() * 7 + 5,
    color: COLORS[Math.floor(Math.random() * COLORS.length)],
    angle: Math.random() * Math.PI,
    spin: (Math.random() - 0.5) * 0.006,
    flip: Math.random(),
    flipSpeed: Math.random() * 0.004 + 0.002,
  }));
}

export function Confetti() {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  React.useEffect(() => {
    // Réglage d'accessibilité : on ne joue rien plutôt que de jouer vite.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;

    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    context.scale(ratio, ratio);

    const pieces = createPieces(width, height);
    let frame = 0;
    let start: number | null = null;

    function draw(timestamp: number) {
      if (start === null) start = timestamp;
      const elapsed = timestamp - start;
      // `context` et `canvas` sont capturés non nuls par la garde ci-dessus.
      const ctx = context as CanvasRenderingContext2D;

      if (elapsed > DURATION) {
        ctx.clearRect(0, 0, width, height);
        return;
      }

      // Les confettis s'effacent sur le dernier tiers, plutôt que de
      // disparaître d'un coup.
      const fade = elapsed > DURATION * 0.66 ? 1 - (elapsed - DURATION * 0.66) / (DURATION * 0.34) : 1;

      ctx.clearRect(0, 0, width, height);
      ctx.globalAlpha = Math.max(0, fade);

      for (const piece of pieces) {
        piece.vy += GRAVITY * 16;
        piece.vx *= DRAG;
        piece.x += piece.vx * 16;
        piece.y += piece.vy * 16;
        piece.angle += piece.spin * 16;
        piece.flip += piece.flipSpeed * 16;

        ctx.save();
        ctx.translate(piece.x, piece.y);
        ctx.rotate(piece.angle);
        ctx.fillStyle = piece.color;
        // Le facteur d'échelle vertical simule la rotation dans l'espace.
        ctx.fillRect(
          -piece.size / 2,
          -piece.size / 2,
          piece.size,
          piece.size * Math.abs(Math.cos(piece.flip)),
        );
        ctx.restore();
      }

      ctx.globalAlpha = 1;
      frame = requestAnimationFrame(draw);
    }

    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      data-testid="confetti"
      // `fixed` et non `absolute` : les confettis tombent sur toute la page,
      // pas seulement dans la carte de résumé. En dessous de l'en-tête collant
      // (z-40) et des modales (z-50), pour ne pas rivaliser avec eux.
      className="pointer-events-none fixed inset-0 z-30 h-full w-full"
    />
  );
}
