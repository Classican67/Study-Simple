import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  FULL_CROP,
  MIN_CROP,
  fitWithin,
  moveCrop,
  resizeCrop,
  toSourceRect,
  type CropRect,
} from "@/lib/crop";

const rect = (x: number, y: number, width: number, height: number): CropRect => ({
  x,
  y,
  width,
  height,
});

// Les fractions sont des flottants : 0,2 + 0,1 ne vaut pas exactement 0,3.
// On compare donc à une tolérance, pas à l'identique.
function assertRect(actual: CropRect, expected: CropRect, label = "") {
  for (const key of ["x", "y", "width", "height"] as const) {
    assert.ok(
      Math.abs(actual[key] - expected[key]) < 1e-9,
      `${label} ${key} : ${actual[key]} ≠ ${expected[key]}`,
    );
  }
}

describe("moveCrop", () => {
  it("déplace le rectangle", () => {
    assertRect(moveCrop(rect(0.2, 0.2, 0.4, 0.4), 0.1, -0.1), rect(0.3, 0.1, 0.4, 0.4));
  });

  it("ne le laisse pas sortir par le haut ni par la gauche", () => {
    assertRect(moveCrop(rect(0.1, 0.1, 0.4, 0.4), -0.5, -0.5), rect(0, 0, 0.4, 0.4));
  });

  it("ne le laisse pas sortir par le bas ni par la droite", () => {
    assertRect(moveCrop(rect(0.5, 0.5, 0.4, 0.4), 0.5, 0.5), rect(0.6, 0.6, 0.4, 0.4));
  });

  it("ne bouge pas un cadre qui occupe toute l'image", () => {
    assertRect(moveCrop(FULL_CROP, 0.3, 0.3), FULL_CROP);
  });
});

describe("resizeCrop", () => {
  const base = rect(0.2, 0.2, 0.6, 0.6);

  it("laisse le coin opposé fixe", () => {
    const resized = resizeCrop(base, "nw", 0.4, 0.4);
    assert.ok(Math.abs(resized.x - 0.4) < 1e-9);
    assert.ok(Math.abs(resized.x + resized.width - 0.8) < 1e-9, "le bord droit ne bouge pas");
    assert.ok(Math.abs(resized.y + resized.height - 0.8) < 1e-9, "le bord bas ne bouge pas");
  });

  it("agrandit par le coin sud-est", () => {
    const resized = resizeCrop(base, "se", 1, 1);
    assert.ok(Math.abs(resized.x - 0.2) < 1e-9);
    assert.ok(Math.abs(resized.width - 0.8) < 1e-9);
  });

  it("empêche le rectangle de s'inverser", () => {
    // On tire le coin nord-ouest bien au-delà du coin sud-est.
    const resized = resizeCrop(base, "nw", 0.95, 0.95);
    assert.ok(resized.width >= MIN_CROP, `largeur=${resized.width}`);
    assert.ok(resized.height >= MIN_CROP, `hauteur=${resized.height}`);
    assert.ok(resized.x + resized.width <= 1 + 1e-9);
  });

  it("ne dépasse jamais les bords de l'image", () => {
    for (const corner of ["nw", "ne", "sw", "se"] as const) {
      const resized = resizeCrop(base, corner, -2, 3);
      assert.ok(resized.x >= 0, `${corner} x`);
      assert.ok(resized.y >= 0, `${corner} y`);
      assert.ok(resized.x + resized.width <= 1 + 1e-9, `${corner} droite`);
      assert.ok(resized.y + resized.height <= 1 + 1e-9, `${corner} bas`);
    }
  });
});

describe("toSourceRect", () => {
  it("convertit les fractions en pixels sources", () => {
    assert.deepEqual(toSourceRect(rect(0.25, 0.5, 0.5, 0.25), 800, 400), {
      sx: 200,
      sy: 200,
      sw: 400,
      sh: 100,
    });
  });

  it("garde au moins un pixel", () => {
    // Un canvas de largeur nulle lève une exception.
    const { sw, sh } = toSourceRect(rect(0, 0, 0.0001, 0.0001), 10, 10);
    assert.equal(sw, 1);
    assert.equal(sh, 1);
  });

  it("couvre toute l'image pour un cadre plein", () => {
    assert.deepEqual(toSourceRect(FULL_CROP, 1024, 768), { sx: 0, sy: 0, sw: 1024, sh: 768 });
  });
});

describe("fitWithin", () => {
  it("réduit en conservant les proportions", () => {
    assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200 });
    assert.deepEqual(fitWithin(3024, 4032, 1600), { width: 1200, height: 1600 });
  });

  it("n'agrandit jamais une image plus petite", () => {
    assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 });
  });

  it("laisse intacte une image exactement à la borne", () => {
    assert.deepEqual(fitWithin(1600, 900, 1600), { width: 1600, height: 900 });
  });
});
