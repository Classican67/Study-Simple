import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  inkRgb,
  strokeOpacity,
  strokeRect,
  strokeToInkList,
  strokeToPdfOperators,
  strokeToSvgPath,
  toPdfPoint,
} from "@/lib/pdf-export";
import type { Stroke } from "@/lib/notes";

// A4 en points : 595 × 842. Nos coordonnées sont en proportion de la LARGEUR,
// donc le bas de la page se trouve à y = 842 / 595 ≈ 1,4151.
const A4 = { width: 595, height: 842 };

const trait = (points: number[], extra: Partial<Stroke> = {}): Stroke => ({
  color: "default",
  size: 3,
  tool: "pen",
  points,
  ...extra,
});

describe("toPdfPoint", () => {
  it("retourne l'axe vertical", () => {
    // Le PDF a son origine en bas ; nos coordonnées, en haut.
    assert.deepEqual(toPdfPoint(0, 0, A4), { x: 0, y: 842 });
    assert.deepEqual(toPdfPoint(1, 0, A4), { x: 595, y: 842 });
  });

  it("place le bas de la page au bon endroit", () => {
    const bas = toPdfPoint(0, A4.height / A4.width, A4);
    assert.ok(Math.abs(bas.y) < 0.001, `attendu 0, obtenu ${bas.y}`);
  });

  it("place le milieu au milieu", () => {
    const milieu = toPdfPoint(0.5, A4.height / A4.width / 2, A4);
    assert.equal(milieu.x, 297.5);
    assert.ok(Math.abs(milieu.y - 421) < 0.001);
  });
});

describe("strokeToInkList", () => {
  it("aplatit en suites x y, sans la pression", () => {
    // La norme attend [x1 y1 x2 y2 …] : y compris la pression, un lecteur
    // conforme lirait les points de travers.
    const liste = strokeToInkList(trait([0, 0, 0.5, 1, 0, 0.9]), A4);
    assert.equal(liste.length, 4);
    assert.deepEqual(liste, [0, 842, 595, 842]);
  });

  it("ne produit rien d'un trait vide", () => {
    assert.deepEqual(strokeToInkList(trait([]), A4), []);
  });
});

describe("strokeRect", () => {
  it("encadre le trait, avec la marge de l'épaisseur", () => {
    const rect = strokeRect(trait([0.2, 0.2, 0.5, 0.4, 0.3, 0.5]), A4)!;
    const [minX, minY, maxX, maxY] = rect;
    // Le cadre contient bien les deux points convertis.
    assert.ok(minX < 0.2 * 595 && maxX > 0.4 * 595, `x : ${minX}–${maxX}`);
    assert.ok(minY < 842 - 0.3 * 595 && maxY > 842 - 0.2 * 595, `y : ${minY}–${maxY}`);
  });

  it("laisse de la place autour d'un trait épais", () => {
    const fin = strokeRect(trait([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], { size: 1 }), A4)!;
    const epais = strokeRect(trait([0.5, 0.5, 0.5, 0.5, 0.5, 0.5], { size: 12 }), A4)!;
    assert.ok(epais[2] - epais[0] > fin[2] - fin[0], "le cadre suit l'épaisseur");
  });

  it("rend null sur un trait vide", () => {
    assert.equal(strokeRect(trait([]), A4), null);
  });
});

describe("strokeToSvgPath", () => {
  it("produit un contour fermé", () => {
    const chemin = strokeToSvgPath(trait([0.2, 0.2, 0.5, 0.4, 0.3, 0.7, 0.6, 0.25, 0.5]), A4)!;
    assert.match(chemin, /^M /, "commence par un déplacement");
    assert.match(chemin, /Z$/, "et se referme, sinon le remplissage fuit");
    assert.ok(chemin.split("L").length > 10, "assez de segments pour un contour lisse");
  });

  it("reste dans les bornes de la page", () => {
    const chemin = strokeToSvgPath(trait([0.1, 0.1, 0.5, 0.9, 0.9, 0.5]), A4)!;
    const nombres = chemin.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = nombres.filter((_, i) => i % 2 === 0);
    const ys = nombres.filter((_, i) => i % 2 === 1);
    assert.ok(Math.min(...xs) > -30 && Math.max(...xs) < A4.width + 30, "abscisses plausibles");
    assert.ok(Math.min(...ys) > -30 && Math.max(...ys) < A4.height + 30, "ordonnées plausibles");
  });

  it("rend null quand il n'y a rien à tracer", () => {
    assert.equal(strokeToSvgPath(trait([]), A4), null);
  });
});

describe("couleurs et opacité", () => {
  it("donne des composantes valides pour chaque encre", () => {
    for (const nom of ["default", "rose", "amber", "emerald", "blue", "violet"]) {
      const rgb = inkRgb(nom);
      assert.equal(rgb.length, 3, nom);
      assert.ok(rgb.every((c) => c >= 0 && c <= 1), `${nom} : ${rgb}`);
    }
  });

  it("retombe sur l'encre par défaut pour un nom inconnu", () => {
    assert.deepEqual(inkRgb("turquoise"), inkRgb("default"));
  });

  it("laisse voir le texte sous un surligneur", () => {
    assert.equal(strokeOpacity(trait([], { tool: "pen" })), 1);
    assert.ok(strokeOpacity(trait([], { tool: "highlighter" })) < 0.5);
  });
});

describe("strokeToPdfOperators", () => {
  it("traduit le contour en opérateurs de la norme", () => {
    const ops = strokeToPdfOperators(trait([0.2, 0.2, 0.5, 0.5, 0.4, 0.6]), A4)!;
    assert.match(ops, /^[\d.]+ [\d.]+ [\d.]+ rg\n/, "la couleur d'abord");
    assert.match(ops, /\d+(\.\d+)? \d+(\.\d+)? m\n/, "un déplacement");
    assert.match(ops, / l\n/, "des segments");
    assert.match(ops, /\nh\nf$/, "le contour se referme, puis se remplit");
    assert.ok(!/[MLZ]/.test(ops), "plus aucune commande SVG");
  });

  it("ne produit rien d'un trait vide", () => {
    assert.equal(strokeToPdfOperators(trait([]), A4), null);
  });
});
