import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_IMPORT_CARDS,
  detectSeparators,
  parseImport,
  type ImportOptions,
} from "@/lib/import";

const parse = (raw: string, o: ImportOptions) => parseImport(raw, o).cards;
const tab: ImportOptions = { termSeparator: "tab", cardSeparator: "newline" };
const auto = (raw: string) => {
  const options = detectSeparators(raw);
  return options ? parseImport(raw, options).cards : null;
};

describe("parseImport — formats courants", () => {
  it("lit l'export Quizlet par défaut", () => {
    assert.deepEqual(parse("mitose\tDivision\nméiose\tRéduction", tab), [
      { term: "mitose", definition: "Division" },
      { term: "méiose", definition: "Réduction" },
    ]);
  });

  it("ne coupe qu'à la première occurrence du séparateur", () => {
    // Sinon une définition contenant une virgule serait tronquée.
    assert.deepEqual(
      parse("mitose,Division en deux cellules, identiques", {
        termSeparator: "comma",
        cardSeparator: "newline",
      }),
      [{ term: "mitose", definition: "Division en deux cellules, identiques" }],
    );
  });

  it("comprend les champs CSV entre guillemets", () => {
    assert.deepEqual(
      parse('"mitose","Division, en deux temps"', {
        termSeparator: "comma",
        cardSeparator: "newline",
      }),
      [{ term: "mitose", definition: "Division, en deux temps" }],
    );
  });

  it("rétablit les guillemets doublés", () => {
    assert.deepEqual(
      parse('"le mot ""clé""","Un terme"', { termSeparator: "comma", cardSeparator: "newline" }),
      [{ term: 'le mot "clé"', definition: "Un terme" }],
    );
  });

  it("gère les réponses sur plusieurs lignes", () => {
    assert.deepEqual(
      parse("mitose\tPhase 1\nPhase 2\n\nméiose\tRéduction", {
        termSeparator: "tab",
        cardSeparator: "blankline",
      }),
      [
        { term: "mitose", definition: "Phase 1\nPhase 2" },
        { term: "méiose", definition: "Réduction" },
      ],
    );
  });

  it("absorbe les fins de ligne Windows et les lignes vides", () => {
    assert.deepEqual(parse("a\tb\r\n\r\nc\td\r\n", tab), [
      { term: "a", definition: "b" },
      { term: "c", definition: "d" },
    ]);
  });
});

describe("parseImport — cas limites", () => {
  it("met de côté les lignes sans séparateur et les remonte", () => {
    const result = parseImport("a\tb\nligne seule\nc\td", tab);
    assert.equal(result.cards.length, 2);
    assert.deepEqual(result.skipped, ["ligne seule"]);
  });

  it("ignore une ligne dont un des deux champs est vide", () => {
    assert.deepEqual(parseImport("a\t\n\tb", tab).cards, []);
  });

  it("ne renvoie rien sur une entrée vide", () => {
    assert.deepEqual(parseImport("   ", tab).cards, []);
  });

  it("ne renvoie rien si le séparateur personnalisé est vide", () => {
    assert.deepEqual(
      parseImport("a::b", { termSeparator: "custom", cardSeparator: "newline", customTerm: "" })
        .cards,
      [],
    );
  });

  it("accepte des séparateurs personnalisés", () => {
    assert.deepEqual(
      parse("a::b;;;c::d", {
        termSeparator: "custom",
        cardSeparator: "custom",
        customTerm: "::",
        customCard: ";;;",
      }),
      [
        { term: "a", definition: "b" },
        { term: "c", definition: "d" },
      ],
    );
  });
});

describe("detectSeparators", () => {
  it("reconnaît la tabulation, le tiret et le point-virgule", () => {
    assert.deepEqual(auto("a\tb\nc\td"), [
      { term: "a", definition: "b" },
      { term: "c", definition: "d" },
    ]);
    assert.deepEqual(auto("to give up - abandonner\nto put off - reporter"), [
      { term: "to give up", definition: "abandonner" },
      { term: "to put off", definition: "reporter" },
    ]);
    assert.equal(detectSeparators("a;b\nc;d")?.termSeparator, "semicolon");
  });

  it("préfère la tabulation à une virgule présente dans le texte", () => {
    assert.equal(
      detectSeparators("mitose\tDivision, en deux temps\nméiose\tRéduction, longue")
        ?.termSeparator,
      "tab",
    );
  });

  it("choisit la ligne vide quand les réponses sont multilignes", () => {
    assert.equal(
      detectSeparators("mitose\tPhase 1\nPhase 2\n\nméiose\tRéduction")?.cardSeparator,
      "blankline",
    );
  });

  it("préfère ne rien deviner plutôt que de couper au mauvais endroit", () => {
    assert.equal(detectSeparators("juste du texte\nsans rien"), null);
    assert.equal(detectSeparators("   "), null);
    // Sous 80 % de lignes exploitées, le format n'est pas celui-là.
    assert.equal(detectSeparators("a\tb\nligne\nautre\nencore\net une"), null);
  });
});

describe("limites", () => {
  it("plafonne un import à 1000 cartes", () => {
    assert.equal(MAX_IMPORT_CARDS, 1000);
  });
});
