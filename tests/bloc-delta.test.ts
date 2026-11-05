import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { appliquerDelta, calculerDelta, deltaTouche } from "../src/lib/bloc-delta";
import { serialiserDessin } from "../src/lib/drawing-cache";

/*
 * Le morceau envoyé au serveur doit **toujours** rendre, une fois rejoué, le
 * document exact. Une erreur d'un caractère recoud le JSON au mauvais endroit :
 * le bloc devient illisible, et il a été enregistré comme s'il était juste.
 */
function allerRetour(avant: string, apres: string) {
  const d = calculerDelta(avant, apres);
  if (d === null) {
    assert.equal(avant, apres);
    return;
  }
  assert.equal(appliquerDelta(avant, d), apres, `${JSON.stringify(avant)} → ${JSON.stringify(apres)}`);
}

describe("morceau d'un bloc", () => {
  it("ne rend rien pour deux versions identiques", () => {
    assert.equal(calculerDelta("abc", "abc"), null);
  });

  it("ajout, retrait, remplacement, aux deux bouts et au milieu", () => {
    for (const [a, b] of [
      ["", "x"],
      ["x", ""],
      ["abc", "abXc"],
      ["abc", "Xabc"],
      ["abc", "abcX"],
      ["aa", "aaa"],
      ["aaa", "aa"],
      ["abcabc", "abc"],
      ["abXYc", "abc"],
      ["é😀ç", "é😀😀ç"],
    ]) {
      allerRetour(a, b);
    }
  });

  it("un trait ajouté à un dessin ne fait voyager que ce trait", () => {
    const trait = (n: number) => ({ color: "ink", size: 2, tool: "pen", points: [n, n, 0.5] });
    const avant = JSON.stringify({ strokes: Array.from({ length: 500 }, (_, i) => trait(i)), pages: [], images: [], textes: [] });
    const apres = JSON.stringify({ strokes: [...Array.from({ length: 500 }, (_, i) => trait(i)), trait(9)], pages: [], images: [], textes: [] });
    const d = calculerDelta(avant, apres)!;
    assert.ok(d.inserer.length < 80, `${d.inserer.length} caractères`);
    assert.equal(appliquerDelta(avant, d), apres);
  });

  it("tient sur des modifications tirées au hasard", () => {
    let graine = 7;
    const hasard = (n: number) => {
      graine = (graine * 1103515245 + 12345) % 2147483648;
      return graine % n;
    };
    const alphabet = "ab[]{},:0.5\"";
    for (let essai = 0; essai < 2000; essai++) {
      const base = Array.from({ length: hasard(40) }, () => alphabet[hasard(alphabet.length)]).join("");
      const debut = hasard(base.length + 1);
      const fin = debut + hasard(base.length - debut + 1);
      const ajout = Array.from({ length: hasard(6) }, () => alphabet[hasard(alphabet.length)]).join("");
      allerRetour(base, base.slice(0, debut) + ajout + base.slice(fin));
    }
  });

  it("refuse un morceau qui ne s'applique pas", () => {
    assert.equal(appliquerDelta("abc", { debut: 2, fin: 1, inserer: "" }), null);
    assert.equal(appliquerDelta("abc", { debut: 0, fin: 9, inserer: "" }), null);
    assert.equal(appliquerDelta("abc", { debut: -1, fin: 0, inserer: "" }), null);
    assert.equal(appliquerDelta("abc", { debut: 0.5, fin: 1, inserer: "" }), null);
  });
});

describe("le morceau et les fichiers du bloc", () => {
  const page = '{"file":"0b6c1b6e-1234-4c5d-9e8f-0123456789ab.pdf","page":2,"ratio":1.414}';
  // L'ordre des clés est celui de `parseDrawing` : les traits en dernier, et
  // c'est ce qui éloigne des pages le trait qu'on ajoute.
  const doc = (traits: string, pages: string) => `{"ratio":2.8,"paper":"blank","pages":[${pages}],"strokes":[${traits}]}`;

  it("un trait ajouté ne touche à aucun fichier", () => {
    const traits = Array.from({ length: 20 }, () => '{"points":[1,2,3]}').join(",");
    const avant = doc(traits, page);
    const apres = doc(`${traits},{"points":[4,5,6]}`, page);
    assert.equal(deltaTouche(avant, calculerDelta(avant, apres)!, ['"file"', '"image"']), false);
  });

  it("une page retirée, si", () => {
    const avant = doc("", `${page},${page.replace("page\":2", "page\":3")}`);
    const apres = doc("", page);
    assert.equal(deltaTouche(avant, calculerDelta(avant, apres)!, ['"file"', '"image"']), true);
  });

  it("même quand le morceau tombe au milieu d'un nom", () => {
    const avant = doc("", page);
    const apres = doc("", page.replace("0123456789ab", "ffffffffffff"));
    const d = calculerDelta(avant, apres)!;
    assert.ok(!d.inserer.includes("file"));
    assert.equal(deltaTouche(avant, d, ['"file"', '"image"']), true);
  });
});

describe("sérialisation d'un dessin", () => {
  it("rend exactement JSON.stringify, y compris après un trait neuf", () => {
    const traits = Array.from({ length: 50 }, (_, i) => ({
      color: i % 2 ? "ink" : "#12ab34",
      size: 1.5 + i / 10,
      tool: "pen" as const,
      points: [i / 100, 0.1234, 0.5, i / 50, 0.2, 0.75],
    }));
    const dessin = { strokes: traits, ratio: 1.4142, paper: "ruled" as const, pages: [], images: [], textes: [] };
    assert.equal(serialiserDessin(dessin), JSON.stringify(dessin));
    const suite = { ...dessin, strokes: [...traits.slice(0, 20), ...traits.slice(21), { ...traits[3], color: "red" }] };
    assert.equal(serialiserDessin(suite), JSON.stringify(suite));
    const vide = { ...dessin, strokes: [] };
    assert.equal(serialiserDessin(vide), JSON.stringify(vide));
  });
});
