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
  biseauFacteurs,
  bruitHache,
  hasRealPressure,
  pressionPercue,
  inkSeed,
  instrumentOf,
  roughenOutline,
  strokeWeight,
  type Tool,
} from "@/lib/ink";
import { inkSpine, LISSAGE } from "@/lib/ink-smooth";

/**
 * Les contours d'un trait, dans le repère où ses points sont donnés.
 *
 * **Plusieurs** contours, et non un seul : un crayon est fait de trois passes
 * et un crayon de cire de quatre. Chacune se peint séparément, à l'opacité que
 * rend `alphaParPasse` — c'est le recouvrement inégal des passes qui fait la
 * matière, et un seul remplissage ne recouvre rien.
 *
 * `points` : `[x, y, pression]` déjà placés dans le repère voulu.
 * `flat` : les points **enregistrés**, qui servent à deux choses qu'aucun
 * repère ne doit changer — décider si la pression est réelle, et tirer la
 * graine du grain.
 * `echelle` : combien vaut, dans ce repère, une unité de la page de mille.
 */
export function inkOutlines(
  points: number[][],
  flat: number[],
  tool: string | undefined,
  size: number,
  echelle = 1,
): number[][][] {
  if (points.length === 0) return [];
  const instrument = instrumentOf(tool);
  const epaisseur = strokeWeight({ size, tool }, echelle);
  const graine = inkSeed(flat);

  // Les trous sont comblés **une fois**, avant les passes : deux mèches
  // calculées sur des échantillonnages différents ne se suivraient pas.
  const dense = inkSpine(points, LISSAGE.ecart * echelle);

  /*
   * La tranche du feutre et du surligneur.
   *
   * On la rend en **remplaçant** la pression par le facteur de la tranche, et
   * en réglant `thinning` à un : la largeur vaut alors exactement
   * `size × pression`. Le demi qui traîne est là pour que la largeur maximale
   * reste celle qu'avait l'instrument avant d'avoir une tranche — sans lui,
   * elle doublerait.
   */
  const biseaute = instrument.biseau > 0;
  const facteurs = biseaute
    ? biseauFacteurs(dense, instrument.biseau, instrument.biseauAngle)
    : null;
  // La pression mesurée passe par la courbe de réponse (`pressionPercue`) ;
  // devinée, elle reste celle que la bibliothèque déduit de la vitesse.
  const mesuree = !biseaute && hasRealPressure(flat);
  const base = facteurs
    ? dense.map((p, i) => [p[0], p[1], facteurs[i] / 2])
    : mesuree
      ? dense.map((p) => [p[0], p[1], pressionPercue(p[2])])
      : dense;

  const commun = {
    size: epaisseur,
    thinning: biseaute ? 1 : instrument.thinning,
    smoothing: instrument.smoothing,
    streamline: instrument.streamline,
    // La pression du stylet est **mesurée**, pas devinée : sans cela la largeur
    // suit la vitesse de la main et le trait grésille. Cf. `hasRealPressure`.
    // Une tranche, elle, ne laisse pas la place à la pression : c'est elle qui
    // décide de la largeur.
    simulatePressure: biseaute ? false : !mesuree,
    // Les bouts. L'effilement est donné en multiples de l'épaisseur, donc il
    // suit l'échelle sans qu'on ait à y penser.
    start: { cap: instrument.cap, taper: epaisseur * instrument.taper },
    end: { cap: instrument.cap, taper: epaisseur * instrument.taper },
    // Un trait terminé : les extrémités sont fermées, sinon l'enveloppe reste
    // ouverte et le remplissage fuit.
    last: true,
  };

  const grain = epaisseur * instrument.grain;
  const passes = Math.max(1, instrument.meches);
  if (passes === 1) {
    const contour = getStroke(base, commun);
    return [grain > 0 ? roughenOutline(contour, grain, graine) : contour];
  }

  /*
   * Les mèches.
   *
   * Chacune est le même tracé, décalé **en travers** de quelques dixièmes
   * d'épaisseur et affiné. Le décalage est fixe par mèche — elles restent
   * parallèles, comme les traînées d'une mine —, l'affinement varie d'une
   * mèche à l'autre pour qu'aucune ne domine, et le grain reçoit une graine
   * différente pour chacune, sans quoi les quatre bords s'écailleraient au
   * même endroit et l'on verrait quatre copies au lieu d'une matière.
   */
  const sortie: number[][][] = [];
  for (let k = 0; k < passes; k++) {
    const t = passes === 1 ? 0 : k / (passes - 1) - 0.5;
    const decal = t * epaisseur * 0.5;
    const finesse = 0.62 + 0.2 * Math.abs(bruitHache(k * 7 + 1, graine));
    const meche = base.map((p, i) => {
      const a = base[Math.max(0, i - 1)];
      const b = base[Math.min(base.length - 1, i + 1)];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const l = Math.hypot(dx, dy) || 1;
      // Un léger flottement le long de la mèche : une traînée de graphite
      // n'est pas parallèle au dixième de millimètre près.
      const flottement = bruitHache(i * 3 + k * 101, graine) * epaisseur * 0.08;
      return [
        p[0] + (-dy / l) * (decal + flottement),
        p[1] + (dx / l) * (decal + flottement),
        p[2],
      ];
    });
    const contour = getStroke(meche, { ...commun, size: epaisseur * finesse });
    sortie.push(grain > 0 ? roughenOutline(contour, grain, graine + k * 9973) : contour);
  }
  return sortie;
}

/** Le contour principal, pour ce qui n'a besoin que d'une enveloppe. */
export function inkOutline(
  points: number[][],
  flat: number[],
  tool: string | undefined,
  size: number,
  echelle = 1,
): number[][] {
  return inkOutlines(points, flat, tool, size, echelle)[0] ?? [];
}

/** Les outils d'écriture, dans l'ordre où la barre les présente. */
export const INSTRUMENT_ORDER: readonly Tool[] = [
  "fountain",
  "pen",
  "monoline",
  "pencil",
  "crayon",
  "brush",
  "watercolor",
  "marker",
  "highlighter",
];
