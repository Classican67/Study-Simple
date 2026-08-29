import { cn } from "@/lib/utils";

/**
 * Marque de l'application : une pile de cartes dont celle du dessus porte une
 * coche — les deux idées de l'app, réviser des cartes et acquérir.
 *
 * Le dessin est repris à l'identique par scripts/generate-icons.mjs pour les
 * icônes PNG de la PWA : modifier l'un implique de relancer l'autre.
 */
export function Logo({ className, id = "logo" }: { className?: string; id?: string }) {
  // Les identifiants de dégradé sont globaux au document : deux logos sur la
  // même page se voleraient leur dégradé sans ce préfixe.
  const gradientId = `${id}-gradient`;

  return (
    <svg
      viewBox="0 0 40 40"
      className={cn("shrink-0 rounded-[27.5%]", className)}
      role="img"
      aria-label="Fiches"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="oklch(64% 0.21 292)" />
          <stop offset="100%" stopColor="oklch(50% 0.22 268)" />
        </linearGradient>
      </defs>

      <rect width="40" height="40" rx="11" fill={`url(#${gradientId})`} />

      {/* Carte du dessous, inclinée : suggère la pile sans la dessiner en entier. */}
      <rect
        x="12"
        y="10"
        width="16"
        height="20"
        rx="3.5"
        fill="white"
        opacity="0.38"
        transform="rotate(-14 20 20)"
      />

      {/* Carte du dessus, avec la coche. */}
      <rect x="12" y="10" width="16" height="20" rx="3.5" fill="white" />
      <path
        d="M16.2 20.4l2.6 2.6 5.2-5.6"
        fill="none"
        stroke="oklch(52% 0.23 292)"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
