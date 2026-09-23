import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { INK_REF } from "@/lib/ink";
import {
  alphaOf,
  inkSpine,
  LISSAGE,
  LisseurDeTrait,
  UnEuro,
} from "@/lib/ink-smooth";

/**
 * Un stylet de laboratoire.
 *
 * Il rapporte une trajectoire connue, plus un bruit **déterministe** : c'est
 * lui qu'on cherche à voir disparaître, et un tirage qui change à chaque
 * exécution rendrait les échecs incomparables.
 */
function stylet(graine = 20260923) {
  let etat = graine;
  return () => {
    etat = (etat * 1103515245 + 12345) % 2147483648;
    return etat / 2147483648 - 0.5;
  };
}

/** Écart quadratique moyen d'une suite de points à la droite y = y0. */
function ondulation(points: number[], y0: number): number {
  const ys: number[] = [];
  for (let i = 1; i < points.length; i += 3) ys.push(points[i]);
  const carres = ys.reduce((s, y) => s + (y - y0) ** 2, 0);
  return Math.sqrt(carres / (ys.length || 1)) * INK_REF;
}

describe("alphaOf", () => {
  it("lisse d'autant plus que la coupure est basse", () => {
    assert.ok(alphaOf(1, 0.008) < alphaOf(30, 0.008));
  });

  it("reste entre zéro et un, quelles que soient les valeurs", () => {
    for (const cutoff of [0.1, 1, 60, 5000]) {
      for (const dt of [0.001, 0.008, 0.064]) {
        const a = alphaOf(cutoff, dt);
        assert.ok(a > 0 && a < 1, `α = ${a} pour ${cutoff} Hz et ${dt} s`);
      }
    }
  });
});

describe("UnEuro", () => {
  it("efface le bruit d'un signal immobile", () => {
    const bruit = stylet();
    const filtre = new UnEuro(LISSAGE.minCutoff, LISSAGE.beta, LISSAGE.dCutoff);
    let entree = 0;
    let sortie = 0;
    for (let i = 0; i < 200; i++) {
      const x = 500 + bruit() * 2;
      const y = filtre.filtrer(x, 1 / 120);
      if (i > 50) {
        entree += (x - 500) ** 2;
        sortie += (y - 500) ** 2;
      }
    }
    // Le bruit résiduel doit être au moins cinq fois plus faible. Sans filtre,
    // le rapport vaut un.
    assert.ok(sortie * 5 < entree, `${Math.sqrt(sortie)} contre ${Math.sqrt(entree)}`);
  });

  it("mais suit un geste rapide sans traîner", () => {
    const filtre = new UnEuro(LISSAGE.minCutoff, LISSAGE.beta, LISSAGE.dCutoff);
    // Deux mille unités par seconde : une écriture ordinaire.
    let x = 0;
    let y = 0;
    for (let i = 0; i < 120; i++) {
      x += 2000 / 120;
      y = filtre.filtrer(x, 1 / 120);
    }
    // Le retard doit rester sous deux pour cent de la course, c'est-à-dire
    // sous l'épaisseur d'un trait. Une coupure fixe assez basse pour tuer le
    // bruit ci-dessus en laisserait dix fois plus.
    assert.ok(Math.abs(x - y) < x * 0.02, `retard de ${(x - y).toFixed(1)} sur ${x}`);
  });

  it("β à zéro en fait un passe-bas ordinaire, sans mémoire de la vitesse", () => {
    const fixe = new UnEuro(6, 0, 1.4);
    let v = 0;
    for (let i = 0; i < 400; i++) v = fixe.filtrer(1, 1 / 120);
    assert.ok(Math.abs(v - 1) < 0.01, String(v));
  });
});

describe("LisseurDeTrait", () => {
  /** Une ligne droite parcourue à vitesse modérée, secouée par le capteur. */
  const droite = (secousse: number) => {
    const bruit = stylet();
    const lisseur = new LisseurDeTrait();
    const brut: number[] = [];
    const sortie: number[] = [];
    const pousser = (p: number[]) => sortie.push(...p);

    const point = (i: number) => ({
      x: 0.1 + (i / 200) * 0.8,
      y: 0.3 + (bruit() * secousse) / INK_REF,
      pression: 0.6,
      // Deux cents hertz, comme un Apple Pencil.
      temps: i * 5,
    });

    const p0 = point(0);
    brut.push(p0.x, p0.y, p0.pression);
    pousser(lisseur.poser(p0));
    for (let i = 1; i <= 200; i++) {
      const p = point(i);
      brut.push(p.x, p.y, p.pression);
      const lisse = lisseur.suivre(p);
      if (lisse) pousser(lisse);
    }
    pousser(lisseur.finir());
    return { brut, sortie, lisseur };
  };

  it("rend une droite d'un tracé qui tremble", () => {
    const { brut, sortie } = droite(3);
    const avant = ondulation(brut, 0.3);
    const apres = ondulation(sortie, 0.3);
    // Un tremblement de trois unités sur une page de mille, c'est ce qu'on
    // mesure sur un stylet écrivant lentement : il doit être divisé par trois
    // au moins. Sans filtre, le rapport vaut exactement un.
    assert.ok(apres * 3 < avant, `${apres.toFixed(2)} contre ${avant.toFixed(2)}`);
  });

  it("commence exactement là où la pointe s'est posée", () => {
    const { brut, sortie } = droite(3);
    assert.equal(sortie[0], Math.round(brut[0] * 10000) / 10000);
    assert.equal(sortie[1], Math.round(brut[1] * 10000) / 10000);
  });

  it("et finit là où elle s'est levée, malgré le retard du filtre", () => {
    const { brut, sortie } = droite(3);
    const dx = Math.abs(sortie.at(-3)! - brut.at(-3)!) * INK_REF;
    const dy = Math.abs(sortie.at(-2)! - brut.at(-2)!) * INK_REF;
    // Le trait doit s'arrêter où la main s'est arrêtée, à l'arrondi près. Sans
    // le rattrapage, il s'arrêtait plusieurs unités avant — soit, sur une
    // lettre, une jambe visiblement trop courte.
    assert.ok(dx < 0.2 && dy < 0.2, `écart de ${dx.toFixed(2)} × ${dy.toFixed(2)}`);
  });

  it("garde tous les points utiles et jette les doublons", () => {
    const lisseur = new LisseurDeTrait();
    let n = 1;
    lisseur.poser({ x: 0.5, y: 0.5, pression: 0.6, temps: 0 });
    // Deux cents points au même endroit : une main immobile, pointe posée.
    for (let i = 1; i <= 200; i++) {
      if (lisseur.suivre({ x: 0.5, y: 0.5, pression: 0.6, temps: i * 5 })) n++;
    }
    assert.equal(n, 1, `${n} points pour une pointe qui n'a pas bougé`);
  });

  it("supporte des horodatages identiques sans partir à l'infini", () => {
    // Les événements fusionnés partagent parfois leur date, et tout événement
    // fabriqué par un script la partage toujours. Une division par zéro y
    // rendrait un NaN, et le trait disparaîtrait sans rien dire.
    const lisseur = new LisseurDeTrait();
    lisseur.poser({ x: 0.1, y: 0.2, pression: 0.6, temps: 42 });
    const points: number[] = [];
    for (let i = 1; i <= 50; i++) {
      const p = lisseur.suivre({ x: 0.1 + i * 0.01, y: 0.2, pression: 0.6, temps: 42 });
      if (p) points.push(...p);
    }
    points.push(...lisseur.finir());
    assert.ok(points.length >= 6);
    assert.ok(
      points.every((v) => Number.isFinite(v)),
      JSON.stringify(points.slice(0, 9)),
    );
    assert.ok(Math.abs(points.at(-3)! - 0.6) < 0.001, String(points.at(-3)));
  });

  it("laisse passer la pression de la main sans l'aplatir", () => {
    // La pression est lissée, mais `hasRealPressure` reconnaît un vrai stylet
    // au fait qu'elle **varie** : trop lissée, elle passerait pour une valeur
    // inventée et la largeur du trait repartirait sur la vitesse du geste.
    const lisseur = new LisseurDeTrait();
    lisseur.poser({ x: 0.1, y: 0.2, pression: 0.35, temps: 0 });
    const pressions: number[] = [];
    for (let i = 1; i <= 120; i++) {
      const p = lisseur.suivre({
        x: 0.1 + i * 0.005,
        y: 0.2,
        pression: 0.35 + 0.35 * Math.sin(i / 20),
        temps: i * 5,
      });
      if (p) pressions.push(p[2]);
    }
    const etendue = Math.max(...pressions) - Math.min(...pressions);
    assert.ok(etendue > 0.2, `la pression ne varie plus que de ${etendue.toFixed(3)}`);
  });
});

describe("inkSpine", () => {
  const serre = Array.from({ length: 40 }, (_, i) => [i * 1.5, 100 + i * 0.3, 0.5]);

  it("ne touche à rien quand les points sont déjà serrés", () => {
    const sortie = inkSpine(serre, LISSAGE.ecart);
    assert.equal(sortie, serre);
  });

  it("comble un trou par une courbe, pas par une corde", () => {
    // Un quart de cercle en cinq points : ce que laisse une souris dans un
    // geste rapide. La corde passerait loin à l'intérieur de l'arc.
    const arc = Array.from({ length: 5 }, (_, i) => {
      const a = (i / 4) * (Math.PI / 2);
      return [500 + 200 * Math.cos(a), 500 + 200 * Math.sin(a), 0.5];
    });
    const dense = inkSpine(arc, 3);
    assert.ok(dense.length > arc.length * 5, `${dense.length} points`);

    const rayons = dense.map(([x, y]) => Math.hypot(x - 500, y - 500));
    const pire = Math.max(...rayons.map((r) => Math.abs(r - 200)));
    // Une interpolation droite s'écarterait de l'arc de plus de quinze unités
    // entre deux points ; la courbe reste à moins de deux.
    assert.ok(pire < 2, `écart de ${pire.toFixed(2)} unités au cercle`);
  });

  it("ne boucle pas entre deux points proches encadrés par deux points lointains", () => {
    /*
     * Le cas d'école de la Catmull-Rom **uniforme**, et la raison pour laquelle
     * celle-ci est centripète : entre deux points voisins, elle calcule ses
     * tangentes sur les points d'à côté, qui sont loin. La courbe part alors
     * bien au-delà du court segment qu'elle devrait suivre — mesuré ici à
     * dix-huit unités d'excursion pour un segment de huit, c'est-à-dire une
     * boucle franche au milieu du trait.
     *
     * C'est exactement la géométrie que laisse une souris : deux points serrés
     * là où la main a hésité, un grand saut juste après.
     */
    const dense = inkSpine(
      [
        [0, 0, 0.5],
        [100, 0, 0.5],
        [108, 0, 0.5],
        [108, 300, 0.5],
      ],
      3,
    );
    const entre = dense.filter(([x]) => x > 100 && x < 108);
    assert.ok(entre.length > 0, "rien n'a été inséré : le cas n'est pas éprouvé");
    const excursion = Math.max(...entre.map(([, y]) => Math.abs(y)));
    assert.ok(excursion < 3, `la courbe s'écarte de ${excursion.toFixed(1)} unités`);
    assert.ok(dense.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
  });

  it("garde les points d'origine, dans l'ordre", () => {
    const dense = inkSpine(
      [
        [0, 0, 0.4],
        [60, 20, 0.7],
        [120, 0, 0.4],
      ],
      3,
    );
    assert.deepEqual(dense[0], [0, 0, 0.4]);
    assert.deepEqual(dense.at(-1), [120, 0, 0.4]);
    const index = dense.findIndex(([x, y]) => x === 60 && y === 20);
    assert.ok(index > 0 && index < dense.length - 1, `le point du milieu est en ${index}`);
  });

  it("borne le nombre de points insérés dans un trou immense", () => {
    const dense = inkSpine(
      [
        [0, 0, 0.5],
        [100000, 0, 0.5],
      ],
      3,
    );
    assert.ok(dense.length <= 26, `${dense.length} points`);
  });
});

/**
 * Le lissage n'existe qu'en un seul endroit.
 *
 * Même raison que pour `INK_OPTIONS` : l'écran et le papier ont déjà divergé
 * une fois parce qu'un réglage vivait en double. Un trait de souris courbe à
 * l'écran et brisé dans le PDF serait exactement cette divergence-là.
 */
describe("l'écran et le papier comblent les trous de la même façon", () => {
  it("parce que c'est le même code qui les comble", () => {
    const code = readFileSync(path.join(process.cwd(), "src/lib/ink-stroke.ts"), "utf8");
    assert.ok(/getStroke\(inkSpine\(/.test(code), "inkOutline doit combler avant de contourer");
    // Et l'écart est mis à l'échelle du repère : dans un PDF, une unité de la
    // page de mille ne vaut pas un point typographique.
    assert.ok(/LISSAGE\.ecart \* echelle/.test(code), "l'écart doit suivre l'échelle du repère");
  });
});
