import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Garde-fous sur la feuille de style globale.
 *
 * Ces règles ne se testent pas au rendu sans navigateur, mais leur violation
 * est invisible à la lecture et coûteuse à l'écran : autant l'attraper ici.
 */
const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

/** Découpe la feuille en couches de premier niveau. */
function layers(source: string): Map<string, string> {
  const found = new Map<string, string>();
  const re = /@layer\s+([a-z]+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source))) {
    let depth = 1;
    let i = re.lastIndex;
    while (i < source.length && depth > 0) {
      if (source[i] === "{") depth++;
      else if (source[i] === "}") depth--;
      i++;
    }
    found.set(match[1], (found.get(match[1]) ?? "") + source.slice(re.lastIndex, i - 1));
  }
  return found;
}

describe("globals.css", () => {
  const couches = layers(css);

  it("déclare les couches attendues", () => {
    for (const nom of ["base", "components", "utilities"]) {
      assert.ok(couches.has(nom), `couche « ${nom} » absente`);
    }
  });

  it("place la couche d'état parmi les composants, pas les utilitaires", () => {
    /*
     * Régression vécue : déclarée dans `utilities`, la règle passait après
     * celles de Tailwind et son `position: relative` écrasait un `absolute`
     * à spécificité égale. Le bouton d'effacement de la recherche retombait
     * dans le flux — il sortait du champ, et la hauteur du conteneur passait
     * de 56 à 100 px, décentrant au passage la loupe.
     *
     * `components` passe avant `utilities` : un utilitaire de position peut
     * désormais l'emporter, ce qui est le comportement attendu.
     */
    assert.match(couches.get("components") ?? "", /\.state-layer\s*\{/);
    assert.doesNotMatch(couches.get("utilities") ?? "", /\.state-layer\s*\{/);
  });

  it("neutralise la croix native des champs de recherche", () => {
    // Sinon le navigateur en dessine une seconde, à côté de la nôtre, sans en
    // suivre ni la couleur ni la taille de cible.
    assert.match(couches.get("base") ?? "", /::-webkit-search-cancel-button/);
  });
});
