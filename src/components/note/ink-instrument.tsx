"use client";

import * as React from "react";

import type { Tool } from "@/lib/ink";
import { inkCss } from "@/lib/ink-color";
import { cn } from "@/lib/utils";

/**
 * Les instruments, dessinés.
 *
 * Une icône de trait — un stylo stylisé, un surligneur stylisé — dit *quel*
 * outil c'est, et rien de plus. Un instrument dessiné dit aussi **avec quoi
 * on écrit** : la pointe porte l'encre choisie, le corps a l'épaisseur du
 * trait qu'il pose, et l'outil actif sort du rang. On lit la barre d'un coup
 * d'œil au lieu de la déchiffrer, ce qui compte quand elle est sous la paume
 * et qu'on n'a pas de survol pour lire une infobulle.
 *
 * Chaque instrument est un objet **vu de face, pointe en bas**, posé dans une
 * fente. C'est la convention d'Apple, et elle a une raison : l'outil actif se
 * montre en le faisant **monter**, un mouvement qu'on comprend sans légende.
 *
 * Le dessin tient en quelques polygones. Deux choses le rendent lisible à
 * vingt-huit pixels de large : la pointe est franchement plus large pour un
 * feutre que pour une plume, et chaque instrument a une silhouette propre —
 * l'épaule d'un crayon, le biseau d'un surligneur, la fente d'une plume.
 */

/**
 * Le bas du dessin s'arrête à quarante, pas à quarante-quatre.
 *
 * Les instruments sont posés dans une fente qui rogne le bas : c'est ce qui
 * les fait paraître enfoncés, et sortir quand on les choisit. Mais la **pointe
 * porte l'encre**, et une pointe rognée cache la seule chose qu'on cherche du
 * regard dans cette barre. Les quatre unités du bas sont donc de la marge.
 */

/**
 * Largeur du corps de chaque instrument.
 *
 * Ce n'est pas une décoration : c'est le rapport des épaisseurs qu'ils posent.
 * Un surligneur écrit quatre fois plus large qu'un stylo, et sa silhouette le
 * dit avant qu'on ait essayé.
 */
const CORPS: Record<Tool, number> = {
  fountain: 9,
  pen: 8,
  pencil: 10,
  marker: 13,
  highlighter: 17,
};

export function InstrumentDessine({
  tool,
  color,
  className,
}: {
  tool: Tool;
  color: string;
  className?: string;
}) {
  const encre = inkCss(color);
  const l = CORPS[tool];
  const x = 16 - l / 2;
  const d = x + l;

  return (
    <svg
      viewBox="0 0 32 44"
      aria-hidden
      focusable="false"
      className={cn("h-11 w-8", className)}
    >
      <g className="text-on-surface-variant">
        {tool === "fountain" ? (
          <>
            {/* Un corps étroit qui se pince vers le bec. */}
            <path d={`M${x} 3h${l}v18l-1.5 4h-${l - 3}L${x} 21z`} fill="currentColor" opacity="0.4" />
            <rect x={x + 1} y="23" width={l - 2} height="2.5" fill="currentColor" opacity="0.7" />
            {/* Le bec : long, pointu, fendu, avec son trou d'aération. C'est la
                fente qui fait reconnaître une plume d'un stylo. */}
            <path d={`M${x + 1.5} 26h${l - 3}L16 40z`} fill={encre} />
            <path d="M16 31v8.5" stroke="var(--color-surface-container)" strokeWidth="1.2" />
            <circle cx="16" cy="29.5" r="1.1" fill="var(--color-surface-container)" />
          </>
        ) : null}

        {tool === "pen" ? (
          <>
            <rect x={x} y="3" width={l} height="19" rx="1.5" fill="currentColor" opacity="0.4" />
            {/* La prise, puis un cône court et une bille : un stylo à bille pose
                un trait régulier, et sa pointe est minuscule. */}
            <path d={`M${x} 22h${l}l-1 5h-${l - 2}z`} fill="currentColor" opacity="0.7" />
            <path d={`M${x + 1.5} 27h${l - 3}L16 37z`} fill={encre} />
            <circle cx="16" cy="38.4" r="1.6" fill={encre} />
          </>
        ) : null}

        {tool === "pencil" ? (
          <>
            {/* Le fût hexagonal : deux arêtes qui courent sur toute sa hauteur. */}
            <rect x={x} y="3" width={l} height="22" fill="currentColor" opacity="0.4" />
            <path
              d={`M${x + l / 3} 3v22M${d - l / 3} 3v22`}
              stroke="currentColor"
              strokeWidth="0.9"
              opacity="0.55"
            />
            {/* Le bois taillé — plus clair que le fût — puis la mine, courte. */}
            <path d={`M${x} 25h${l}L16 40z`} fill="currentColor" opacity="0.22" />
            <path d={`M${x + 0.4} 25.4h${l - 0.8}L16 40z`} fill="none" stroke="currentColor" strokeWidth="0.7" opacity="0.5" />
            <path d="M16 40l-2.9-4.4h5.8z" fill={encre} />
          </>
        ) : null}

        {tool === "marker" ? (
          <>
            <rect x={x} y="3" width={l} height="19" rx="2" fill="currentColor" opacity="0.4" />
            {/* La bague, bien marquée : c'est elle qui donne au feutre sa
                silhouette trapue, et qui le sépare du crayon. */}
            <rect x={x - 1} y="22" width={l + 2} height="4" rx="1" fill="currentColor" opacity="0.75" />
            {/* Une pointe biseautée, franchement de travers. */}
            <path d={`M${x + 1} 26h${l - 2}v9l-${l - 2} 5z`} fill={encre} />
          </>
        ) : null}

        {tool === "highlighter" ? (
          <>
            {/* Le corps est translucide et **porte l'encre** : un surligneur se
                reconnaît à sa couleur autant qu'à sa largeur. */}
            <rect x={x} y="3" width={l} height="18" rx="2.5" fill={encre} opacity="0.4" />
            <rect x={x} y="3" width={l} height="18" rx="2.5" fill="none" stroke="currentColor" strokeWidth="0.8" opacity="0.35" />
            <rect x={x - 1} y="21" width={l + 2} height="3.5" rx="1" fill="currentColor" opacity="0.6" />
            <path d={`M${x} 24.5h${l}v8l-${l} 7z`} fill={encre} opacity="0.85" />
          </>
        ) : null}
      </g>
    </svg>
  );
}

/**
 * La gomme, dessinée comme les autres — elle est dans la même fente.
 *
 * Elle ne porte pas d'encre : une gomme n'a pas de couleur, et lui en donner
 * une laisserait croire qu'elle en pose.
 */
export function GommeDessinee({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 44"
      aria-hidden
      focusable="false"
      className={cn("h-11 w-8", className)}
    >
      <g className="text-on-surface-variant">
        {/* Le manchon, puis le bloc : une gomme d'écolier, bout en bas. */}
        <path d="M10 4h12v18H10z" fill="currentColor" opacity="0.3" />
        <rect x="9" y="22" width="14" height="3.5" rx="1" fill="currentColor" opacity="0.75" />
        <path d="M9.5 25.5h13v11a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3z" fill="currentColor" opacity="0.55" />
      </g>
    </svg>
  );
}

/** L'instrument courant, en petit : ce que montre la bulle une fois repliée. */
export function InstrumentBulle({ tool, color }: { tool: Tool | "eraser"; color: string }) {
  return tool === "eraser" ? (
    <GommeDessinee className="h-9 w-6" />
  ) : (
    <InstrumentDessine tool={tool} color={color} className="h-9 w-6" />
  );
}
