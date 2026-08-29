import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RichText, markupToHtml, parseMarkup, toPlainText } from "@/components/rich-text";

// `createElement` plutôt que du JSX : le fichier reste en .ts, donc un seul
// motif suffit à lancer toute la suite.
// Le conteneur est retiré pour ne comparer que le contenu utile.
const react = (src: string) =>
  renderToStaticMarkup(createElement(RichText, null, src))
    .replace(/^<div[^>]*>/, "")
    .replace(/<\/div>$/, "");

describe("parseMarkup — structure", () => {
  it("regroupe les puces consécutives en une seule liste", () => {
    const blocks = parseMarkup("- a\n- b\n- c");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind, "bullets");
  });

  it("sépare deux paragraphes par une ligne vide", () => {
    const blocks = parseMarkup("un\n\ndeux");
    assert.equal(blocks.length, 2);
    assert.ok(blocks.every((b) => b.kind === "paragraph"));
  });

  it("garde les lignes d'un même paragraphe ensemble", () => {
    const blocks = parseMarkup("un\ndeux");
    assert.equal(blocks.length, 1);
    assert.equal(blocks[0].kind === "paragraph" && blocks[0].lines.length, 2);
  });

  it("ne produit aucun bloc pour une entrée vide", () => {
    assert.deepEqual(parseMarkup(""), []);
    assert.deepEqual(parseMarkup("   \n\n  "), []);
  });
});

describe("RichText — rendu", () => {
  it("rend gras, italique, barré et code", () => {
    assert.equal(react("**a**"), '<p><strong class="font-semibold">a</strong></p>');
    assert.equal(react("*a*"), "<p><em>a</em></p>");
    assert.equal(react("_a_"), "<p><em>a</em></p>");
    assert.ok(react("~~a~~").includes("<del"));
    assert.ok(react("`a`").includes("<code"));
  });

  it("rend la couleur, et replie une couleur inconnue sur la palette", () => {
    assert.equal(react("{c:rose}x{/c}"), '<p><span class="text-c-rose">x</span></p>');
    assert.equal(react("{c:fuchsia}x{/c}"), '<p><span class="text-c-violet">x</span></p>');
  });

  it("autorise l'imbrication", () => {
    // Le motif du gras doit être paresseux, sinon l'italique intérieur casse
    // la correspondance et la règle de l'italique ramasse les morceaux.
    assert.equal(react("**a *b* c**"), '<p><strong class="font-semibold">a <em>b</em> c</strong></p>');
    assert.ok(react("{c:blue}**x**{/c}").includes('<span class="text-c-blue"><strong'));
  });

  it("laisse littéral ce qui n'est pas une mise en forme", () => {
    assert.equal(react("a * b * c"), "<p>a * b * c</p>");
    assert.equal(react("**pas fermé"), "<p>**pas fermé</p>");
    assert.equal(react("****"), "<p>****</p>");
  });

  it("ne réinterprète pas le contenu du code littéral", () => {
    assert.ok(react("`**x**`").includes(">**x**</code>"));
  });

  it("conserve les retours à la ligne simples", () => {
    assert.equal(react("un\ndeux"), "<p>un<br/>deux</p>");
  });

  it("échappe tout HTML saisi par l'utilisateur", () => {
    // React échappe par construction : aucune balise ne peut être injectée.
    const rendu = react('<img src=x onerror="alert(1)">');
    assert.ok(!rendu.includes("<img"));
    assert.ok(rendu.includes("&lt;img"));
  });
});

describe("markupToHtml — amorçage de l'éditeur visuel", () => {
  it("produit les balises attendues", () => {
    assert.equal(markupToHtml("**a**"), "<div><strong>a</strong></div>");
    assert.equal(markupToHtml("*a*"), "<div><em>a</em></div>");
    assert.equal(
      markupToHtml("{c:emerald}v{/c}"),
      '<div><span data-c="emerald" class="text-c-emerald">v</span></div>',
    );
    assert.equal(markupToHtml("- a\n- b"), "<ul><li>a</li><li>b</li></ul>");
    assert.equal(markupToHtml("1. a"), "<ol><li>a</li></ol>");
  });

  it("crée un div par ligne, comme le fait un contenteditable", () => {
    assert.equal(markupToHtml("un\ndeux"), "<div>un</div><div>deux</div>");
  });

  it("échappe le texte : aucun balisage stocké ne peut produire de balise", () => {
    const html = markupToHtml('<img src=x onerror="alert(1)">');
    assert.ok(!html.includes("<img"));
    assert.ok(html.includes("&lt;img"));
  });

  it("ne produit rien pour une entrée vide", () => {
    assert.equal(markupToHtml(""), "");
  });
});

describe("toPlainText", () => {
  it("retire tous les marqueurs", () => {
    assert.equal(toPlainText("{c:rose}**a**{/c} *b* `c` ~~d~~"), "a b c d");
    assert.equal(toPlainText("## Titre"), "Titre");
    assert.equal(toPlainText("- a"), "• a");
    assert.equal(toPlainText("1. a"), "1. a");
  });
});
