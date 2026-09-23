import { before, describe, it } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

import { serializeEditor } from "@/components/rich-editor";
import { markupToHtml } from "@/components/rich-text";
import {
  GROUPES_MATHS,
  MATHS_RECENTS_MAX,
  SYMBOLES_MATHS,
  chercherSymboles,
  lireRecents,
  retenirRecent,
} from "@/lib/maths";

let dom: JSDOM;

before(() => {
  dom = new JSDOM("<!doctype html><body></body>", { url: "https://fiches.test/" });
  (globalThis as unknown as { Node: unknown }).Node = dom.window.Node;
});

describe("le catalogue de symboles", () => {
  it("ne contient pas deux fois le même caractère", () => {
    const vus = new Map<string, string>();
    for (const s of SYMBOLES_MATHS) {
      const avant = vus.get(s.c);
      assert.equal(avant, undefined, `« ${s.c} » est à la fois « ${avant} » et « ${s.nom} »`);
      vus.set(s.c, s.nom);
    }
  });

  it("donne un nom à chacun : c'est le nom du bouton", () => {
    for (const s of SYMBOLES_MATHS) {
      assert.ok(s.nom.trim().length > 1, `« ${s.c} » n'a pas de nom lisible`);
    }
  });

  it("n'affiche aucun groupe vide", () => {
    for (const g of GROUPES_MATHS) {
      assert.ok(g.symboles.length > 0, `le groupe « ${g.titre} » est vide`);
    }
  });

  it("ne contient que des caractères, jamais une suite", () => {
    // Un bouton qui poserait deux caractères d'un coup se comporterait autrement
    // à la gomme arrière : une frappe pour l'un, deux pour l'autre.
    for (const s of SYMBOLES_MATHS) {
      assert.equal([...s.c].length, 1, `« ${s.c} » (${s.nom}) fait plusieurs caractères`);
    }
  });
});

describe("chercherSymboles", () => {
  it("trouve par le nom", () => {
    assert.deepEqual(
      chercherSymboles("racine").map((s) => s.c),
      ["√", "∛"],
    );
  });

  it("se moque des accents et de la casse", () => {
    // C'est le cas qui compte : personne ne va chercher l'accent circonflexe
    // pour taper « bêta ».
    assert.equal(chercherSymboles("beta")[0]?.c, "β");
    assert.equal(chercherSymboles("BÊTA")[0]?.c, "β");
  });

  it("trouve par un mot d'usage, pas seulement par le nom savant", () => {
    assert.ok(chercherSymboles("multiplié").some((s) => s.c === "×"));
    assert.ok(chercherSymboles("tend vers").some((s) => s.c === "→"));
    assert.ok(chercherSymboles("carré").some((s) => s.c === "²"));
  });

  it("retrouve un symbole collé depuis ailleurs", () => {
    assert.deepEqual(
      chercherSymboles("∫").map((s) => s.c),
      ["∫"],
    );
  });

  it("ne rend rien sur une requête vide", () => {
    assert.deepEqual(chercherSymboles("   "), []);
  });
});

describe("les symboles récents", () => {
  before(() => {
    (globalThis as unknown as { window: unknown }).window = dom.window;
  });

  it("gardent le dernier posé en tête, sans doublon", () => {
    dom.window.localStorage.clear();
    retenirRecent("π");
    retenirRecent("√");
    retenirRecent("π");
    assert.deepEqual(lireRecents(), ["π", "√"]);
  });

  it("sont plafonnés", () => {
    dom.window.localStorage.clear();
    for (const s of SYMBOLES_MATHS.slice(0, MATHS_RECENTS_MAX + 5)) retenirRecent(s.c);
    assert.equal(lireRecents().length, MATHS_RECENTS_MAX);
  });

  it("écartent ce qui n'est pas un symbole connu", () => {
    // Le stockage est partagé avec tout ce que la personne a pu y mettre, et
    // il survit aux versions : un caractère retiré du catalogue ne doit pas
    // faire apparaître un bouton sans nom.
    dom.window.localStorage.setItem("fiches:maths-recents", JSON.stringify(["π", "zzz", 42]));
    assert.deepEqual(lireRecents(), ["π"]);
  });

  it("supportent un stockage illisible", () => {
    dom.window.localStorage.setItem("fiches:maths-recents", "{pas du json");
    assert.deepEqual(lireRecents(), []);
  });
});

/**
 * L'aller-retour complet, pour **chaque** symbole.
 *
 * C'est tout l'argument du choix fait ici : un caractère Unicode n'est rien de
 * plus que du texte, donc il traverse le balisage sans qu'on ait eu à toucher à
 * l'analyseur. Encore faut-il le prouver — le balisage échappe `* _ ~ \` { }`,
 * et un symbole qui tomberait dessus ressortirait avec une barre oblique
 * inverse sous les yeux de la personne.
 */
describe("un symbole survit à l'enregistrement et à la relecture", () => {
  const serialize = (html: string) => {
    const root = dom.window.document.createElement("div");
    root.innerHTML = html;
    return serializeEditor(root as unknown as HTMLElement);
  };
  const relire = (markup: string) => {
    const root = dom.window.document.createElement("div");
    root.innerHTML = markupToHtml(markup);
    return root.textContent ?? "";
  };

  it("seul, en gras, et au milieu d'un mot", () => {
    for (const s of SYMBOLES_MATHS) {
      const markup = serialize(`<div>x ${s.c} y</div>`);
      assert.equal(relire(markup), `x ${s.c} y`, `« ${s.nom} » ne revient pas tel quel`);
      assert.ok(!markup.includes("\\"), `« ${s.nom} » a dû être échappé : ${markup}`);

      const gras = serialize(`<div><strong>${s.c}</strong></div>`);
      assert.equal(gras, `**${s.c}**`, `« ${s.nom} » en gras : ${gras}`);
      assert.equal(relire(gras), s.c);
    }
  });

  it("y compris plusieurs à la suite, dans une formule", () => {
    const formule = "∀ε>0 ∃δ>0 : |x−a|<δ ⇒ |f(x)−f(a)|<ε";
    const markup = serialize(`<div>${formule}</div>`);
    assert.equal(relire(markup), formule);
  });
});
