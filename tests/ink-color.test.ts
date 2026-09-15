import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { hexToHsv, hexToRgb01, hsvToHex, inkCss, isCustomInk, parseHex } from "@/lib/ink-color";
import { inkRgb } from "@/lib/pdf-export";

describe("couleurs libres", () => {
  it("ne prend pour couleur libre que la forme normalisée", () => {
    assert.equal(isCustomInk("#d9480f"), true);
    for (const autre of ["blue", "default", "#D9480F", "#f80", "d9480f", "#gggggg", "url(x)", ""]) {
      assert.equal(isCustomInk(autre), false, autre);
    }
  });

  it("lit un code tapé à la main", () => {
    assert.equal(parseHex("#D9480F"), "#d9480f");
    assert.equal(parseHex("  d9480f "), "#d9480f");
    assert.equal(parseHex("#f80"), "#ff8800");
    assert.equal(parseHex("#12345"), null);
    assert.equal(parseHex("bleu"), null);
  });

  it("convertit la roue en code, aux teintes franches", () => {
    assert.equal(hsvToHex(0, 1, 1), "#ff0000");
    assert.equal(hsvToHex(120, 1, 1), "#00ff00");
    assert.equal(hsvToHex(240, 1, 1), "#0000ff");
    assert.equal(hsvToHex(360, 1, 1), "#ff0000");
    assert.equal(hsvToHex(200, 0, 1), "#ffffff");
    assert.equal(hsvToHex(200, 1, 0), "#000000");
  });

  it("fait l'aller-retour sans perdre un octet", () => {
    for (const hex of ["#d9480f", "#1d5fbf", "#0a0a0a", "#fefefe", "#7f7f7f", "#00ff80"]) {
      const hsv = hexToHsv(hex);
      assert.ok(hsv, hex);
      assert.equal(hsvToHex(hsv.h, hsv.s, hsv.v), hex);
    }
  });

  it("donne le style en ligne d'une encre nommée comme d'une couleur libre", () => {
    assert.equal(inkCss("blue"), "var(--ink-blue)");
    assert.equal(inkCss("#d9480f"), "#d9480f");
  });
});

describe("couleurs libres à l'export", () => {
  it("rend au PDF la couleur choisie, pas l'encre par défaut", () => {
    const [r, g, b] = inkRgb("#d9480f");
    assert.ok(Math.abs(r - 217 / 255) < 1e-9 && Math.abs(g - 72 / 255) < 1e-9 && Math.abs(b - 15 / 255) < 1e-9);
    assert.notDeepEqual(inkRgb("#d9480f"), inkRgb("default"));
  });

  it("garde les encres nommées et le repli d'un nom inconnu", () => {
    assert.deepEqual(inkRgb("blue"), [0.09, 0.4, 0.75]);
    assert.deepEqual(inkRgb("turquoise"), inkRgb("default"));
    assert.equal(hexToRgb01("blue"), null);
  });
});
