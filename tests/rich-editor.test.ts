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
    // L'italique s'écrit `_` : l'étoile seule se confondait avec celle du gras.
    assert.equal(serialize("<div><em>a</em></div>"), "_a_");
    assert.equal(serialize("<div><i>a</i></div>"), "_a_");
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
    assert.equal(serialize("<div><strong>a <em>b</em></strong></div>"), "**a _b_**");
    assert.equal(
      serialize('<div><span data-c="blue"><strong>x</strong></span></div>'),
      "{c:blue}**x**{/c}",
    );
  });

  it("réduit les lignes vides en trop", () => {
    assert.equal(serialize("<div>a</div><div></div><div></div><div>b</div>"), "a\n\nb");
  });
});

/** Ce que l'éditeur rouvert affichera : le HTML relu depuis le balisage stocké. */
const reopen = (html: string) => markupToHtml(serialize(html));

describe("réouverture — aucun marqueur ne doit réapparaître", () => {
  // Chaque cas a été livré : la mise en forme tenait à l'écran, puis la fiche
  // rouverte montrait des `**` ou des `{c:…}` autour de la phrase.
  const cas: [string, string, string][] = [
    [
      "un espace sélectionné avec le mot (double-tap sur iPad)",
      "<div>un <b>mot </b>ici</div>",
      "<div>un <strong>mot</strong> ici</div>",
    ],
    [
      "un espace sélectionné devant le mot",
      "<div>un<b> mot</b> ici</div>",
      "<div>un <strong>mot</strong> ici</div>",
    ],
    [
      "une italique qui finit avec le gras",
      "<div><b>a <i>b</i></b> c</div>",
      "<div><strong>a <em>b</em></strong> c</div>",
    ],
    [
      "un gras qui finit avec l'italique",
      "<div><i>a <b>b</b></i> c</div>",
      "<div><em>a</em> <strong><em>b</em></strong> c</div>",
    ],
    [
      "une couleur posée sur un texte déjà coloré",
      '<div><span data-c="rose">a <span data-c="blue">b</span> c</span></div>',
      '<div><span data-c="rose" class="text-c-rose">a</span> <span data-c="blue" class="text-c-blue">b</span> <span data-c="rose" class="text-c-rose">c</span></div>',
    ],
    [
      "un gras qui enjambe un retour à la ligne",
      "<div><b>un<br>deux</b></div>",
      "<div><strong>un</strong></div><div><strong>deux</strong></div>",
    ],
    ["des étoiles tapées au clavier", "<div>5*3*2 et a_b_c</div>", "<div>5*3*2 et a_b_c</div>"],
    ["des accolades tapées", "<div>{c:rose}x{/c}</div>", "<div>{c:rose}x{/c}</div>"],
    [
      "un gras défait par WebKit dans un <strong>",
      '<div><strong>a <span style="font-weight: normal;">b</span> c</strong></div>',
      "<div><strong>a</strong> b <strong>c</strong></div>",
    ],
    [
      "une couleur retirée au milieu d'un texte coloré",
      '<div><span data-c="rose">a <span data-c="none"><b>b</b></span> c</span></div>',
      '<div><span data-c="rose" class="text-c-rose">a</span> <strong>b</strong> <span data-c="rose" class="text-c-rose">c</span></div>',
    ],
    [
      "deux gras voisins",
      "<div><b>a</b><b>b</b></div>",
      "<div><strong>ab</strong></div>",
    ],
  ];

  for (const [nom, html, attendu] of cas) {
    it(nom, () => {
      const rouvert = reopen(html);
      assert.equal(rouvert, attendu);
      // Et la deuxième réouverture ne dérive pas de la première.
      assert.equal(reopen(rouvert), attendu);
    });
  }
});

describe("aller-retour balisage → HTML → balisage", () => {
  // La propriété qui compte vraiment : ce qui est stocké doit survivre à un
  // passage dans l'éditeur sans se déformer.
  const cas = [
    "**gras**",
    "_italique_",
    "~~barré~~",
    "`code`",
    "{c:rose}coloré{/c}",
    "{c:blue}**les deux**{/c}",
    "texte simple",
    "un\ndeux",
    "- a\n- b",
    "1. a\n2. b",
    "Rapport **logarithmique** entre la pression et la {c:emerald}référence{/c}",
    "**a _b_** c",
    "5\\*3\\*2",
  ];

  for (const markup of cas) {
    it(`conserve ${JSON.stringify(markup)}`, () => {
      assert.equal(serialize(markupToHtml(markup)), markup);
    });
  }
});
