/**
 * Souplesse du tracé : ce qui se passe **entre** le stylet et le contour.
 *
 * `perfect-freehand` dessine bien un contour, mais il le dessine autour des
 * points qu'on lui donne — et ces points-là sortent d'un capteur. Entre la
 * pointe et l'écran il manquait donc trois choses, et ce sont elles qui font
 * la différence entre « ça écrit » et « ça glisse » :
 *
 * 1. **Le tremblement.** Un stylet rapporte sa position à deux cents hertz,
 *    avec un bruit de l'ordre du dixième de millimètre. Écrit lentement, un
 *    trait droit en sort ondulé. Le `streamline` de la bibliothèque est un
 *    lissage exponentiel à coefficient **fixe** : réglé assez fort pour tuer
 *    ce tremblement, il fait traîner la pointe dans les gestes rapides ; réglé
 *    assez faible pour suivre la main, il laisse l'ondulation. Un réglage fixe
 *    ne peut pas répondre aux deux, parce que ce ne sont pas les mêmes gestes.
 * 2. **Le retard.** Tout lissage retarde. On le rend à l'écran en dessinant
 *    **en avance**, sur la trajectoire prédite par le navigateur, et on le
 *    rend au papier en ramenant le trait sur le dernier point réel au lever
 *    de la pointe.
 * 3. **Les trous.** Une souris échantillonne à soixante hertz : un geste
 *    rapide ne laisse qu'une poignée de points, et le trait sort en ligne
 *    brisée. On les comble par une courbe, pas par une corde.
 *
 * ## Le filtre 1 €
 *
 * La réponse au premier point est le *1€ filter* de Casiez, Roussel et Vogel
 * (CHI 2012) : un passe-bas dont la **fréquence de coupure monte avec la
 * vitesse**. L'idée tient en une phrase — on voit le tremblement quand on va
 * lentement, et le retard quand on va vite, jamais les deux à la fois. Lent,
 * il lisse fort ; rapide, il laisse passer. C'est le filtre qu'emploient les
 * applications de prise de notes, et il coûte deux multiplications par point.
 *
 *     α  = r / (r + 1)   avec r = 2π · f_c · Δt
 *     f_c = f_min + β · |vitesse lissée|
 *
 * Tout se calcule dans le repère de mille unités (`INK_REF`) : les réglages
 * ci-dessous n'ont de sens que là, et une page vaut mille unités de large
 * quelle que soit la taille de l'écran.
 */

import { INK_REF } from "@/lib/ink";

/**
 * Réglages du lissage, tous dans le repère de mille unités.
 *
 * Ils sont exportés pour être **mesurés** : `verify/ecriture-e2e.mjs` compare
 * le tremblement injecté à celui qui reste sur la page, et une valeur changée
 * ici se lit dans le résultat.
 */
export const LISSAGE = {
  /**
   * Coupure au repos, en hertz.
   *
   * Elle seule décide du lissage d'une main lente : c'est le tremblement
   * perpendiculaire au trait qu'elle efface, et ce tremblement-là n'a pas de
   * vitesse propre. Mesuré, un bruit de capteur d'un demi-millième de page est
   * divisé par six.
   */
  minCutoff: 1.6,
  /**
   * Montée de la coupure avec la vitesse, en hertz par unité par seconde.
   *
   * C'est **le** réglage à ne pas manquer, et il se lit comme un retard : la
   * pointe peinte traîne sur la pointe réelle d'au plus 1 / (2π · β) unités,
   * quelle que soit la vitesse. Or ce retard est aussi le rayon dont le filtre
   * arrondit un angle — un « v », un « M », la jambe d'un « p ».
   *
   * Une minuscule fait vingt-cinq unités de haut sur une page A4. À β = 0,012,
   * le retard plafonne à treize unités : la moitié d'une lettre, et l'écriture
   * sort en bouillie molle. À β = 0,07 il plafonne à deux unités et demie, soit
   * un demi-millimètre — la largeur d'une plume. Mesuré sur un angle droit
   * parcouru à la vitesse d'une écriture ordinaire : 0,5 unité manquée au
   * sommet contre 1,4 auparavant, et 3 contre 9,8 dans un geste rapide.
   */
  beta: 0.07,
  /**
   * Coupure du filtre appliqué à la vitesse elle-même, en hertz.
   *
   * Trop basse, la vitesse met un dixième de seconde à monter et le début de
   * chaque trait est lissé comme s'il était lent — c'est-à-dire beaucoup trop.
   * Trop haute, c'est le bruit du capteur qui passe dans la vitesse, fait
   * monter la coupure, et le filtre cesse de filtrer précisément quand il le
   * devrait.
   */
  dCutoff: 4,
  /**
   * Coupure de la pression, en hertz.
   *
   * Le capteur de pression est bien plus bruité que la position, et ce bruit
   * se voit : c'est la largeur du trait qui grésille. Six hertz laissent
   * passer la consigne de la main — qui change en un dixième de seconde au
   * plus vite — et coupent le reste.
   *
   * On ne descend pas plus bas : `hasRealPressure` reconnaît un vrai stylet au
   * fait que sa pression **varie**, et une pression trop lissée finirait par
   * se faire prendre pour une valeur inventée. Le trait repasserait alors sur
   * une largeur déduite de la vitesse, c'est-à-dire sur le défaut qu'on a mis
   * le plus longtemps à trouver.
   */
  pressureCutoff: 6,
  /**
   * Intervalle entre deux points, borné, en secondes.
   *
   * Un filtre en temps réel divise par le temps écoulé. Deux points peuvent
   * porter le même horodatage — c'est le cas des événements fusionnés sur
   * certains navigateurs, et celui de tout événement fabriqué par un script —
   * et la division rendrait alors l'infini. Le plancher vaut la moitié de la
   * période d'un stylet à quatre cent quatre-vingts hertz : il ne mord jamais
   * sur un vrai geste.
   */
  dtMin: 0.002,
  dtMax: 0.064,
  /**
   * Distance minimale entre deux points retenus, en unités de la page.
   *
   * Le filtre voit **tous** les points — c'est de là qu'il tire sa précision —
   * mais on n'en garde pas deux à moins d'un demi-millième de page l'un de
   * l'autre : à deux cents hertz, une main lente en poserait des centaines au
   * même endroit, qui ne pèsent qu'en mémoire et en octets enregistrés.
   */
  minDist: 0.45,
  /**
   * Avance maximale accordée à la prédiction, en unités de la page.
   *
   * Le navigateur extrapole la trajectoire ; il se trompe d'autant plus que le
   * geste change de direction. Borner l'avance limite le fouet qu'on verrait
   * sinon au bout d'un trait qui s'arrête net — l'erreur reste inférieure à
   * l'épaisseur d'un trait.
   */
  predictionMax: 14,
  /**
   * Pas d'échantillonnage sous lequel on ne comble rien, en unités de la page.
   *
   * Un stylet livre des points bien plus serrés que cela : le remplissage ne
   * coûte alors qu'une comparaison par point, et ne s'active que pour une
   * souris ou un geste très rapide.
   */
  ecart: 3,
} as const;

/** Lissage exponentiel d'une grandeur, à coefficient donné. */
class PasseBas {
  private y: number | null = null;

  filtrer(x: number, alpha: number): number {
    this.y = this.y === null ? x : alpha * x + (1 - alpha) * this.y;
    return this.y;
  }

  get valeur(): number | null {
    return this.y;
  }
}

/** α, d'après la fréquence de coupure et l'intervalle entre deux points. */
export function alphaOf(cutoff: number, dt: number): number {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
}

/**
 * Filtre 1 € sur une grandeur scalaire.
 *
 * `beta` à zéro en fait un passe-bas ordinaire à coupure fixe — c'est ainsi
 * qu'on s'en sert pour la pression, dont la vitesse ne veut rien dire.
 */
export class UnEuro {
  private valeur = new PasseBas();
  private vitesse = new PasseBas();

  private readonly minCutoff: number;
  private readonly beta: number;
  private readonly dCutoff: number;

  constructor(minCutoff: number, beta: number, dCutoff: number) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
  }

  filtrer(x: number, dt: number): number {
    const precedente = this.valeur.valeur;
    // La dérivée se prend sur la valeur **lissée** précédente, et non sur la
    // valeur brute : sinon le bruit de position se retrouve dans la vitesse,
    // la coupure s'envole, et le filtre cesse de filtrer précisément là où il
    // faudrait — c'est la formulation de l'article, et elle compte.
    const derivee = precedente === null ? 0 : (x - precedente) / dt;
    const vitesse = this.vitesse.filtrer(derivee, alphaOf(this.dCutoff, dt));
    const cutoff = this.minCutoff + this.beta * Math.abs(vitesse);
    return this.valeur.filtrer(x, alphaOf(cutoff, dt));
  }

  /** Vitesse lissée, en unités par seconde. Sert à juger de la prédiction. */
  get allure(): number {
    return Math.abs(this.vitesse.valeur ?? 0);
  }
}

/** Un point du tracé, en proportion de la largeur de page. */
export type PointStylet = { x: number; y: number; pression: number; temps: number };

/** Trois décimales pour la page, deux pour la pression. Cf. `arrondir`. */
function arrondir(valeur: number, decimales: number): number {
  const f = 10 ** decimales;
  return Math.round(valeur * f) / f;
}

/**
 * Le lisseur d'un trait, du poser de la pointe à son lever.
 *
 * Il tient l'état du filtre, et rend les points **à enregistrer** : ceux-là
 * sont les mêmes à l'écran, à la relecture et à l'export. La prédiction, elle,
 * ne passe pas par ici — elle ne sert qu'à peindre, et ne doit rien laisser.
 */
export class LisseurDeTrait {
  private readonly fx = new UnEuro(LISSAGE.minCutoff, LISSAGE.beta, LISSAGE.dCutoff);
  private readonly fy = new UnEuro(LISSAGE.minCutoff, LISSAGE.beta, LISSAGE.dCutoff);
  private readonly fp = new UnEuro(LISSAGE.pressureCutoff, 0, LISSAGE.dCutoff);
  /** Dernier horodatage vu, pour l'intervalle. */
  private temps: number | null = null;
  /** Dernier point **retenu**, en unités de mille. */
  private dernier: { x: number; y: number } | null = null;
  /** Dernier point **brut**, pour ramener le trait où la pointe s'est levée. */
  private brut: { x: number; y: number; pression: number } | null = null;

  /**
   * Poser la pointe.
   *
   * Le premier point n'est pas filtré : un trait doit commencer exactement là
   * où on l'a posé. Filtrer ici ferait démarrer chaque lettre à côté.
   */
  poser(point: PointStylet): number[] {
    this.temps = point.temps;
    const x = point.x * INK_REF;
    const y = point.y * INK_REF;
    this.fx.filtrer(x, LISSAGE.dtMin);
    this.fy.filtrer(y, LISSAGE.dtMin);
    this.fp.filtrer(point.pression, LISSAGE.dtMin);
    this.dernier = { x, y };
    this.brut = { x, y, pression: point.pression };
    return sortie(x, y, point.pression);
  }

  /**
   * Un point de plus.
   *
   * Rend le point à ajouter au trait, ou `null` quand il tombe trop près du
   * précédent — le filtre l'a tout de même vu, et en tient compte.
   */
  suivre(point: PointStylet): number[] | null {
    const dt = Math.min(
      LISSAGE.dtMax,
      Math.max(LISSAGE.dtMin, (point.temps - (this.temps ?? point.temps)) / 1000),
    );
    this.temps = point.temps;

    const x = this.fx.filtrer(point.x * INK_REF, dt);
    const y = this.fy.filtrer(point.y * INK_REF, dt);
    const pression = this.fp.filtrer(point.pression, dt);
    this.brut = { x: point.x * INK_REF, y: point.y * INK_REF, pression };

    const avant = this.dernier;
    if (avant && Math.hypot(x - avant.x, y - avant.y) < LISSAGE.minDist) return null;
    this.dernier = { x, y };
    return sortie(x, y, pression);
  }

  /**
   * Lever la pointe : ramener le trait là où elle s'est réellement arrêtée.
   *
   * Le filtre traîne, par construction — c'est le prix du lissage, et on le
   * paie pendant le geste, pas après. Sauter d'un coup sur le point réel
   * laisserait un segment droit visible au bout de chaque lettre : on y va en
   * trois pas, ce qui suffit à ce que le contour s'y courbe.
   */
  finir(): number[] {
    const fin = this.brut;
    const avant = this.dernier;
    if (!fin) return [];
    if (!avant) return sortie(fin.x, fin.y, fin.pression);

    const retard = Math.hypot(fin.x - avant.x, fin.y - avant.y);
    if (retard < LISSAGE.minDist) return [];

    const points: number[] = [];
    for (const t of [0.45, 0.78, 1]) {
      points.push(
        ...sortie(
          avant.x + (fin.x - avant.x) * t,
          avant.y + (fin.y - avant.y) * t,
          fin.pression,
        ),
      );
    }
    this.dernier = { x: fin.x, y: fin.y };
    return points;
  }

  /**
   * De combien la pointe peinte est-elle en retard sur la pointe réelle ?
   *
   * En unités de mille. C'est ce retard que la prédiction vient combler.
   */
  get retard(): number {
    if (!this.brut || !this.dernier) return 0;
    return Math.hypot(this.brut.x - this.dernier.x, this.brut.y - this.dernier.y);
  }
}

/**
 * Un point du trait enregistré : position en proportion de page, pression.
 *
 * Quatre décimales, et non trois comme autrefois. Trois valaient « le pixel
 * près sur un écran large » — c'était vrai à l'échelle 1, et faux dès qu'on
 * zoome : la page fait alors six fois sa largeur, et le millième de page
 * devient un escalier de plusieurs pixels sur l'écran d'un iPad. Le coût est
 * d'un caractère par coordonnée.
 */
function sortie(x: number, y: number, pression: number): number[] {
  return [arrondir(x / INK_REF, 4), arrondir(y / INK_REF, 4), arrondir(pression, 2)];
}

/**
 * Comble les trous d'un tracé par une courbe, juste avant d'en faire un contour.
 *
 * Catmull-Rom **centripète** : la courbe passe par les points donnés, et la
 * paramétrisation en racine de la distance lui interdit les boucles et les
 * dépassements que la version uniforme produit dès que deux points sont
 * proches et le troisième loin — exactement ce qu'on trouve dans un geste de
 * souris. C'est le choix standard pour interpoler une trajectoire échantillonnée
 * (Yuksel, Schaefer & Keyser, 2011).
 *
 * Ne fait **rien** quand les points sont déjà serrés, ce qui est le cas de tout
 * ce qui vient d'un stylet : le surcoût se réduit alors à une comparaison par
 * point. `points` est en unités quelconques, `ecart` dans les mêmes.
 */
export function inkSpine(points: number[][], ecart: number): number[][] {
  if (points.length < 2) return points;

  let besoin = false;
  for (let i = 1; i < points.length; i++) {
    if (distance(points[i - 1], points[i]) > ecart) {
      besoin = true;
      break;
    }
  }
  if (!besoin) return points;

  const sortie: number[][] = [points[0]];
  for (let i = 0; i + 1 < points.length; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const d = distance(p1, p2);
    const n = Math.min(24, Math.ceil(d / ecart));
    if (n > 1) {
      const p0 = points[i - 1] ?? p1;
      const p3 = points[i + 2] ?? p2;
      for (let k = 1; k < n; k++) {
        sortie.push(catmullRom(p0, p1, p2, p3, k / n));
      }
    }
    sortie.push(p2);
  }
  return sortie;
}

function distance(a: number[], b: number[]): number {
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/**
 * Un point de la courbe de Catmull-Rom centripète entre `p1` et `p2`.
 *
 * Les nœuds sont espacés de la racine de la distance — c'est ce qui la rend
 * centripète — et la courbe est évaluée par interpolations de Neville, ce qui
 * évite d'avoir à écrire la base d'Hermite à la main. La pression suit la même
 * interpolation que la position, linéairement : elle n'a pas besoin de mieux.
 */
function catmullRom(p0: number[], p1: number[], p2: number[], p3: number[], t: number): number[] {
  // Le nœud avance toujours, même entre deux points confondus : un intervalle
  // nul mettrait une division par zéro au cœur de la courbe.
  const noeud = (ti: number, a: number[], b: number[]) =>
    ti + Math.max(1e-4, Math.sqrt(distance(a, b)));
  const t0 = 0;
  const t1 = noeud(t0, p0, p1);
  const t2 = noeud(t1, p1, p2);
  const t3 = noeud(t2, p2, p3);
  const tt = t1 + (t2 - t1) * t;

  const melange = (a: number[], b: number[], ta: number, tb: number, u: number): number[] => {
    const w = tb - ta || 1e-6;
    const k = (tb - u) / w;
    return [a[0] * k + b[0] * (1 - k), a[1] * k + b[1] * (1 - k)];
  };

  const a1 = melange(p0, p1, t0, t1, tt);
  const a2 = melange(p1, p2, t1, t2, tt);
  const a3 = melange(p2, p3, t2, t3, tt);
  const b1 = melange(a1, a2, t0, t2, tt);
  const b2 = melange(a2, a3, t1, t3, tt);
  const c = melange(b1, b2, t1, t2, tt);

  const pression = (p1[2] ?? 0.5) + ((p2[2] ?? 0.5) - (p1[2] ?? 0.5)) * t;
  return [c[0], c[1], pression];
}
