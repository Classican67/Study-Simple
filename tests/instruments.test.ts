import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  INSTRUMENTS,
  TOOLS,
  inkSeed,
  instrumentOf,
  roughenOutline,
  strokeWeight,
  type Tool,
} from "@/lib/ink";
import { inkOutline, INSTRUMENT_ORDER } from "@/lib/ink-stroke";

/** Un trait droit, dense, avec une pression de vraie main. */
function trait(n = 80): number[] {
  const flat: number[] = [];
  for (let i = 0; i < n; i++) {
    flat.push(0.1 + (0.6 * i) / (n - 1), 0.4, 0.5 + 0.18 * Math.sin(i / 7));
  }
  return flat;
}

/** Les points d'un trait, placés dans un repère de largeur `echelle × 1000`. */
function places(flat: number[], echelle: number): number[][] {
  const points: number[][] = [];
  for (let i = 0; i + 2 < flat.length; i += 3) {
    points.push([flat[i] * 1000 * echelle, flat[i + 1] * 1000 * echelle, flat[i + 2]]);
  }
  return points;
}

function cadre(outline: number[][]) {
  const xs = outline.map((p) => p[0]);
  const ys = outline.map((p) => p[1]);
  return {
    largeur: Math.max(...xs) - Math.min(...xs),
    hauteur: Math.max(...ys) - Math.min(...ys),
  };
}

/**
 * Aire du contour, par la formule du lacet.
 *
 * Le cadre englobant ne suffit pas : un effilement écrit en unités absolues
 * mange le bout du trait sans toucher au cadre, dont la hauteur se prend au
 * milieu. L'aire, elle, le voit — c'est **elle** qui dit si les deux rendus
 * ont la même forme, et pas seulement la même enveloppe.
 */
function aire(outline: number[][]): number {
  let somme = 0;
  for (let i = 0; i < outline.length; i++) {
    const [x1, y1] = outline[i];
    const [x2, y2] = outline[(i + 1) % outline.length];
    somme += x1 * y2 - x2 * y1;
  }
  return Math.abs(somme) / 2;
}

describe("le catalogue des instruments", () => {
  it("couvre exactement les outils enregistrables", () => {
    assert.deepEqual([...INSTRUMENT_ORDER].sort(), [...TOOLS].sort());
  });

  it("donne à chacun un nom et trois épaisseurs croissantes", () => {
    for (const tool of TOOLS) {
      const i = INSTRUMENTS[tool];
      assert.ok(i.label.length > 2, `${tool} n'a pas de nom`);
      assert.equal(i.tailles.length, 3);
      assert.ok(i.tailles[0] < i.tailles[1] && i.tailles[1] < i.tailles[2], `${tool} : ${i.tailles}`);
    }
  });

  it("retombe sur le stylo pour un trait sans instrument, ou d'un instrument inconnu", () => {
    // Les traits d'avant le surligneur n'ont pas de champ `tool`, et une note
    // écrite par une version plus récente peut en porter un qu'on ne connaît pas.
    assert.equal(instrumentOf(undefined).label, INSTRUMENTS.pen.label);
    assert.equal(instrumentOf("aquarelle").label, INSTRUMENTS.pen.label);
  });

  it("n'a qu'un seul instrument qui passe sous l'encre", () => {
    const dessous = TOOLS.filter((t) => INSTRUMENTS[t].dessous);
    assert.deepEqual(dessous, ["highlighter"]);
  });
});

describe("strokeWeight", () => {
  it("suit l'échelle du repère", () => {
    assert.equal(strokeWeight({ size: 2.5, tool: "pen" }), 2.5);
    assert.equal(strokeWeight({ size: 2.5, tool: "pen" }, 0.5), 1.25);
  });

  it("et le facteur de l'instrument", () => {
    assert.equal(strokeWeight({ size: 2, tool: "highlighter" }), 8);
    assert.ok(strokeWeight({ size: 2, tool: "marker" }) > strokeWeight({ size: 2, tool: "pen" }));
  });
});

/**
 * **Le test qui compte.**
 *
 * Trois grandeurs de l'instrument sont des distances : l'épaisseur,
 * l'effilement d'une plume, le grain d'un crayon. Le PDF ne fait que 595 points
 * de large là où l'écran en compte mille : une seule de ces trois écrite en dur
 * sort du papier presque deux fois trop courte — un effilement qui mange la
 * moitié d'une lettre, ou un grain qui disparaît.
 *
 * On calcule donc le même trait dans les deux repères et l'on compare les
 * formes. Elles doivent être **semblables**, au rapport des repères près.
 */
describe("un trait a la même forme à l'écran et sur le papier", () => {
  const ECHELLE = 595 / 1000;
  const flat = trait();

  for (const tool of TOOLS) {
    it(`${INSTRUMENTS[tool].label}`, () => {
      const ecran = cadre(inkOutline(places(flat, 1), flat, tool, 2.5, 1));
      const papier = cadre(inkOutline(places(flat, ECHELLE), flat, tool, 2.5, ECHELLE));

      const rapportL = papier.largeur / ecran.largeur;
      const rapportH = papier.hauteur / ecran.hauteur;
      // L'aire va comme le carré de l'échelle : c'est la mesure qui attrape un
      // effilement ou un grain écrit en unités absolues, qui rogne le bout du
      // trait sans rien changer à son cadre.
      const rapportA =
        aire(inkOutline(places(flat, ECHELLE), flat, tool, 2.5, ECHELLE)) /
        aire(inkOutline(places(flat, 1), flat, tool, 2.5, 1));
      // Deux pour cent : `getStroke` rogne trois unités absolues au bout du
      // tracé, ce qui est la seule chose en lui qui ne suive pas l'échelle.
      assert.ok(
        Math.abs(rapportL - ECHELLE) < 0.02,
        `longueur : rapport ${rapportL.toFixed(3)} pour ${ECHELLE}`,
      );
      assert.ok(
        Math.abs(rapportH - ECHELLE) < 0.02,
        `épaisseur : rapport ${rapportH.toFixed(3)} pour ${ECHELLE}`,
      );
      assert.ok(
        Math.abs(rapportA - ECHELLE ** 2) < 0.02,
        `aire : rapport ${rapportA.toFixed(3)} pour ${(ECHELLE ** 2).toFixed(3)} — un effilement ou un grain écrit en unités absolues donne exactement cet écart`,
      );
    });
  }
});

describe("chaque instrument écrit autrement", () => {
  const flat = trait();
  const forme = (tool: Tool) => cadre(inkOutline(places(flat, 1), flat, tool, 2.5, 1));

  it("le feutre est plus large que le stylo, le surligneur plus large encore", () => {
    const stylo = forme("pen").hauteur;
    const feutre = forme("marker").hauteur;
    const surligneur = forme("highlighter").hauteur;
    assert.ok(feutre > stylo * 1.5, `${feutre.toFixed(1)} contre ${stylo.toFixed(1)}`);
    assert.ok(surligneur > feutre * 1.5, `${surligneur.toFixed(1)} contre ${feutre.toFixed(1)}`);
  });

  it("la plume s'effile aux bouts, le feutre non", () => {
    /**
     * Le profil d'épaisseur, colonne par colonne.
     *
     * Une seule abscisse ne suffit pas : la pression varie le long du trait, et
     * l'on comparerait alors un creux de pression à une bosse. On compare le
     * **bout** à la **médiane** du profil.
     */
    const profil = (tool: Tool) => {
      const contour = inkOutline(places(flat, 1), flat, tool, 3, 1);
      const colonnes = new Map<number, { min: number; max: number }>();
      for (const [x, y] of contour) {
        const k = Math.round(x);
        const c = colonnes.get(k);
        if (c) {
          c.min = Math.min(c.min, y);
          c.max = Math.max(c.max, y);
        } else colonnes.set(k, { min: y, max: y });
      }
      const cles = [...colonnes.keys()].sort((a, b) => a - b);
      const largeurs = cles.map((k) => colonnes.get(k)!.max - colonnes.get(k)!.min);
      const triees = [...largeurs].sort((a, b) => a - b);
      // La deuxième colonne : la première n'est que la pointe du bout arrondi,
      // large de quelques centièmes, et la comparer ne dirait rien.
      return {
        bout: largeurs[1] ?? 0,
        mediane: triees[Math.floor(triees.length / 2)] ?? 0,
      };
    };

    const plume = profil("fountain");
    const feutre = profil("marker");
    assert.ok(
      plume.bout < plume.mediane * 0.55,
      `plume : ${plume.bout.toFixed(2)} au bout pour ${plume.mediane.toFixed(2)} de médiane`,
    );
    assert.ok(
      feutre.bout > feutre.mediane * 0.9,
      `feutre : ${feutre.bout.toFixed(2)} au bout pour ${feutre.mediane.toFixed(2)} de médiane — un feutre a le bout carré`,
    );
  });

  it("le crayon a du grain, le stylo un bord net", () => {
    /** Rugosité : écart moyen d'un point du contour au milieu de ses voisins. */
    const rugosite = (tool: Tool) => {
      const c = inkOutline(places(flat, 1), flat, tool, 2.5, 1);
      let somme = 0;
      for (let i = 1; i + 1 < c.length; i++) {
        somme += Math.abs(c[i][1] - (c[i - 1][1] + c[i + 1][1]) / 2);
      }
      return somme / Math.max(1, c.length - 2);
    };
    const crayon = rugosite("pencil");
    const stylo = rugosite("pen");
    assert.ok(crayon > stylo * 2, `crayon ${crayon.toFixed(3)} contre stylo ${stylo.toFixed(3)}`);
  });

  it("et le crayon est plus pâle que le stylo, sans être transparent", () => {
    assert.ok(INSTRUMENTS.pencil.alpha < 1 && INSTRUMENTS.pencil.alpha > 0.6);
    assert.equal(INSTRUMENTS.pen.alpha, 1);
  });
});

describe("le grain", () => {
  const contour = () =>
    Array.from({ length: 40 }, (_, i) => [100 + i * 3, 200 + (i % 2) * 0.2, 0.5]);

  it("est le même à chaque calcul : un trait ne frémit pas au redessin", () => {
    const a = roughenOutline(contour(), 1.2, 4242);
    const b = roughenOutline(contour(), 1.2, 4242);
    assert.deepEqual(a, b);
  });

  it("et change avec la graine : deux traits voisins n'ont pas la même mine", () => {
    const a = roughenOutline(contour(), 1.2, 1);
    const b = roughenOutline(contour(), 1.2, 999);
    assert.notDeepEqual(a, b);
  });

  it("ne déplace jamais un point de plus que son amplitude", () => {
    const base = contour();
    const rugueux = roughenOutline(base, 1.2, 77);
    for (let i = 0; i < base.length; i++) {
      const d = Math.hypot(rugueux[i][0] - base[i][0], rugueux[i][1] - base[i][1]);
      assert.ok(d <= 1.2 + 1e-9, `point ${i} déplacé de ${d.toFixed(3)}`);
    }
  });

  it("ne fait rien quand l'amplitude est nulle", () => {
    const base = contour();
    assert.equal(roughenOutline(base, 0, 7), base);
  });

  it("la graine se tire des points enregistrés, donc elle ne change pas de repère", () => {
    const flat = trait();
    assert.equal(inkSeed(flat), inkSeed([...flat]));
    assert.notEqual(inkSeed(flat), inkSeed(trait(60)));
  });
});
