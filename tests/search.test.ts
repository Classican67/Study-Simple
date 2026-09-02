import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildSearchText,
  excerpt,
  highlight,
  normalizeForSearch,
  scoreCard,
  searchTerms,
} from "@/lib/search";

describe("normalizeForSearch", () => {
  it("retire accents et majuscules", () => {
    assert.equal(normalizeForSearch("L'Élève À Côté"), "l'eleve a cote");
    assert.equal(normalizeForSearch("MITOSE"), "mitose");
  });

  it("retire le balisage de mise en forme", () => {
    // Sinon chercher « gras » remonterait toutes les cartes qui en contiennent.
    assert.equal(normalizeForSearch("**mitose**"), "mitose");
    assert.equal(normalizeForSearch("{c:rose}danger{/c}"), "danger");
    assert.equal(normalizeForSearch("`code`"), "code");
  });

  it("réduit les espaces", () => {
    assert.equal(normalizeForSearch("  a   b  "), "a b");
  });
});

describe("searchTerms", () => {
  it("découpe la requête en mots", () => {
    assert.deepEqual(searchTerms("cellule Division"), ["cellule", "division"]);
    assert.deepEqual(searchTerms("   "), []);
  });
});

describe("scoreCard", () => {
  const carte = (term: string, definition = "") => ({ term, definition });

  it("exige que tous les mots soient présents", () => {
    // Un « et » plutôt qu'un « ou » : bien plus précis sur un gros paquet.
    const c = carte("Mitose", "Division cellulaire");
    assert.ok(scoreCard(c, ["mitose", "division"]) > 0);
    assert.equal(scoreCard(c, ["mitose", "absent"]), 0);
  });

  it("classe le terme avant la définition", () => {
    const dansLeTerme = carte("Mitose", "autre chose");
    const dansLaDefinition = carte("Autre", "il s'agit de mitose");
    assert.ok(scoreCard(dansLeTerme, ["mitose"]) > scoreCard(dansLaDefinition, ["mitose"]));
  });

  it("classe un préfixe avant une occurrence au milieu", () => {
    const prefixe = carte("Mitochondrie");
    const milieu = carte("La mitochondrie en détail");
    assert.ok(scoreCard(prefixe, ["mito"]) > scoreCard(milieu, ["mito"]));
  });

  it("départage à égalité par la longueur du terme", () => {
    const court = carte("Mitose");
    const long = carte("Mitose et méiose comparées en détail");
    assert.ok(scoreCard(court, ["mitose"]) > scoreCard(long, ["mitose"]));
  });

  it("ignore les accents des deux côtés", () => {
    assert.ok(scoreCard(carte("Élève"), ["eleve"]) > 0);
    assert.ok(scoreCard(carte("Eleve"), ["élève"]) > 0);
  });

  it("renvoie zéro sans requête", () => {
    assert.equal(scoreCard(carte("Mitose"), []), 0);
  });
});

describe("highlight", () => {
  const texte = (segments: { text: string; match: boolean }[]) =>
    segments.map((s) => (s.match ? `[${s.text}]` : s.text)).join("");

  it("met en évidence l'occurrence", () => {
    assert.equal(texte(highlight("La mitose est rapide", ["mitose"])), "La [mitose] est rapide");
  });

  it("souligne le texte d'origine, accents compris", () => {
    // On tape sans accent, mais l'affichage doit rester fidèle.
    assert.equal(texte(highlight("L'élève arrive", ["eleve"])), "L'[élève] arrive");
  });

  it("gère plusieurs occurrences et plusieurs mots", () => {
    assert.equal(texte(highlight("a b a", ["a"])), "[a] b [a]");
    assert.equal(texte(highlight("mitose et meiose", ["mitose", "meiose"])), "[mitose] et [meiose]");
  });

  it("fusionne les intervalles qui se chevauchent", () => {
    // « mito » et « mitose » se recouvrent : un seul surlignage, pas deux collés.
    const segments = highlight("mitose", ["mito", "mitose"]);
    assert.equal(segments.filter((s) => s.match).length, 1);
    assert.equal(texte(segments), "[mitose]");
  });

  it("renvoie le texte intact sans correspondance", () => {
    assert.deepEqual(highlight("rien", ["absent"]), [{ text: "rien", match: false }]);
    assert.deepEqual(highlight("rien", []), [{ text: "rien", match: false }]);
  });
});

describe("excerpt", () => {
  it("laisse un texte court intact", () => {
    assert.equal(excerpt("court", ["court"]), "court");
  });

  it("recentre autour de l'occurrence dans un texte long", () => {
    const long = `${"a".repeat(300)} mitose ${"b".repeat(300)}`;
    const result = excerpt(long, ["mitose"]);
    assert.ok(result.includes("mitose"), result.slice(0, 40));
    assert.ok(result.startsWith("…"), "le début coupé est signalé");
    assert.ok(result.length < 200, `longueur ${result.length}`);
  });
});

describe("buildSearchText", () => {
  it("réunit les deux faces, normalisées", () => {
    assert.equal(buildSearchText("**Mitose**", "Division {c:rose}cellulaire{/c}"),
      "mitose division cellulaire");
  });
});

describe("normalisation des lettres composées", () => {
  // Copier depuis un PDF de cours produit couramment des ligatures
  // typographiques : la carte devenait alors introuvable en tapant le mot
  // normalement, sans que rien ne le signale.
  it("ramène la ligature typographique ﬁ à fi", () => {
    assert.equal(normalizeForSearch("ﬁche"), "fiche");
    assert.equal(searchTerms("ﬁche")[0], "fiche");
  });

  it("ramène les caractères pleine chasse à l'ASCII", () => {
    assert.equal(normalizeForSearch("ＭＩＴＯＳＥ"), "mitose");
  });

  it("traite les lettres qu'Unicode ne décompose pas", () => {
    // « cœur » et « coeur » doivent se trouver l'un l'autre — le cas le plus
    // probable dans une app francophone.
    assert.equal(normalizeForSearch("Cœur"), "coeur");
    assert.equal(normalizeForSearch("Ex æquo"), "ex aequo");
    assert.equal(normalizeForSearch("Straße"), "strasse");
  });

  it("indexe et cherche la même forme", () => {
    const indexed = buildSearchText("Cœur", "Organe ﬁbreux");
    for (const query of ["coeur", "cœur", "fibreux", "ﬁbreux"]) {
      assert.ok(
        searchTerms(query).every((needle) => indexed.includes(needle)),
        `« ${query} » devrait se retrouver dans « ${indexed} »`,
      );
    }
  });
});

describe("highlight : alignement sur le texte d'origine", () => {
  // Invariant fondamental : le surlignage ne doit jamais altérer le texte.
  const textes = [
    "Élève modèle",
    "ﬁche de cours",
    "Cœur",
    "a🧬b mitose",
    "e\u0301lan", // accent détaché
    "\u00e9lan", // accent précomposé
    "Straße",
  ];
  const requetes = ["eleve", "fiche", "coeur", "mitose", "elan", "strasse"];

  it("les segments reconstituent toujours le texte", () => {
    for (const texte of textes) {
      for (const requete of requetes) {
        const segments = highlight(texte, searchTerms(requete));
        assert.equal(segments.map((s) => s.text).join(""), texte, `${texte} / ${requete}`);
      }
    }
  });

  it("surligne malgré une lettre qui se dédouble", () => {
    // « ﬁ » produit deux caractères repliés pour un seul caractère d'origine.
    // La version précédente tronquait à un seul, décalait le texte replié, et
    // le surlignage disparaissait alors que la carte, elle, ressortait.
    const segments = highlight("ﬁche de cours", searchTerms("fiche"));
    assert.deepEqual(
      segments.filter((s) => s.match).map((s) => s.text),
      ["ﬁche"],
    );
  });

  it("n'abandonne pas un accent détaché hors du surlignage", () => {
    // « é » écrit en deux caractères, le second ne produisant rien au repli.
    // Échappé explicitement : écrit tel quel, un éditeur pourrait recomposer
    // la lettre et vider ce test de son objet sans que rien ne le montre.
    const decompose = "e\u0301lan vital";
    assert.equal(decompose.length, 11);
    const segments = highlight(decompose, searchTerms("elan"));
    assert.deepEqual(
      segments.filter((s) => s.match).map((s) => s.text),
      ["e\u0301lan"],
    );
  });

  it("surligne une lettre non décomposée par Unicode", () => {
    const segments = highlight("Cœur", searchTerms("coeur"));
    assert.deepEqual(
      segments.filter((s) => s.match).map((s) => s.text),
      ["Cœur"],
    );
  });
});
