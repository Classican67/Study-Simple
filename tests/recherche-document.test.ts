import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { centreImage, type DrawingContent, type NotePage } from "@/lib/notes";
import {
  lireMots,
  occurrencesDansMots,
  placerOccurrences,
  texteDePage,
  type MotLu,
} from "@/lib/recherche-document";
import { normalizeForSearch } from "@/lib/search";


const mot = (t: string, x: number, y: number): MotLu => [t, x, y, 0.1, 0.02];

describe("texte d'une page", () => {
  it("rétablit les lignes", () => {
    assert.equal(texteDePage([mot("un", 0, 0.1), mot("deux", 0.2, 0.1), mot("trois", 0, 0.2)]), "un deux\ntrois");
  });

  it("recolle une césure de fin de ligne", () => {
    const texte = texteDePage([mot("hémo-", 0.8, 0.1), mot("globine", 0, 0.2)]);
    assert.equal(normalizeForSearch(texte), "hemoglobine");
  });

  it("laisse un tiret qui en est un", () => {
    assert.equal(texteDePage([mot("Saint-", 0.1, 0.1), mot("Denis", 0.3, 0.1)]), "Saint- Denis");
    // Une majuscule à la ligne suivante ne continue pas le mot.
    assert.equal(texteDePage([mot("pré-", 0.8, 0.1), mot("Paris", 0, 0.2)]), "pré-\nParis");
  });

  it("une page vide ne casse rien", () => {
    assert.equal(texteDePage([]), "");
    assert.deepEqual(lireMots("{pas du json"), []);
  });
});

describe("occurrences", () => {
  const page = [
    mot("La", 0, 0.1),
    mot("mitochondrie,", 0.1, 0.1),
    mot("organite", 0.3, 0.1),
    mot("Mitochondrie", 0, 0.2),
    mot("chaîne", 0.2, 0.2),
    mot("respiratoire", 0.4, 0.2),
  ];

  it("trouve un mot malgré la ponctuation, la casse et les accents", () => {
    assert.equal(occurrencesDansMots(page, ["mitochondrie"]).length, 2);
    assert.equal(occurrencesDansMots(page, ["chaine"]).length, 1);
  });

  it("surligne une expression d'un bloc", () => {
    const trouvees = occurrencesDansMots(page, ["chaine", "respiratoire"]);
    assert.equal(trouvees.length, 1);
    assert.equal(trouvees[0].length, 2);
  });

  it("montre chaque terme quand ils ne se suivent pas", () => {
    assert.equal(occurrencesDansMots(page, ["organite", "chaine"]).length, 2);
  });

  it("couvre les deux morceaux d'un mot coupé", () => {
    const trouvees = occurrencesDansMots([mot("hémo-", 0.8, 0.1), mot("globine", 0, 0.2)], ["hemoglobine"]);
    assert.equal(trouvees.length, 1);
    assert.equal(trouvees[0].length, 2);
  });

  it("rien à chercher, rien de trouvé", () => {
    assert.deepEqual(occurrencesDansMots(page, []), []);
  });
});

describe("placement sur la surface", () => {
  const pages: NotePage[] = [
    { file: "a.pdf", page: 1, ratio: 1.4 },
    { file: "a.pdf", page: 2, ratio: 1.4 },
  ];
  const surface = (bout: Partial<DrawingContent> = {}): DrawingContent => ({
    strokes: [],
    ratio: 2.82,
    paper: "blank",
    pages,
    images: [],
    textes: [],
    ...bout,
  });

  it("descend à la bonne page, à sa place", () => {
    const [o] = placerOccurrences(surface(), [
      { file: "a.pdf", page: 2, occurrences: [[[0.1, 0.5, 0.2, 0.02]]] },
    ]);
    assert.ok(Math.abs(o.rects[0].y - (1.42 + 0.5 * 1.4)) < 1e-6);
    assert.ok(Math.abs(o.rects[0].h - 0.02 * 1.4) < 1e-6);
  });

  it("ordonne de haut en bas, quel que soit l'ordre reçu", () => {
    const placees = placerOccurrences(surface(), [
      { file: "a.pdf", page: 2, occurrences: [[[0.1, 0.1, 0.1, 0.01]]] },
      { file: "a.pdf", page: 1, occurrences: [[[0.1, 0.1, 0.1, 0.01]]] },
    ]);
    assert.deepEqual(placees.map((o) => o.page), [1, 2]);
  });

  it("une page retirée de la pile ne laisse pas de surlignage en l'air", () => {
    assert.deepEqual(
      placerOccurrences(surface(), [{ file: "autre.pdf", page: 1, occurrences: [[[0, 0, 1, 1]]] }]),
      [],
    );
  });

  it("suit une image posée, et sa rotation", () => {
    const image = { id: "a", file: "p.jpg", x: 0.2, y: 0.2, w: 0.4, ratio: 0.5, angle: Math.PI / 2 };
    const [o] = placerOccurrences(surface({ images: [image] }), [
      { file: "p.jpg", page: 1, occurrences: [[[0, 0, 1, 1]]] },
    ]);
    const c = centreImage(image);
    // Toute l'image, tournée d'un quart de tour : largeur et hauteur s'échangent.
    assert.ok(Math.abs(o.rects[0].l - 0.2) < 1e-6);
    assert.ok(Math.abs(o.rects[0].h - 0.4) < 1e-6);
    assert.ok(Math.abs(o.rects[0].x + o.rects[0].l / 2 - c.x) < 1e-6);
  });
});
