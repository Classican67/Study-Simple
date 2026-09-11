import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  boundsOf,
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
