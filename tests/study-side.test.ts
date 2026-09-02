import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STUDY_SIDE,
  facesOf,
  isStudySide,
  type StudySide,
} from "@/lib/study-side";

const carte = {
  term: "Mitose",
  definition: "Division cellulaire produisant deux cellules identiques",
  imagePath: "schema.webp",
};

describe("isStudySide", () => {
  it("n'accepte que les deux sens connus", () => {
    assert.equal(isStudySide("term"), true);
    assert.equal(isStudySide("definition"), true);
    // Un cookie vient du client : il peut contenir n'importe quoi.
    for (const valeur of ["", "Term", "reverse", null, undefined, 0, {}]) {
      assert.equal(isStudySide(valeur), false, String(valeur));
    }
  });
});

describe("facesOf", () => {
  it("montre le terme en premier par défaut", () => {
    assert.equal(DEFAULT_STUDY_SIDE, "term");
    const faces = facesOf(carte, "term");
    assert.equal(faces.question, carte.term);
    assert.equal(faces.answer, carte.definition);
  });

  it("inverse les deux faces en sens « définition »", () => {
    const faces = facesOf(carte, "definition");
    assert.equal(faces.question, carte.definition);
    assert.equal(faces.answer, carte.term);
  });

  it("garde l'image avec la définition, quel que soit le sens", () => {
    // L'image a été déposée à côté de la définition dans l'éditeur : l'en
    // détacher viderait la face qu'elle illustrait.
    assert.equal(facesOf(carte, "term").answerImage, "schema.webp");
    assert.equal(facesOf(carte, "term").questionImage, null);
    assert.equal(facesOf(carte, "definition").questionImage, "schema.webp");
    assert.equal(facesOf(carte, "definition").answerImage, null);
  });

  it("ne perd aucune face : les deux sens couvrent le même contenu", () => {
    for (const sens of ["term", "definition"] as StudySide[]) {
      const faces = facesOf(carte, sens);
      assert.deepEqual(
        [faces.question, faces.answer].sort(),
        [carte.term, carte.definition].sort(),
        sens,
      );
      // Une seule des deux faces porte l'image, jamais les deux.
      assert.equal(
        [faces.questionImage, faces.answerImage].filter(Boolean).length,
        1,
        sens,
      );
    }
  });

  it("supporte une carte sans image", () => {
    const faces = facesOf({ ...carte, imagePath: null }, "definition");
    assert.equal(faces.questionImage, null);
    assert.equal(faces.answerImage, null);
  });
});
