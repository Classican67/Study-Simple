import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { JSDOM } from "jsdom";

import { markupToHtml, parseMarkup, toPlainText } from "@/components/rich-text";
import { serializeEditor } from "@/lib/balisage-dom";
import {
  blocsDuPressePapiers,
  contenuDuBloc,
  couleurProche,
  grilleDuPressePapiers,
  htmlVersBlocs,
  tableEnLignes,
  texteVersBlocs,
} from "@/lib/collage";
import { blocPourPresse } from "@/lib/copie-bloc";
import { parseTable, parseText } from "@/lib/notes";

let dom: JSDOM;
let parser: DOMParser;

before(() => {
  dom = new JSDOM("<!doctype html><body></body>", { url: "https://fiches.test/" });
  (globalThis as unknown as { Node: unknown }).Node = dom.window.Node;
  parser = new dom.window.DOMParser();
});
after(() => dom.window.close());

const html = (source: string) => htmlVersBlocs(source, parser);
const markup = (source: string) => {
  const blocs = html(source);
  assert.equal(blocs.length, 1, JSON.stringify(blocs));
  assert.equal(blocs[0].kind, "text");
  return (blocs[0] as { markup: string }).markup;
};

/** Le balisage rouvert dans l'éditeur, puis réenregistré. */
const reouvert = (m: string) => {
  const racine = dom.window.document.createElement("div");
  racine.innerHTML = markupToHtml(m);
  return serializeEditor(racine as unknown as HTMLElement);
};

describe("collage d'une page web", () => {
  it("garde titres, gras et italique", () => {
    assert.equal(
      markup("<h1>Le rein</h1><p>Un <strong>filtre</strong> et une <em>glande</em>.</p>"),
      "# Le rein\nUn **filtre** et une _glande_.",
    );
  });

  it("garde les rangs de titres, et ramène les plus bas au troisième", () => {
    assert.equal(markup("<h2>A</h2><h3>B</h3><h5>C</h5>"), "## A\n### B\n### C");
  });

  it("garde les listes imbriquées", () => {
    assert.equal(
      markup("<ul><li>Un<ul><li>Un point un</li></ul></li><li>Deux</li></ul>"),
      "- Un\n  - Un point un\n- Deux",
    );
  });

  it("garde les listes numérotées", () => {
    assert.equal(markup("<ol><li>a</li><li>b</li></ol>"), "1. a\n2. b");
  });

  it("le rangement d'une page web ne laisse pas de lignes vides", () => {
    assert.equal(
      markup(`<section>
        <article>
          <div><p>Premier</p></div>
          <div><p>Second</p></div>
        </article>
      </section>`),
      "Premier\nSecond",
    );
  });

  it("les retours à la ligne de la source ne sont pas des retours à la ligne", () => {
    assert.equal(markup("<p>un\n     deux</p>"), "un deux");
  });

  it("rien de ce qui n'est pas du contenu n'entre", () => {
    assert.equal(
      markup('<style>p{color:red}</style><script>alert(1)</script><p onclick="x()">Texte</p><img src="x.png">'),
      "Texte",
    );
  });

  it("un lien garde son texte", () => {
    assert.equal(markup('<p>voir <a href="https://x.test">ce cours</a></p>'), "voir ce cours");
  });

  it("une citation reste à part, et `> 65 ans` reste du texte", () => {
    assert.equal(markup("<blockquote>Primum non nocere</blockquote>"), "_Primum non nocere_");
    assert.equal(parseMarkup("> 65 ans")[0].kind, "paragraph");
  });

  it("le code garde ses lignes", () => {
    assert.equal(markup("<pre>a = 1\nb = 2</pre>"), "`a = 1`\n`b = 2`");
  });

  it("ce qui ressemble à du balisage reste du texte", () => {
    assert.equal(markup("<p>5*3*2 et {c:rose}</p>"), "5\\*3\\*2 et \\{c:rose\\}");
  });
});

describe("collage depuis Word", () => {
  const liste = (niveau: number, puce: string, texte: string) =>
    `<p class=MsoListParagraph style='mso-list:l0 level${niveau} lfo1'><![if !supportLists]><span style='mso-list:Ignore'>${puce}<span>&nbsp;</span></span><![endif]><span>${texte}</span></p>`;

  it("refait de vraies listes, sans doubler la puce", () => {
    assert.equal(
      markup(liste(1, "·", "Rein") + liste(2, "o", "Néphron") + liste(1, "·", "Foie")),
      "- Rein\n  - Néphron\n- Foie",
    );
  });

  it("reconnaît une liste numérotée à sa puce écrite en texte", () => {
    assert.equal(markup(liste(1, "1.", "Un") + liste(1, "2.", "Deux")), "1. Un\n2. Deux");
  });

  it("le texte qui suit une liste n'y entre pas", () => {
    assert.equal(
      markup(`${liste(1, "·", "Rein")}<p class=MsoNormal>Conclusion</p>`),
      "- Rein\nConclusion",
    );
  });
});

describe("collage depuis Google Docs", () => {
  it("son enveloppe ne met pas tout le document en gras", () => {
    assert.equal(
      markup('<b style="font-weight:normal" id="docs-internal-guid-1"><p><span>Texte</span></p></b>'),
      "Texte",
    );
  });

  it("son vrai gras, porté par un span, reste du gras", () => {
    assert.equal(
      markup('<p><span style="font-weight:700">Rein</span> <span style="font-style:italic">sain</span></p>'),
      "**Rein** _sain_",
    );
  });
});

describe("couleurs", () => {
  it("ramène une couleur à la plus proche des nôtres", () => {
    assert.equal(couleurProche("#c00000"), "rose");
    assert.equal(couleurProche("rgb(0, 112, 192)"), "blue");
    assert.equal(couleurProche("#00b050"), "emerald");
    assert.equal(couleurProche("#7030a0"), "violet");
    assert.equal(couleurProche("#ffa500"), "amber");
  });

  it("le noir et le gris d'un corps de texte ne teintent rien", () => {
    for (const neutre of ["#000000", "#333333", "rgb(68, 68, 68)", "#ffffff", "inherit", ""]) {
      assert.equal(couleurProche(neutre), null, neutre);
    }
  });

  it("le collage transcrit la couleur", () => {
    assert.equal(markup('<p><span style="color:#c00000">Danger</span></p>'), "{c:rose}Danger{/c}");
  });
});

describe("tableaux", () => {
  const table = "<table><tr><th>Organe</th><th>Rôle</th></tr><tr><td>Rein</td><td>Filtre</td></tr></table>";

  it("un tableau reste un tableau, à sa place dans le texte", () => {
    assert.deepEqual(html(`<p>Avant</p>${table}<p>Après</p>`), [
      { kind: "text", markup: "Avant" },
      { kind: "table", rows: [["Organe", "Rôle"], ["Rein", "Filtre"]] },
      { kind: "text", markup: "Après" },
    ]);
  });

  it("les cellules fusionnées sont déroulées", () => {
    const blocs = html(
      '<table><tr><td colspan="2">Titre</td></tr><tr><td rowspan="2">A</td><td>1</td></tr><tr><td>2</td></tr></table>',
    );
    assert.deepEqual(blocs[0], {
      kind: "table",
      rows: [["Titre", ""], ["A", "1"], ["", "2"]],
    });
  });

  it("un tableau de mise en page n'en est pas un", () => {
    assert.deepEqual(html("<table><tr><td>Seul</td></tr></table>"), [{ kind: "text", markup: "Seul" }]);
  });

  it("un tableau trop grand est ramené aux bornes", () => {
    const lignes = Array.from({ length: 90 }, () => `<tr>${"<td>x</td>".repeat(20)}</tr>`).join("");
    const bloc = html(`<table>${lignes}</table>`)[0] as { rows: string[][] };
    assert.equal(bloc.rows.length, 60);
    assert.equal(bloc.rows[0].length, 12);
  });

  it("une feuille de calcul colle des tabulations", () => {
    assert.deepEqual(texteVersBlocs("a\tb\nc\td"), [{ kind: "table", rows: [["a", "b"], ["c", "d"]] }]);
  });

  it("Markdown aussi a ses tableaux", () => {
    assert.deepEqual(texteVersBlocs("| a | b |\n|---|---|\n| 1 | 2 |"), [
      { kind: "table", rows: [["a", "b"], ["1", "2"]] },
    ]);
  });

  it("une carte n'a pas de tableau : il devient des lignes", () => {
    assert.equal(tableEnLignes([["Rein", "Filtre"]]), "- Rein — Filtre");
  });
});

describe("texte brut", () => {
  it("une puce écrite à la main devient une vraie liste", () => {
    assert.deepEqual(texteVersBlocs("• un\n• deux"), [{ kind: "text", markup: "- un\n- deux" }]);
  });

  it("garde l'imbrication", () => {
    assert.deepEqual(texteVersBlocs("- a\n    - b"), [{ kind: "text", markup: "- a\n  - b" }]);
  });

  it("du Markdown garde son gras et ses titres", () => {
    assert.deepEqual(texteVersBlocs("# Titre\n**gras** et texte"), [
      { kind: "text", markup: "# Titre\n**gras** et texte" },
    ]);
  });

  it("du texte ordinaire garde ses étoiles", () => {
    assert.deepEqual(texteVersBlocs("5*3 = 15"), [{ kind: "text", markup: "5\\*3 = 15" }]);
  });

  it("le HTML prime, et le texte le remplace quand il ne donne rien", () => {
    assert.deepEqual(blocsDuPressePapiers("<p></p>", "secours", parser), [{ kind: "text", markup: "secours" }]);
    assert.deepEqual(blocsDuPressePapiers("<p>riche</p>", "pauvre", parser), [{ kind: "text", markup: "riche" }]);
  });
});

describe("longs textes", () => {
  it("un chapitre se répartit sur plusieurs blocs, sans rien perdre", () => {
    const lignes = Array.from({ length: 900 }, (_, i) => `Ligne numéro ${i} ${"x".repeat(40)}`);
    const blocs = texteVersBlocs(lignes.join("\n"));
    assert.ok(blocs.length >= 2);
    const relu = blocs.map((b) => (b as { markup: string }).markup).join("\n");
    assert.equal(relu, lignes.join("\n"));
  });

  it("un bloc collé se relit en entier", () => {
    const long = "mot ".repeat(10_000).trim();
    assert.equal(parseText(JSON.stringify({ style: "p", markup: long })).markup.length, long.length);
  });
});

describe("le collage survit à la réouverture", () => {
  for (const [nom, source] of [
    ["titres", "# Un\n## Deux\n### Trois"],
    ["liste imbriquée", "- a\n  - b\n    - c\n- d"],
    ["liste mêlée", "1. a\n  - b\n2. c"],
    ["mise en forme", "**gras** _italique_ ~~barré~~ {c:rose}rouge{/c}"],
    ["texte puis liste", "Introduction\n- a\n- b"],
  ] as const) {
    it(nom, () => assert.equal(reouvert(source), source));
  }

  it("un titre rouvert reste un titre, pas du gras", () => {
    assert.equal(parseMarkup(reouvert("## Rein"))[0].kind, "heading");
  });

  it("une liste plate garde sa forme d'avant", () => {
    assert.deepEqual(parseMarkup("- a\n- b")[0], {
      kind: "bullets",
      items: [[{ kind: "text", value: "a" }], [{ kind: "text", value: "b" }]],
    });
  });

  it("deux listes de genres différents restent deux listes", () => {
    assert.deepEqual(parseMarkup("- a\n1. b").map((b) => b.kind), ["bullets", "numbers"]);
  });

  it("le texte brut d'une liste imbriquée reste lisible", () => {
    assert.equal(toPlainText("- a\n  - b"), "• a\n• b");
  });
});

describe("copier un bloc", () => {
  it("un texte part en HTML, et se recolle à l'identique", () => {
    const source = "## Rein\n- a\n  - b";
    const contenu = blocPourPresse("text", JSON.stringify({ style: "p", markup: source }))!;
    assert.equal(markup(contenu.html), source);
  });

  it("un tableau se recolle en tableau, et part en tabulations vers un tableur", () => {
    const rows = [["a", "b"], ["1", "2"]];
    const contenu = blocPourPresse("table", JSON.stringify({ rows }))!;
    assert.equal(contenu.texte, "a\tb\n1\t2");
    assert.deepEqual(html(contenu.html), [{ kind: "table", rows }]);
  });

  it("une cellule qui contient du balisage ne devient pas du HTML", () => {
    const contenu = blocPourPresse("table", JSON.stringify({ rows: [["<b>", "x"], ["y", "z"]] }))!;
    assert.ok(contenu.html.includes("&lt;b&gt;"));
  });

  it("un bloc vide ne copie rien", () => {
    assert.equal(blocPourPresse("text", JSON.stringify({ style: "p", markup: "  " })), null);
  });
});

describe("remplir un tableau", () => {
  it("lit une plage de tableur", () => {
    assert.deepEqual(grilleDuPressePapiers("", "a\tb\nc\td", parser), [["a", "b"], ["c", "d"]]);
  });

  it("lit une table HTML", () => {
    assert.deepEqual(
      grilleDuPressePapiers("<table><tr><td>a</td><td>b</td></tr></table>", "", parser),
      [["a", "b"]],
    );
  });

  it("un seul mot n'est pas une plage", () => {
    assert.equal(grilleDuPressePapiers("", "bonjour", parser), null);
  });
});

describe("contenu d'un bloc collé", () => {
  it("se relit par les lectures ordinaires de la note", () => {
    const texte = contenuDuBloc({ kind: "text", markup: "- a" });
    assert.equal(parseText(texte.content).markup, "- a");
    const table = contenuDuBloc({ kind: "table", rows: [["a", "b"]] });
    assert.deepEqual(parseTable(table.content).rows, [["a", "b"]]);
  });
});
