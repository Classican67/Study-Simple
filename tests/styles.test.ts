import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
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

/*
 * Une classe de couleur qui ne correspond à aucun rôle du thème ne produit
 * **rien** : pas d'erreur, pas d'avertissement, un fond transparent. C'est ainsi
 * que `bg-surface-container-high` a vécu dans treize endroits — la barre de
 * l'éditeur, les dialogues, la gouttière entre deux pages — sans jamais exister :
 * le rôle s'appelle `surface-high`. La capture d'une barre illisible en sombre l'a
 * montré ; aucune mesure ne pouvait le dire, puisque l'élément existe et mesure
 * ce qu'il doit.
 */
describe("classes de couleur", () => {
  const theme = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");
  const roles = new Set([...theme.matchAll(/--color-([a-z0-9-]+):/g)].map((m) => m[1]));
  const familles = /^(surface|on-|primary|secondary|tertiary|error|outline|inverse|success)/;

  const fichiers = (dossier: string): string[] =>
    readdirSync(dossier, { withFileTypes: true }).flatMap((entree) => {
      const chemin = path.join(dossier, entree.name);
      if (entree.isDirectory()) return fichiers(chemin);
      return /\.tsx?$/.test(entree.name) ? [chemin] : [];
    });

  it("ne désignent que des rôles déclarés dans le thème", () => {
    const inconnues = new Set<string>();
    for (const fichier of fichiers(path.join(process.cwd(), "src"))) {
      const code = readFileSync(fichier, "utf8");
      for (const m of code.matchAll(/(?<![\w-])(?:bg|text|border|ring|divide|fill|stroke|from|to|via)-([a-z][a-z-]*[a-z])(?![\w-])/g)) {
        if (familles.test(m[1]) && !roles.has(m[1])) inconnues.add(`${m[0]} (${path.basename(fichier)})`);
      }
    }
    assert.deepEqual([...inconnues], []);
  });
});
