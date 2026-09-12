import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  INK_REF,
  boundsOf,
  eraseStroke,
  pointInPolygon,
  pointsOf,
  snapShape,
  strokeInLasso,
  translateStroke,
  unionBounds,
  rulerDegrees,
  snapStrokeToRuler,
  snapToRuler,
} from "@/lib/ink";

/** Trait droit horizontal, de x1 à x2 à hauteur y. */
const ligne = (x1: number, x2: number, y: number, n = 5) =>
  Array.from({ length: n }, (_, i) => [x1 + ((x2 - x1) * i) / (n - 1), y, 0.5]).flat();

const carre = [
  { x: 0, y: 0 },
  { x: 1, y: 0 },
  { x: 1, y: 1 },
  { x: 0, y: 1 },
];

describe("pointsOf", () => {
  it("retire la pression", () => {
    assert.deepEqual(pointsOf([1, 2, 0.5, 3, 4, 0.9]), [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
  });

  it("ne produit rien d'un trait vide", () => {
    assert.deepEqual(pointsOf([]), []);
  });
});

describe("boundsOf", () => {
  it("encadre le trait", () => {
    assert.deepEqual(boundsOf([0, 1, 0.5, 2, 0, 0.5, 1, 3, 0.5]), {
      minX: 0,
      maxX: 2,
      minY: 0,
      maxY: 3,
    });
  });

  it("rend null sur un trait vide", () => {
    assert.equal(boundsOf([]), null);
  });
});

describe("pointInPolygon", () => {
  it("distingue dedans et dehors", () => {
    assert.equal(pointInPolygon({ x: 0.5, y: 0.5 }, carre), true);
    assert.equal(pointInPolygon({ x: 1.5, y: 0.5 }, carre), false);
    assert.equal(pointInPolygon({ x: 0.5, y: -0.5 }, carre), false);
  });

  it("fonctionne sur un polygone concave, ce que donne un lasso à main levée", () => {
    // Un « U » : le creux central est à l'extérieur.
    const u = [
      { x: 0, y: 0 },
      { x: 3, y: 0 },
      { x: 3, y: 3 },
      { x: 2, y: 3 },
      { x: 2, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 3 },
      { x: 0, y: 3 },
    ];
    assert.equal(pointInPolygon({ x: 1.5, y: 2 }, u), false, "le creux est dehors");
    assert.equal(pointInPolygon({ x: 0.5, y: 2 }, u), true, "la branche gauche est dedans");
    assert.equal(pointInPolygon({ x: 2.5, y: 2 }, u), true, "la branche droite est dedans");
  });

  it("refuse un polygone dégénéré", () => {
    assert.equal(pointInPolygon({ x: 0, y: 0 }, [{ x: 0, y: 0 }, { x: 1, y: 1 }]), false);
  });
});

describe("strokeInLasso", () => {
  it("prend un trait entièrement entouré", () => {
    assert.equal(strokeInLasso(ligne(0.2, 0.8, 0.5), carre), true);
  });

  it("laisse un trait entièrement dehors", () => {
    assert.equal(strokeInLasso(ligne(2, 3, 0.5), carre), false);
  });

  it("laisse un trait qui ne fait que traverser", () => {
    // Entourer un mot ne doit pas emporter la longue barre qui passe dessous.
    const traversant = ligne(-5, 5, 0.5, 21);
    assert.equal(strokeInLasso(traversant, carre), false);
  });

  it("prend un trait majoritairement dedans", () => {
    // 4 points sur 5 à l'intérieur.
    const presque = [0.2, 0.5, 0.5, 0.4, 0.5, 0.5, 0.6, 0.5, 0.5, 0.8, 0.5, 0.5, 1.4, 0.5, 0.5];
    assert.equal(strokeInLasso(presque, carre), true);
  });
});

describe("translateStroke", () => {
  it("décale sans toucher à la pression", () => {
    assert.deepEqual(translateStroke([1, 2, 0.3, 3, 4, 0.9], 1, -1), [2, 1, 0.3, 4, 3, 0.9]);
  });
});

describe("snapShape", () => {
  it("réduit une ligne à ses deux extrémités", () => {
    const tremblante = [0, 0, 0.4, 0.5, 0.1, 0.6, 1, 0.02, 0.5];
    const droite = snapShape(tremblante, "line");
    assert.equal(droite.length, 6, "deux points");
    assert.deepEqual(droite.slice(0, 2), [0, 0]);
    assert.deepEqual(droite.slice(3, 5), [1, 0.02]);
  });

  it("redresse un rectangle sur le cadre du tracé", () => {
    const gribouillis = [0.1, 0.2, 0.5, 0.9, 0.25, 0.5, 0.85, 0.7, 0.5, 0.15, 0.65, 0.5];
    const rect = snapShape(gribouillis, "rect");
    const b = boundsOf(rect)!;
    assert.equal(rect.length, 15, "cinq points, le dernier refermant la forme");
    assert.deepEqual([b.minX, b.minY, b.maxX, b.maxY], [0.1, 0.2, 0.9, 0.7]);
    // Fermé : le dernier point est le premier.
    assert.deepEqual(rect.slice(0, 2), rect.slice(12, 14));
  });

  it("inscrit l'ellipse dans le cadre du tracé", () => {
    const rond = [0, 0, 0.5, 1, 0, 0.5, 1, 1, 0.5, 0, 1, 0.5];
    const ellipse = snapShape(rond, "ellipse");
    const b = boundsOf(ellipse)!;
    // Tolérance : l'échantillonnage ne tombe pas exactement sur les extrêmes.
    for (const [reel, attendu] of [[b.minX, 0], [b.minY, 0], [b.maxX, 1], [b.maxY, 1]]) {
      assert.ok(Math.abs(reel - attendu) < 0.01, `${reel} ≈ ${attendu}`);
    }
    assert.ok(ellipse.length > 60, "assez de points pour qu'aucun angle ne se voie");
  });

  it("laisse tel quel un tracé trop court pour être une forme", () => {
    assert.deepEqual(snapShape([1, 1, 0.5], "rect"), [1, 1, 0.5]);
  });
});

describe("unionBounds", () => {
  it("englobe plusieurs traits", () => {
    assert.deepEqual(unionBounds([ligne(0, 1, 0), ligne(2, 3, 5)]), {
      minX: 0,
      minY: 0,
      maxX: 3,
      maxY: 5,
    });
  });

  it("rend null quand il n'y a rien", () => {
    assert.equal(unionBounds([]), null);
    assert.equal(unionBounds([[]]), null);
  });
});

describe("règle", () => {
  const horizontale = { y: 0.5, angle: 0 };

  it("colle un point proche sur la droite", () => {
    const p = snapToRuler({ x: 0.3, y: 0.52 }, horizontale);
    assert.equal(p.y, 0.5, "ramené sur la règle");
    assert.equal(p.x, 0.3, "sans glisser le long");
  });

  it("laisse un point éloigné où il est", () => {
    // On écrit à côté de la règle sans vouloir s'y appuyer.
    const p = snapToRuler({ x: 0.3, y: 0.8 }, horizontale);
    assert.deepEqual(p, { x: 0.3, y: 0.8 });
  });

  it("fonctionne en oblique", () => {
    const diagonale = { y: 0.5, angle: Math.PI / 4 };
    // Un point déjà sur la droite ne bouge pas.
    const sur = snapToRuler({ x: 0.5 + 0.1, y: 0.5 + 0.1 }, diagonale, 1);
    assert.ok(Math.abs(sur.x - 0.6) < 1e-9 && Math.abs(sur.y - 0.6) < 1e-9, JSON.stringify(sur));
    // Un point décalé perpendiculairement y revient.
    const decale = snapToRuler({ x: 0.6 + 0.02, y: 0.6 - 0.02 }, diagonale, 1);
    assert.ok(Math.abs(decale.x - decale.y) < 1e-9, "revenu sur la diagonale");
  });

  it("redresse tout un trait tremblant", () => {
    const tremblant = [0.2, 0.508, 0.5, 0.4, 0.494, 0.6, 0.6, 0.503, 0.4];
    const droit = snapStrokeToRuler(tremblant, horizontale);
    for (let i = 1; i < droit.length; i += 3) {
      assert.equal(droit[i], 0.5, `point ${(i - 1) / 3} aligné`);
    }
    // Les abscisses et la pression sont conservées.
    assert.deepEqual([droit[0], droit[3], droit[6]], [0.2, 0.4, 0.6]);
    assert.deepEqual([droit[2], droit[5], droit[8]], [0.5, 0.6, 0.4]);
  });

  it("n'aligne que ce qui passe près d'elle", () => {
    const mixte = [0.2, 0.505, 0.5, 0.4, 0.9, 0.5];
    const sortie = snapStrokeToRuler(mixte, horizontale);
    assert.equal(sortie[1], 0.5, "le point proche est collé");
    assert.equal(sortie[4], 0.9, "le point lointain est laissé");
  });

  it("annonce un angle lisible", () => {
    assert.equal(rulerDegrees({ y: 0, angle: 0 }), 0);
    assert.equal(rulerDegrees({ y: 0, angle: Math.PI / 4 }), 45);
    assert.equal(rulerDegrees({ y: 0, angle: Math.PI }), 0, "un demi-tour revient au même");
    assert.equal(rulerDegrees({ y: 0, angle: -Math.PI / 2 }), -90);
  });
});

describe("eraseStroke — la gomme précise", () => {
  // Une ligne horizontale de x = 0 à x = 1, à mi-hauteur.
  const ligne = (n = 11) =>
    Array.from({ length: n }, (_, i) => [i / (n - 1), 0.5, 0.5]).flat();

  it("laisse le trait intact quand la gomme passe loin", () => {
    const trait = ligne();
    const reste = eraseStroke(trait, { x: 0.5, y: 0.9 }, 0.05);
    assert.equal(reste.length, 1);
    // Le tableau d'origine, tel quel : rien à réenregistrer.
    assert.equal(reste[0], trait);
  });

  it("coupe le trait en deux quand elle passe au milieu", () => {
    const reste = eraseStroke(ligne(), { x: 0.5, y: 0.5 }, 0.1);
    assert.equal(reste.length, 2);
    const gauche = reste[0];
    const droite = reste[1];
    // Le premier morceau s'arrête au bord de la gomme, le second repart après.
    assert.ok(Math.abs(gauche[gauche.length - 3] - 0.4) < 1e-9);
    assert.ok(Math.abs(droite[0] - 0.6) < 1e-9);
    // Et les extrémités du trait sont intactes.
    assert.equal(gauche[0], 0);
    assert.equal(droite[droite.length - 3], 1);
  });

  it("raccourcit le trait quand elle passe sur une extrémité", () => {
    const reste = eraseStroke(ligne(), { x: 0, y: 0.5 }, 0.15);
    assert.equal(reste.length, 1);
    assert.ok(Math.abs(reste[0][0] - 0.15) < 1e-9);
    assert.ok(reste[0].length < ligne().length);
  });

  it("efface tout le trait quand elle le recouvre", () => {
    assert.deepEqual(eraseStroke(ligne(), { x: 0.5, y: 0.5 }, 2), []);
  });

  it("coupe une droite dessinée à la règle, qui n'a que deux points", () => {
    // Le cas que rate une gomme qui ne compare que les points enregistrés.
    const droite = [0, 0.5, 0.5, 1, 0.5, 0.5];
    const reste = eraseStroke(droite, { x: 0.5, y: 0.5 }, 0.1);
    assert.equal(reste.length, 2);
    assert.ok(Math.abs(reste[0][3] - 0.4) < 1e-9);
    assert.ok(Math.abs(reste[1][0] - 0.6) < 1e-9);
  });

  it("jette les miettes d'un seul point, qui ne se dessinent pas", () => {
    // La gomme s'arrête juste avant le dernier point : le reste serait un point seul.
    const reste = eraseStroke([0, 0.5, 0.5, 0.5, 0.5, 0.5, 1, 0.5, 0.5], { x: 0.5, y: 0.5 }, 0.55);
    for (const morceau of reste) assert.ok(morceau.length >= 6);
  });

  it("garde la pression en interpolant la coupure", () => {
    const trait = [0, 0.5, 0, 1, 0.5, 1];
    const reste = eraseStroke(trait, { x: 1, y: 0.5 }, 0.5);
    assert.equal(reste.length, 1);
    // La coupure tombe à mi-chemin : la pression y vaut la moyenne.
    assert.ok(Math.abs(reste[0][5] - 0.5) < 1e-9);
  });

  it("suit un trait replié qu'elle traverse deux fois", () => {
    // Un « V » dont les deux branches passent sous la gomme.
    const v = [0, 0.2, 0.5, 0.5, 0.8, 0.5, 1, 0.2, 0.5];
    const reste = eraseStroke(v, { x: 0.5, y: 0.85 }, 0.2);
    assert.equal(reste.length, 2);
  });

  it("ne renvoie rien pour un trait vide", () => {
    assert.deepEqual(eraseStroke([], { x: 0, y: 0 }, 0.1), []);
  });
});

/**
 * Les réglages du trait n'existent qu'en un seul endroit.
 *
 * Ils vivaient en double — une copie dans le canevas, une autre dans
 * l'export PDF — sous un commentaire affirmant que « l'écran et le papier ne
 * peuvent pas diverger ». Deux copies divergent toujours : il suffit d'en
 * régler une, et le trait exporté cesse de ressembler au trait tracé, sans que
 * rien ne le signale.
 */
describe("réglages du trait", () => {
  const sources = ["src/components/note/ink-canvas.tsx", "src/lib/pdf-export.ts"];

  it("ne sont déclarés que dans lib/ink.ts", () => {
    for (const fichier of sources) {
      const code = readFileSync(path.join(process.cwd(), fichier), "utf8");
      assert.ok(
        /INK_OPTIONS/.test(code),
        `${fichier} doit prendre ses réglages dans lib/ink.ts`,
      );
      assert.ok(
        !/thinning:\s*0\.62/.test(code),
        `${fichier} redéclare les réglages au lieu de les importer`,
      );
    }
  });

  it("et l'épaisseur se rapporte partout à la même page de référence", () => {
    assert.equal(INK_REF, 1000);
    for (const fichier of sources) {
      const code = readFileSync(path.join(process.cwd(), fichier), "utf8");
      assert.ok(/INK_REF/.test(code), `${fichier} doit se rapporter à INK_REF`);
    }
  });
});
