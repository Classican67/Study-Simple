import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_STUDY_ORDER,
  isStudyOrder,
  orderCards,
  reorderQueue,
} from "@/lib/study-order";

const card = (id: string) => ({ id });
const paquet = ["a", "b", "c", "d", "e"].map(card);
const ids = (cards: { id: string }[]) => cards.map((c) => c.id);

describe("orderCards", () => {
  it("conserve l'ordre du paquet", () => {
    assert.deepEqual(ids(orderCards(paquet, "deck")), ["a", "b", "c", "d", "e"]);
  });

  it("mélange sans rien perdre ni rien ajouter", () => {
    const melange = orderCards(paquet, "shuffle");
    assert.equal(melange.length, paquet.length);
    assert.deepEqual(ids(melange).sort(), ids(paquet).sort());
  });

  it("ne modifie jamais le tableau reçu", () => {
    const original = [...paquet];
    orderCards(paquet, "shuffle");
    assert.deepEqual(paquet, original);
  });

  it("supporte une liste vide", () => {
    assert.deepEqual(orderCards([], "shuffle"), []);
    assert.deepEqual(orderCards([], "deck"), []);
  });
});

describe("reorderQueue", () => {
  const reference = ids(paquet);

  it("ne change jamais la carte affichée", () => {
    // Elle est sous les yeux de l'utilisateur : la remplacer serait déroutant.
    const file = [card("d"), card("a"), card("c")];
    for (const ordre of ["deck", "shuffle"] as const) {
      assert.equal(reorderQueue(file, reference, ordre)[0].id, "d", ordre);
    }
  });

  it("restaure vraiment l'ordre du paquet, même depuis une file mélangée", () => {
    // Le point délicat : se fier à la file courante ne ferait que figer le
    // mélange déjà appliqué.
    const melangee = [card("c"), card("e"), card("a"), card("b")];
    assert.deepEqual(ids(reorderQueue(melangee, reference, "deck")), ["c", "a", "b", "e"]);
  });

  it("ne fait revenir aucune carte déjà répondue", () => {
    const file = [card("c"), card("e")];
    const resultat = reorderQueue(file, reference, "deck");
    assert.equal(resultat.length, 2);
    assert.deepEqual(ids(resultat).sort(), ["c", "e"]);
  });

  it("conserve toutes les cartes en mélangeant", () => {
    const file = [card("b"), card("a"), card("d"), card("e")];
    const resultat = reorderQueue(file, reference, "shuffle");
    assert.equal(resultat[0].id, "b");
    assert.deepEqual(ids(resultat).sort(), ["a", "b", "d", "e"]);
  });

  it("supporte les files de zéro et une carte", () => {
    assert.deepEqual(reorderQueue([], reference, "deck"), []);
    assert.deepEqual(ids(reorderQueue([card("a")], reference, "shuffle")), ["a"]);
  });

  it("place en fin les cartes absentes de la référence", () => {
    // Cas d'une carte ajoutée pendant la session : elle ne doit pas s'insérer
    // arbitrairement en tête.
    const file = [card("a"), card("inconnue"), card("b")];
    assert.deepEqual(ids(reorderQueue(file, reference, "deck")), ["a", "b", "inconnue"]);
  });

  it("ne modifie jamais la file reçue", () => {
    const file = [card("c"), card("a"), card("b")];
    const copie = [...file];
    reorderQueue(file, reference, "shuffle");
    assert.deepEqual(file, copie);
  });
});

describe("préférence", () => {
  it("valide les valeurs acceptées", () => {
    assert.equal(isStudyOrder("deck"), true);
    assert.equal(isStudyOrder("shuffle"), true);
    assert.equal(isStudyOrder("autre"), false);
    assert.equal(isStudyOrder(null), false);
  });

  it("mélange par défaut", () => {
    // Meilleur pour mémoriser : sans mélange, on apprend la séquence.
    assert.equal(DEFAULT_STUDY_ORDER, "shuffle");
  });
});
