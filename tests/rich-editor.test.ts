import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { serializeEditor } from "@/components/rich-editor";
import { markupToHtml } from "@/components/rich-text";

// serializeEditor lit `Node.TEXT_NODE` / `Node.ELEMENT_NODE` depuis le global :
// on lui fournit un DOM avant de l'appeler.
let dom: JSDOM;

before(() => {
  dom = new JSDOM("<!doctype html><body></body>");
  (globalThis as unknown as { Node: unknown }).Node = dom.window.Node;
});

/** Construit un contenteditable à partir de HTML et le retranscrit en balisage. */
function serialize(html: string): string {
  const root = dom.window.document.createElement("div");
  root.innerHTML = html;
  return serializeEditor(root as unknown as HTMLElement);
}

describe("serializeEditor — traduction du DOM en balisage", () => {
  it("traduit les balises de mise en forme", () => {
    assert.equal(serialize("<div><strong>a</strong></div>"), "**a**");
    assert.equal(serialize("<div><b>a</b></div>"), "**a**");
    assert.equal(serialize("<div><em>a</em></div>"), "*a*");
    assert.equal(serialize("<div><i>a</i></div>"), "*a*");
    assert.equal(serialize("<div><s>a</s></div>"), "~~a~~");
    assert.equal(serialize("<div><code>a</code></div>"), "`a`");
  });

  it("traduit la couleur portée par data-c", () => {
    assert.equal(serialize('<div><span data-c="rose">a</span></div>'), "{c:rose}a{/c}");
  });

  it("ignore une couleur qui n'est pas la nôtre plutôt que d'inventer", () => {
    // Seul `data-c` fait foi : un style inline venu d'ailleurs ne doit pas
    // être deviné, seul le texte est conservé.
    assert.equal(serialize('<div><span style="color: red">a</span></div>'), "a");
    assert.equal(serialize('<div><span data-c="inconnue">a</span></div>'), "a");
  });

  it("traduit les listes", () => {
    assert.equal(serialize("<ul><li>a</li><li>b</li></ul>"), "- a\n- b");
    assert.equal(serialize("<ol><li>a</li><li>b</li></ol>"), "1. a\n2. b");
  });

  it("fait une ligne par bloc, et traduit <br>", () => {
    assert.equal(serialize("<div>un</div><div>deux</div>"), "un\ndeux");
    assert.equal(serialize("<div>un<br>deux</div>"), "un\ndeux");
  });

  it("n'entoure pas de marqueurs un contenu vide", () => {
    // « **** » resterait affiché tel quel : autant ne rien produire.
    assert.equal(serialize("<div><strong></strong></div>"), "");
    assert.equal(serialize("<div><em> </em></div>").trim(), "");
  });

  it("ne garde que le texte des balises non gérées", () => {
    // Cas d'un collage depuis une page web.
    assert.equal(
      serialize('<div><table><tr><td>a</td></tr></table></div>').replace(/\s+/g, ""),
      "a",
    );
    assert.equal(serialize('<div><span class="x">a</span></div>'), "a");
  });

  it("supporte l'imbrication", () => {
    assert.equal(serialize("<div><strong>a <em>b</em></strong></div>"), "**a *b***");
    assert.equal(
      serialize('<div><span data-c="blue"><strong>x</strong></span></div>'),
      "{c:blue}**x**{/c}",
    );
  });

  it("réduit les lignes vides en trop", () => {
    assert.equal(serialize("<div>a</div><div></div><div></div><div>b</div>"), "a\n\nb");
  });
});

describe("aller-retour balisage → HTML → balisage", () => {
  // La propriété qui compte vraiment : ce qui est stocké doit survivre à un
  // passage dans l'éditeur sans se déformer.
  const cas = [
    "**gras**",
    "*italique*",
    "~~barré~~",
    "`code`",
    "{c:rose}coloré{/c}",
    "{c:blue}**les deux**{/c}",
    "texte simple",
    "un\ndeux",
    "- a\n- b",
    "1. a\n2. b",
    "Rapport **logarithmique** entre la pression et la {c:emerald}référence{/c}",
  ];

  for (const markup of cas) {
    it(`conserve ${JSON.stringify(markup)}`, () => {
      assert.equal(serialize(markupToHtml(markup)), markup);
    });
  }
});
