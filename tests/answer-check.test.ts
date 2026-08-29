import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { checkAnswer, editDistance, normalize } from "@/lib/answer-check";

describe("normalize", () => {
  it("retire accents, casse, ponctuation et espaces superflus", () => {
    assert.equal(normalize("L'Élève, à côté !"), "eleve a cote");
    assert.equal(normalize("  MITOSE  "), "mitose");
  });

  it("retire l'article initial", () => {
    assert.equal(normalize("la mitose"), "mitose");
    assert.equal(normalize("the answer"), "answer");
    // Mais pas un mot qui commence par les mêmes lettres.
    assert.equal(normalize("lambda"), "lambda");
  });

  it("ignore le balisage de mise en forme", () => {
    assert.equal(normalize("**mitose**"), "mitose");
    assert.equal(normalize("{c:rose}mitose{/c}"), "mitose");
  });
});

describe("editDistance", () => {
  it("mesure les insertions, suppressions et substitutions", () => {
    assert.equal(editDistance("chat", "chat"), 0);
    assert.equal(editDistance("chat", "chats"), 1);
    assert.equal(editDistance("chat", "chien"), 3);
    assert.equal(editDistance("", "abc"), 3);
    assert.equal(editDistance("abc", ""), 3);
  });
});

describe("checkAnswer — réponses acceptées", () => {
  const accepte = (typed: string, expected: string) =>
    assert.notEqual(checkAnswer(typed, expected), "wrong", `« ${typed} » pour « ${expected} »`);

  it("accepte une réponse identique quelle que soit la présentation", () => {
    assert.equal(checkAnswer("mitose", "mitose"), "exact");
    assert.equal(checkAnswer("MITOSE", "mitose"), "exact");
    assert.equal(checkAnswer("  mitose. ", "mitose"), "exact");
    assert.equal(checkAnswer("la mitose", "mitose"), "exact");
  });

  it("ignore les accents", () => {
    accepte("referencé", "référence");
    accepte("eleve", "élève");
  });

  it("accepte n'importe laquelle des variantes séparées par une barre", () => {
    assert.equal(checkAnswer("abandonner", "abandonner / renoncer"), "exact");
    assert.equal(checkAnswer("renoncer", "abandonner / renoncer"), "exact");
  });

  it("tolère une faute de frappe", () => {
    assert.equal(checkAnswer("mithose", "mitose"), "close");
    assert.equal(
      checkAnswer(
        "division celulaire produisant deux cellules identiques",
        "Division cellulaire produisant deux cellules identiques",
      ),
      "close",
    );
  });
});

describe("checkAnswer — réponses refusées", () => {
  it("refuse un mot voisin mais différent", () => {
    // Le cas qui compte : sans lui, l'exercice ne vaudrait rien.
    assert.equal(checkAnswer("méiose", "mitose"), "wrong");
    assert.equal(checkAnswer("apoptose", "mitose"), "wrong");
  });

  it("n'accorde aucune tolérance sur un mot très court", () => {
    // Une faute sur trois lettres change le sens.
    assert.equal(checkAnswer("sud", "sur"), "wrong");
  });

  it("refuse une réponse vide", () => {
    assert.equal(checkAnswer("", "mitose"), "wrong");
    assert.equal(checkAnswer("   ", "mitose"), "wrong");
  });
});
