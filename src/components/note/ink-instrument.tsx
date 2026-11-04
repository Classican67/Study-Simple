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
 * ## Ce qui les rend lisibles à trente-deux pixels
 *
 * Trois choses, et la première est celle qui manquait :
 *
 * 1. **Le volume.** Un rectangle gris plat ne ressemble à rien. Chaque corps
 *    est un cylindre : un dégradé transversal sombre-clair-sombre, un reflet
 *    étroit à gauche, une arête sombre à droite. Le même dégradé sert à tous,
 *    ce qui les fait appartenir à la même trousse.
 * 2. **La silhouette.** Un bec fendu, l'épaule d'un crayon taillé, la virole
 *    d'un pinceau, le tube écrasé d'une aquarelle, le biseau d'un surligneur :
 *    on doit pouvoir les nommer de loin, sans lire les infobulles.
 * 3. **La couleur au bon endroit.** Elle est sur la pointe pour ce qui écrit
 *    fin, et sur le **corps** pour ce qui est coloré dans la vraie vie — un
 *    crayon de cire, un surligneur. C'est ce que fait Apple, et c'est ce qui
 *    permet de voir sa couleur sans avoir choisi l'outil.
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
  pen: 9,
  monoline: 8,
  pencil: 10,
  crayon: 12,
  brush: 10,
  watercolor: 13,
  marker: 13,
  highlighter: 17,
};

/**
 * Le bas du dessin s'arrête à quarante, pas à quarante-quatre.
 *
 * Les instruments sont posés dans une fente qui rogne le bas : c'est ce qui
 * les fait paraître enfoncés, et sortir quand on les choisit. Mais la **pointe
 * porte l'encre**, et une pointe rognée cache la seule chose qu'on cherche du
 * regard dans cette barre. Les quatre unités du bas sont de la marge.
 */
const BAS = 40;

/** Teintes d'un corps, du flanc sombre au flanc sombre en passant par le jour. */
const METAL = ["#6b7280", "#d7dbe2", "#f4f6f9", "#9aa2ae", "#585f6b"];
const BOIS = ["#a9743f", "#e6c79a", "#f6e6cd", "#c69558", "#8a5c2c"];
const SOMBRE = ["#2b2f36", "#5b626d", "#858d99", "#41474f", "#1f2329"];

/**
 * Le cylindre.
 *
 * Cinq arrêts plutôt que trois : un corps éclairé de face a une bande de
 * lumière étroite et deux flancs qui s'assombrissent inégalement. Avec trois,
 * le dégradé se lit comme un tube de dentifrice ; avec cinq, comme un stylo.
 */
function Cylindre({ id, teintes }: { id: string; teintes: string[] }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stopColor={teintes[0]} />
      <stop offset="22%" stopColor={teintes[1]} />
      <stop offset="42%" stopColor={teintes[2]} />
      <stop offset="72%" stopColor={teintes[3]} />
      <stop offset="100%" stopColor={teintes[4]} />
    </linearGradient>
  );
}

/** Le même cylindre, teinté d'une encre : pour les corps et les pointes. */
function teinter(encre: string): string[] {
  return [
    `color-mix(in srgb, ${encre} 72%, #000 28%)`,
    encre,
    `color-mix(in srgb, ${encre} 55%, #fff 45%)`,
    encre,
    `color-mix(in srgb, ${encre} 65%, #000 35%)`,
  ];
}

export function InstrumentDessine({
  tool,
  color,
  className,
}: {
  tool: Tool;
  color: string;
  className?: string;
}) {
  // Un identifiant par instance : dix instruments cohabitent dans la barre, et
  // deux dégradés qui partagent leur nom n'en font qu'un.
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  const encre = inkCss(color);
  const l = CORPS[tool];
  const x = 16 - l / 2;
  const d = x + l;

  const corps = `c${uid}`;
  const pointe = `p${uid}`;
  const teintesCorps =
    tool === "pencil" ? BOIS : tool === "monoline" || tool === "pen" ? SOMBRE : METAL;

  return (
    <svg viewBox="0 0 32 44" aria-hidden focusable="false" className={cn("h-11 w-8", className)}>
      <defs>
        <Cylindre id={corps} teintes={teintesCorps} />
        <Cylindre id={pointe} teintes={teinter(encre)} />
      </defs>

      {tool === "fountain" ? (
        <>
          {/* Un corps de métal qui se pince, une bague teintée, un bec fendu :
              la fente et le trou d'aération font reconnaître une plume. */}
          <path d={`M${x} 4h${l}v16l-1.6 4h-${l - 3.2}L${x} 20z`} fill={`url(#${corps})`} />
          <rect x={x - 0.6} y="24" width={l + 1.2} height="2.6" rx="0.8" fill={`url(#${pointe})`} />
          <path d={`M${x + 1.4} 26.6h${l - 2.8}L16 ${BAS}z`} fill={`url(#${pointe})`} />
          <path d={`M16 30v${BAS - 30.5}`} stroke="#fff" strokeOpacity="0.85" strokeWidth="1.1" />
          <circle cx="16" cy="29.2" r="1.1" fill="#fff" fillOpacity="0.85" />
        </>
      ) : null}

      {tool === "pen" ? (
        <>
          <rect x={x} y="4" width={l} height="17" rx="1.6" fill={`url(#${corps})`} />
          {/* La prise moletée, puis le cône et la bille. */}
          <path d={`M${x} 21h${l}l-1.2 5h-${l - 2.4}z`} fill={`url(#${corps})`} />
          <rect x={x + 0.8} y="22.2" width={l - 1.6} height="0.8" fill="#000" fillOpacity="0.18" />
          <path d={`M${x + 1.6} 26h${l - 3.2}L16 ${BAS - 2}z`} fill={`url(#${pointe})`} />
          <circle cx="16" cy={BAS - 1.4} r="1.5" fill={encre} />
        </>
      ) : null}

      {tool === "monoline" ? (
        <>
          {/* Un fût mince et sans relief, un bout rond : c'est un tire-ligne,
              et il pose exactement la même largeur du début à la fin. */}
          <rect x={x} y="4" width={l} height="21" rx="1" fill={`url(#${corps})`} />
          <rect x={x} y="25" width={l} height="2" fill="#fff" fillOpacity="0.3" />
          <rect x={x + 1.6} y="27" width={l - 3.2} height={BAS - 29} fill={`url(#${pointe})`} />
          <circle cx="16" cy={BAS - 2} r={(l - 3.2) / 2} fill={encre} />
        </>
      ) : null}

      {tool === "pencil" ? (
        <>
          {/* Le fût hexagonal, deux arêtes, le bois taillé plus clair, la mine. */}
          <rect x={x} y="4" width={l} height="20" fill={`url(#${corps})`} />
          <path
            d={`M${x + l / 3} 4v20M${d - l / 3} 4v20`}
            stroke="#000"
            strokeOpacity="0.14"
            strokeWidth="0.8"
          />
          <path d={`M${x} 24h${l}L16 ${BAS}z`} fill="#f2e2c8" />
          <path d={`M${x} 24h${l / 2}L16 ${BAS}z`} fill="#fff" fillOpacity="0.45" />
          <path d={`M16 ${BAS}l-2.9-4.6h5.8z`} fill={`url(#${pointe})`} />
        </>
      ) : null}

      {tool === "crayon" ? (
        <>
          {/* Le corps **porte l'encre** : un crayon de cire est de la couleur
              qu'il pose, et sa bande de papier le dit tout de suite. */}
          <path d={`M${x} 6h${l}v18l-${l / 2} 3-${l / 2}-3z`} fill={`url(#${pointe})`} />
          <rect x={x} y="11" width={l} height="7" fill="#fff" fillOpacity="0.82" />
          <rect x={x} y="11" width={l} height="0.9" fill="#000" fillOpacity="0.1" />
          <path d={`M${x + 1.6} 27h${l - 3.2}L16 ${BAS}z`} fill={`url(#${pointe})`} />
        </>
      ) : null}

      {tool === "brush" ? (
        <>
          {/* Manche clair, virole de **laiton**, touffe qui s'effile.
              La virole était en métal gris comme tout le reste : sur fond
              clair, elle disparaissait, et le pinceau passait pour un crayon
              de plus. Le laiton est ce qu'on voit sur un vrai pinceau, et
              c'est la seule tache chaude de la trousse. */}
          <rect x={x + 1.5} y="4" width={l - 3} height="14" rx="1.4" fill={`url(#${corps})`} />
          <rect x={x - 0.5} y="17.5" width={l + 1} height="5" rx="1.2" fill="#b98b3a" />
          <rect x={x - 0.5} y="18.2" width={l + 1} height="1" fill="#f0d79a" />
          <rect x={x - 0.5} y="21.2" width={l + 1} height="1" fill="#000" fillOpacity="0.2" />
          <path
            d={`M${x + 0.8} 22 C ${x + 0.8} 30, ${x + 2.5} 34, 16 ${BAS} C ${d - 2.5} 34, ${d - 0.8} 30, ${d - 0.8} 22 Z`}
            fill={`url(#${pointe})`}
          />
        </>
      ) : null}

      {tool === "watercolor" ? (
        <>
          {/* Un tube de peinture : corps blanc serti, bande de couleur, col et
              bouchon. C'est l'objet, pas un feutre de plus. */}
          <rect x={x} y="5" width={l} height="19" rx="1.5" fill="#eef1f5" />
          <rect x={x} y="5" width={l} height="19" rx="1.5" fill={`url(#${corps})`} fillOpacity="0.4" />
          <rect x={x} y="12" width={l} height="5" fill={`url(#${pointe})`} />
          <path d={`M${x} 5h${l}l-1.5 -1.8h-${l - 3}z`} fill="#c7ccd4" />
          <rect x={x + 3} y="24" width={l - 6} height="3.5" fill="#aeb5bf" />
          <path d={`M${x + 3.4} 27.5h${l - 6.8}L16 ${BAS}z`} fill={`url(#${pointe})`} />
        </>
      ) : null}

      {tool === "marker" ? (
        <>
          <rect x={x} y="4" width={l} height="17" rx="2" fill={`url(#${corps})`} />
          {/* La bague trapue, puis une pointe franchement biseautée. */}
          <rect x={x - 1} y="21" width={l + 2} height="4" rx="1.2" fill="#9aa2ae" />
          <rect x={x - 1} y="21.6" width={l + 2} height="0.9" fill="#fff" fillOpacity="0.6" />
          <path d={`M${x + 1} 25h${l - 2}v9l-${l - 2} ${BAS - 34}z`} fill={`url(#${pointe})`} />
        </>
      ) : null}

      {tool === "highlighter" ? (
        <>
          {/* Corps translucide **de la couleur de l'encre**, et le biseau large
              d'un surligneur. On voit sa teinte sans l'avoir choisi. */}
          {/* Le corps était à 38 % d'opacité : un surligneur jaune y ressortait
              beige, et le biseau se perdait dans le corps. À 62 %, avec une
              arête sombre et un biseau opaque, on lit la teinte du premier
              coup — ce qui est tout ce qu'on lui demande. */}
          <rect x={x} y="4" width={l} height="16" rx="2.5" fill={encre} fillOpacity="0.62" />
          <rect x={x + 1.2} y="5.2" width="2.6" height="13" rx="1.3" fill="#fff" fillOpacity="0.6" />
          <rect
            x={x}
            y="4"
            width={l}
            height="16"
            rx="2.5"
            fill="none"
            stroke="#000"
            strokeOpacity="0.2"
            strokeWidth="0.9"
          />
          <rect x={x - 0.8} y="20" width={l + 1.6} height="3.6" rx="1" fill="#9aa2ae" />
          <rect x={x - 0.8} y="20.5" width={l + 1.6} height="0.9" fill="#fff" fillOpacity="0.6" />
          <path d={`M${x} 23.6h${l}v8l-${l} ${BAS - 31.6}z`} fill={`url(#${pointe})`} />
        </>
      ) : null}
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
  const uid = React.useId().replace(/[^a-zA-Z0-9]/g, "");
  return (
    <svg viewBox="0 0 32 44" aria-hidden focusable="false" className={cn("h-11 w-8", className)}>
      <defs>
        <Cylindre id={`g${uid}`} teintes={["#c9a0a4", "#f0dcdd", "#fdf3f3", "#dbb9bc", "#a97f83"]} />
        <Cylindre id={`m${uid}`} teintes={METAL} />
      </defs>
      {/* Le manchon de métal, puis le bloc rose : une gomme de bout de crayon. */}
      <rect x="10" y="5" width="12" height="16" rx="1" fill={`url(#m${uid})`} />
      <path d="M10 21h12" stroke="#000" strokeOpacity="0.15" strokeWidth="0.8" />
      <path
        d={`M10 21h12v${BAS - 24}a3 3 0 0 1 -3 3h-6a3 3 0 0 1 -3 -3z`}
        fill={`url(#g${uid})`}
      />
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
