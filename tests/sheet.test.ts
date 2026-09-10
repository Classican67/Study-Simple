import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  columnIndex,
  columnName,
  evaluateSheet,
  isFormula,
  parseNumber,
  parseRef,
  type Sheet,
} from "@/lib/sheet";

/** Évalue une grille et renvoie le texte affiché, plus lisible dans un test. */
function shown(sheet: Sheet): string[][] {
  return evaluateSheet(sheet).map((row) => row.map((cell) => cell.text));
}

describe("noms de colonnes", () => {
  it("va de A à AA et revient", () => {
    assert.equal(columnName(0), "A");
    assert.equal(columnName(25), "Z");
    assert.equal(columnName(26), "AA");
    assert.equal(columnName(701), "ZZ");
    for (const i of [0, 3, 25, 26, 27, 51, 52, 701, 702]) {
      assert.equal(columnIndex(columnName(i)), i, `rang ${i}`);
    }
  });
});

describe("parseRef", () => {
  it("lit une référence", () => {
    assert.deepEqual(parseRef("A1"), { row: 0, col: 0 });
    assert.deepEqual(parseRef("b3"), { row: 2, col: 1 });
    assert.deepEqual(parseRef("AA10"), { row: 9, col: 26 });
  });

  it("refuse ce qui n'en est pas une", () => {
    for (const mauvais of ["", "A", "1", "A0", "1A", "A1B", " "]) {
      assert.equal(parseRef(mauvais), null, mauvais);
    }
  });
});

describe("parseNumber", () => {
  it("accepte la virgule décimale du clavier français", () => {
    assert.equal(parseNumber("3,5"), 3.5);
    assert.equal(parseNumber("3.5"), 3.5);
    assert.equal(parseNumber("-2"), -2);
    assert.equal(parseNumber(" 42 "), 42);
  });

  it("rejette ce qui n'est pas un nombre", () => {
    for (const texte of ["", "abc", "1a", "1,2,3", "--1"]) {
      assert.equal(parseNumber(texte), null, texte);
    }
  });
});

describe("isFormula", () => {
  it("reconnaît une formule même précédée d'espaces", () => {
    assert.equal(isFormula("=1+1"), true);
    assert.equal(isFormula("  =A1"), true);
    assert.equal(isFormula("1+1"), false);
  });
});

describe("évaluation", () => {
  it("laisse le texte tel quel", () => {
    assert.deepEqual(shown([["Mitose", "3,5"]]), [["Mitose", "3,5"]]);
  });

  it("calcule l'arithmétique et respecte les priorités", () => {
    assert.deepEqual(shown([["=2+3*4"]]), [["14"]]);
    assert.deepEqual(shown([["=(2+3)*4"]]), [["20"]]);
    assert.deepEqual(shown([["=-3+1"]]), [["-2"]]);
    assert.deepEqual(shown([["=10/4"]]), [["2.5"]]);
  });

  it("arrondit ce que le binaire écorne", () => {
    // Sans arrondi d'affichage, 0.1 + 0.2 donnerait 0.30000000000000004.
    assert.deepEqual(shown([["=0.1+0.2"]]), [["0.3"]]);
  });

  it("suit les références", () => {
    assert.deepEqual(shown([["2", "3", "=A1+B1"]]), [["2", "3", "5"]]);
  });

  it("enchaîne les références", () => {
    const sheet = [["2"], ["=A1*3"], ["=A2+1"]];
    assert.deepEqual(shown(sheet), [["2"], ["6"], ["7"]]);
  });

  it("somme une plage, dans les deux sens", () => {
    const sheet = [["1"], ["2"], ["3"], ["=SOMME(A1:A3)"], ["=SOMME(A3:A1)"]];
    assert.deepEqual(shown(sheet), [["1"], ["2"], ["3"], ["6"], ["6"]]);
  });

  it("connaît moyenne, min, max et nb", () => {
    const sheet: Sheet = [
      ["2", "4", "6"],
      ["=MOYENNE(A1:C1)", "=MIN(A1:C1)", "=MAX(A1:C1)"],
      ["=NB(A1:C1)", "=SOMME(A1;C1)", "=SOMME()"],
    ];
    assert.deepEqual(shown(sheet), [
      ["2", "4", "6"],
      ["4", "2", "6"],
      ["3", "8", "0"],
    ]);
  });

  it("accepte les noms anglais", () => {
    assert.deepEqual(shown([["1", "2", "=SUM(A1:B1)"]]), [["1", "2", "3"]]);
  });

  it("traite une cellule vide comme zéro dans une somme", () => {
    assert.deepEqual(shown([["1"], [""], ["=SOMME(A1:A2)"]]), [["1"], [""], ["1"]]);
  });

  it("signale du texte pris dans un calcul", () => {
    // Un zéro silencieux ferait passer une erreur de saisie pour un résultat.
    assert.deepEqual(shown([["abc"], ["=A1+1"]]), [["abc"], ["#VAL"]]);
  });

  it("signale une division par zéro", () => {
    assert.deepEqual(shown([["=1/0"]]), [["#DIV0"]]);
    assert.deepEqual(shown([["0"], ["=1/A1"]]), [["0"], ["#DIV0"]]);
  });

  it("signale une référence hors de la grille", () => {
    assert.deepEqual(shown([["=A9"]]), [["#REF"]]);
  });

  it("signale une fonction inconnue et une syntaxe fautive", () => {
    assert.deepEqual(shown([["=TRUC(1;2)"]]), [["#NOM"]]);
    assert.deepEqual(shown([["=1+"]]), [["#ERR"]]);
    assert.deepEqual(shown([["=(1"]]), [["#ERR"]]);
    assert.deepEqual(shown([["=1 2"]]), [["#ERR"]]);
  });

  it("détecte un cycle plutôt que d'épuiser la pile", () => {
    assert.deepEqual(shown([["=A1"]]), [["#CYCLE"]]);
    // Cycle indirect : A1 → B1 → A1.
    assert.deepEqual(shown([["=B1", "=A1"]]), [["#CYCLE", "#CYCLE"]]);
  });

  it("propage l'erreur sans contaminer le reste de la grille", () => {
    const sheet: Sheet = [
      ["1", "=1/0", "=B1+1"],
      ["2", "3", "=SOMME(A1;A2)"],
    ];
    assert.deepEqual(shown(sheet), [
      ["1", "#DIV0", "#DIV0"],
      ["2", "3", "3"],
    ]);
  });

  it("rend une grille rectangulaire même si les lignes sont inégales", () => {
    // Les lignes courtes viennent d'un tableau dont on a ajouté une colonne.
    const valeurs = evaluateSheet([["1", "2"], ["3"]]);
    assert.equal(valeurs[1].length, 2);
    assert.equal(valeurs[1][1].text, "");
  });
});
