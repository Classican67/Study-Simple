import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Le verrou doit se suffire à lui-même.
 *
 * `npm ci` refuse d'installer si une dépendance citée par un paquet du verrou
 * n'y a pas elle-même son entrée. Ce n'est pas théorique : le déploiement sur
 * le NAS a échoué deux fois sur « Missing: @emnapi/runtime from lock file »,
 * et rien — ni la compilation, ni les essais, ni `npm ci` sur la machine de
 * développement — ne l'avait vu.
 *
 * La raison : les deux machines n'ont pas le même npm. npm 11 accepte un
 * verrou incomplet qu'il a lui-même écrit ; npm 10, celui de l'image Node 22,
 * le rejette. Ce contrôle-ci ne dépend d'aucun npm : il relit le verrou et
 * vérifie que chaque dépendance citée s'y résout.
 */

const RACINE = path.resolve(import.meta.dirname, "..");

type Entree = {
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
  bundleDependencies?: string[] | boolean;
};

const verrou = JSON.parse(readFileSync(path.join(RACINE, "package-lock.json"), "utf8")) as {
  lockfileVersion: number;
  packages: Record<string, Entree>;
};

/**
 * Résout un nom depuis un chemin, comme le ferait Node.
 *
 * `node_modules/a/node_modules/b` voit `b` chez lui, puis remonte : c'est
 * exactement la règle que npm applique en validant le verrou.
 */
function resout(depuis: string, nom: string): boolean {
  // « node_modules/a/node_modules/b » cherche chez lui, puis chez `a`, puis à
  // la racine : on remonte un cran de `node_modules` à chaque tour.
  const segments = depuis.split("node_modules/");
  for (let k = segments.length - 1; k >= 0; k--) {
    const base = segments
      .slice(0, k + 1)
      .join("node_modules/")
      .replace(/\/$/, "");
    const cle = base ? `${base}/node_modules/${nom}` : `node_modules/${nom}`;
    if (verrou.packages[cle]) return true;
  }
  return false;
}

const paquet = JSON.parse(readFileSync(path.join(RACINE, "package.json"), "utf8")) as {
  packageManager?: string;
};
const dockerfile = readFileSync(path.join(RACINE, "Dockerfile"), "utf8");

describe("la version de npm", () => {
  it("est déclarée une fois pour toutes dans package.json", () => {
    assert.match(paquet.packageManager ?? "", /^npm@\d+\.\d+\.\d+$/);
  });

  it("vaut au moins 11 — npm 10 refuse un verrou écrit par npm 11", () => {
    // L'inverse passe : npm 11 relit sans broncher un verrou de npm 10. C'est
    // donc le plus récent qui doit tourner dans l'image.
    const majeure = Number((paquet.packageManager ?? "npm@0.0.0").split("@")[1].split(".")[0]);
    assert.ok(majeure >= 11, `npm ${majeure} installerait un verrou qu'il pourrait refuser`);
  });

  it("est imposée à l'image avant le `npm ci`", () => {
    const pose = dockerfile.indexOf("npm install -g");
    const ci = dockerfile.indexOf("RUN npm ci");
    assert.ok(pose !== -1, "le Dockerfile n'impose aucune version de npm");
    assert.ok(pose < ci, "npm est installé après le `npm ci` qu'il devait servir");
    // Lue depuis package.json : deux endroits à tenir, c'est un de trop.
    assert.match(dockerfile, /packageManager/);
  });
});

describe("package-lock.json", () => {
  it("est un verrou de version 3, comme l'attend npm 10 et au-delà", () => {
    assert.equal(verrou.lockfileVersion, 3);
  });

  it("contient toutes les dépendances que ses paquets réclament", () => {
    const manquants: string[] = [];

    for (const [chemin, entree] of Object.entries(verrou.packages)) {
      // Les paquets « bundled » transportent leurs dépendances avec eux : npm
      // ne leur demande pas d'entrée séparée.
      const embarques = new Set(
        Array.isArray(entree.bundleDependencies) ? entree.bundleDependencies : [],
      );
      const requis = { ...entree.dependencies, ...entree.optionalDependencies };

      for (const nom of Object.keys(requis)) {
        if (embarques.has(nom)) continue;
        if (!resout(chemin, nom)) manquants.push(`${nom} (réclamé par ${chemin || "la racine"})`);
      }
    }

    assert.deepEqual(
      [...new Set(manquants)].sort(),
      [],
      "des dépendances n'ont pas d'entrée dans le verrou : `npm ci` échouera",
    );
  });
});
