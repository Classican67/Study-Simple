/**
 * Le contour d'un trait — **le seul endroit** qui appelle `getStroke`.
 *
 * L'écran et le papier ont déjà divergé deux fois, et toujours de la même
 * façon : deux copies d'un calcul, dont on ne règle qu'une. Les réglages ont
 * été rassemblés dans `INSTRUMENTS` ; il restait deux appels à la
 * bibliothèque, chacun avec sa manière de composer les options, de combler les
 * trous et d'échelonner l'épaisseur. Ils n'en font plus qu'un.
 *
 * Ce qui change d'un rendu à l'autre, et rien d'autre :
 *
 *  - le **repère** des points. À l'écran, mille unités pour la largeur de la
 *    page ; dans le PDF, les points typographiques de la page. On passe donc
 *    les points déjà placés, et l'échelle qui traduit une unité de mille dans
 *    ce repère ;
 *  - c'est tout.
 *
 * Trois grandeurs dépendent de cette échelle et se trompaient facilement :
 * l'épaisseur, l'effilement des bouts d'une plume, et le grain d'un crayon.
 * Écrites en dur, elles sortaient presque deux fois trop courtes sur le papier,
 * dont la page ne fait que 595 points de large là où l'écran en compte mille.
 */

import { getStroke } from "perfect-freehand";

import {
  hasRealPressure,
  inkSeed,
  instrumentOf,
  roughenOutline,
  strokeWeight,
  type Tool,
} from "@/lib/ink";
import { inkSpine, LISSAGE } from "@/lib/ink-smooth";

/**
 * Contour fermé d'un trait, dans le repère où ses points sont donnés.
 *
 * `points` : `[x, y, pression]` déjà placés dans le repère voulu.
 * `flat` : les points **enregistrés**, qui servent à deux choses qu'aucun
 * repère ne doit changer — décider si la pression est réelle, et tirer la
 * graine du grain.
 * `echelle` : combien vaut, dans ce repère, une unité de la page de mille.
 */
export function inkOutline(
  points: number[][],
  flat: number[],
  tool: string | undefined,
  size: number,
  echelle = 1,
): number[][] {
  if (points.length === 0) return [];
  const instrument = instrumentOf(tool);
  const epaisseur = strokeWeight({ size, tool }, echelle);

  const contour = getStroke(inkSpine(points, LISSAGE.ecart * echelle), {
    size: epaisseur,
    thinning: instrument.thinning,
    smoothing: instrument.smoothing,
    streamline: instrument.streamline,
    // La pression du stylet est **mesurée**, pas devinée : sans cela la largeur
    // suit la vitesse de la main et le trait grésille. Cf. `hasRealPressure`.
    simulatePressure: !hasRealPressure(flat),
    // Les bouts. L'effilement est donné en multiples de l'épaisseur, donc il
    // suit l'échelle sans qu'on ait à y penser.
    start: { cap: instrument.cap, taper: epaisseur * instrument.taper },
    end: { cap: instrument.cap, taper: epaisseur * instrument.taper },
    // Un trait terminé : les extrémités sont fermées, sinon l'enveloppe reste
    // ouverte et le remplissage fuit.
    last: true,
  });

  return instrument.grain > 0
    ? roughenOutline(contour, epaisseur * instrument.grain, inkSeed(flat))
    : contour;
}

/** Les outils d'écriture, dans l'ordre où la barre les présente. */
export const INSTRUMENT_ORDER: readonly Tool[] = [
  "fountain",
  "pen",
  "pencil",
  "marker",
  "highlighter",
];
