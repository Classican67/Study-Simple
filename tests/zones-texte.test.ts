import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

import fontkit from "@pdf-lib/fontkit";

import { collerFragment, extraireFragment, retirerSelection } from "@/lib/fragment-encre";
import { TRANSFO_NEUTRE } from "@/lib/ink";
import { GROUPES_MATHS } from "@/lib/maths";
import {
  buildPreview,
  centreTexte,
  defaultContent,
  insertPage,
  noteSearchText,
  pageAtY,
  pageBands,
  parseDrawing,
  pointSurTexte,
  removePage,
  surfaceRatio,
  transformerTexte,
  zonesDuContenu,
  type DrawingContent,
  type NotePage,
  type ZoneTexte,
} from "@/lib/notes";

const zone = (bout: Partial<ZoneTexte> = {}): ZoneTexte => ({
  id: "z",
  x: 0.2,
  y: 0.1,
  w: 0.4,
  h: 0.1,
  taille: 0.024,
  markup: "Le **rein**",
  angle: 0,
  ...bout,
});

const surface = (bout: Partial<DrawingContent> = {}): DrawingContent => ({
  strokes: [],
  ratio: 0.75,
  paper: "blank",
  pages: [],
  images: [],
  textes: [],
  ...bout,
});

describe("zones de texte — lecture", () => {
  it("se relisent telles qu'elles ont été écrites", () => {
    assert.deepEqual(parseDrawing(JSON.stringify(surface({ textes: [zone()] }))).textes, [zone()]);
  });

  it("une note d'avant s'ouvre sans zone, et sans rien perdre", () => {
    const lue = parseDrawing(JSON.stringify({ strokes: [], ratio: 0.75, paper: "ruled", pages: [] }));
    assert.deepEqual(lue.textes, []);
  });

  it("écarte ce qui ne s'afficherait pas", () => {
    const lue = parseDrawing(JSON.stringify({ textes: [{ x: 0 }, null, zone()] }));
    assert.equal(lue.textes.length, 1);
  });

  it("borne un corps absurde", () => {
    assert.equal(parseDrawing(JSON.stringify({ textes: [zone({ taille: 9 })] })).textes[0].taille, 0.2);
  });

  it("restent la dernière clef : une page ancienne ne se renvoie pas entière", () => {
    const cles = Object.keys(parseDrawing(defaultContent("drawing")));
    assert.equal(cles.at(-1), "textes");
  });
});

describe("relire les zones sans analyser la page", () => {
  it("les retrouve à la fin du contenu", () => {
    const raw = JSON.stringify(parseDrawing(JSON.stringify(surface({ textes: [zone()] }))));
    assert.deepEqual(zonesDuContenu(raw), [zone()]);
  });

  it("une page sans zone n'en a pas", () => {
    assert.deepEqual(zonesDuContenu(defaultContent("drawing")), []);
    assert.deepEqual(zonesDuContenu('{"strokes":[]}'), []);
  });

  it("un crochet dans le texte ne la trompe pas", () => {
    const raw = JSON.stringify(parseDrawing(JSON.stringify(surface({ textes: [zone({ markup: "a ] b [c]" })] }))));
    assert.equal(zonesDuContenu(raw)[0].markup, "a ] b [c]");
  });
});

describe("zones de texte — géométrie", () => {
  it("agrandir agrandit le texte, et garde le centre", () => {
    const avant = zone();
    const c = centreTexte(avant);
    const apres = transformerTexte(avant, { ...TRANSFO_NEUTRE, cx: c.x, cy: c.y, echelle: 2 });
    assert.ok(Math.abs(apres.taille - 0.048) < 1e-6);
    assert.ok(Math.abs(apres.w - 0.8) < 1e-6);
    assert.ok(Math.abs(centreTexte(apres).x - c.x) < 1e-3);
  });

  it("réduire à l'excès garde des proportions justes", () => {
    const apres = transformerTexte(zone(), { ...TRANSFO_NEUTRE, echelle: 0.01 });
    assert.equal(apres.taille, 0.008);
    assert.ok(Math.abs(apres.w / apres.taille - 0.4 / 0.024) < 0.1);
  });

  it("toucher se juge dans le repère de la zone", () => {
    assert.equal(pointSurTexte({ x: 0.3, y: 0.15 }, zone()), true);
    assert.equal(pointSurTexte({ x: 0.9, y: 0.15 }, zone()), false);
  });
});

describe("zones de texte — pages et sélection", () => {
  const pile: NotePage[] = [
    { paper: "blank", ratio: 1 },
    { paper: "blank", ratio: 1 },
    { paper: "blank", ratio: 1 },
  ];
  const b = pageBands(pile);

  it("descendent avec leur page", () => {
    const avant = surface({ pages: pile, ratio: surfaceRatio(pile), textes: [zone({ y: b[1].top + 0.2 })] });
    const apres = insertPage(avant, 0, "blank");
    assert.equal(pageAtY(pageBands(apres.pages), centreTexte(apres.textes[0]).y), 2);
  });

  it("partent avec leur page, et ce qui suit remonte", () => {
    const avant = surface({
      pages: pile,
      ratio: surfaceRatio(pile),
      textes: [zone({ id: "m", y: b[1].top + 0.2 }), zone({ id: "f", y: b[2].top + 0.2 })],
    });
    const apres = removePage(avant, 1);
    assert.deepEqual(apres.textes.map((z) => z.id), ["f"]);
    assert.equal(pageAtY(pageBands(apres.pages), centreTexte(apres.textes[0]).y), 1);
  });

  it("se copient avec un nouvel identifiant", () => {
    const depart = surface({ textes: [zone()] });
    const fragment = extraireFragment(depart, [], ["z"])!;
    const pose = collerFragment(depart, fragment, { x: 0.5, y: 0.5 });
    assert.equal(pose.content.textes.length, 2);
    assert.notEqual(pose.ids[0], "z");
  });

  it("un fragment gardé avant les zones se recolle encore", () => {
    const ancien = { strokes: [], images: [], cadre: { minX: 0, minY: 0, maxX: 0.1, maxY: 0.1 } };
    const pose = collerFragment(surface(), ancien as never, { x: 0.5, y: 0.5 });
    assert.deepEqual(pose.content.textes, []);
  });

  it("se retirent de la sélection", () => {
    assert.deepEqual(retirerSelection(surface({ textes: [zone()] }), [], ["z"]).textes, []);
  });
});

describe("recherche et aperçu", () => {
  it("le texte des pages entre dans la recherche, sans relire leur contenu", () => {
    const texte = noteSearchText("Titre", [{ kind: "drawing", content: "", plain: "mitochondrie" }], (t) => t);
    assert.ok(texte.includes("mitochondrie"));
  });

  it("une page de texte a un aperçu sans balisage", () => {
    const apercu = buildPreview("drawing", JSON.stringify(surface({ textes: [zone()] })));
    assert.deepEqual(apercu, { kind: "texte", ratio: 0.75, texte: "Le rein" });
  });
});

describe("les symboles sortent du PDF", () => {
  it("chaque symbole de la palette existe dans les quatre graisses", () => {
    const tous = GROUPES_MATHS.flatMap((g) => g.symboles.map((s) => s.c));
    assert.ok(tous.length > 50);
    for (const nom of ["", "-Bold", "-Oblique", "-BoldOblique"]) {
      const face = fontkit.create(
        readFileSync(`node_modules/dejavu-fonts-ttf/ttf/DejaVuSansCondensed${nom}.ttf`),
      ) as unknown as { hasGlyphForCodePoint(c: number): boolean };
      const absents = tous.filter((c) => ![...c].every((u) => face.hasGlyphForCodePoint(u.codePointAt(0)!)));
      assert.deepEqual(absents, [], nom);
    }
  });
});
