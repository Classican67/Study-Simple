import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_FOLDER_DEPTH,
  buildBreadcrumb,
  depthOf,
  descendantIds,
  isDescendant,
  type FolderNode,
} from "@/lib/folder-tree";

const noeud = (id: string, parentId: string | null = null): FolderNode => ({
  id,
  name: id,
  color: "slate",
  parentId,
});

//  racine
//   ├── a
//   │    └── b
//   │         └── c
//   └── d
const arbre = [noeud("a"), noeud("b", "a"), noeud("c", "b"), noeud("d")];

describe("buildBreadcrumb", () => {
  it("remonte de la racine jusqu'au dossier", () => {
    assert.deepEqual(buildBreadcrumb(arbre, "c").map((f) => f.id), ["a", "b", "c"]);
    assert.deepEqual(buildBreadcrumb(arbre, "d").map((f) => f.id), ["d"]);
  });

  it("renvoie un chemin vide à la racine", () => {
    assert.deepEqual(buildBreadcrumb(arbre, null), []);
  });

  it("renvoie un chemin vide pour un dossier inconnu", () => {
    assert.deepEqual(buildBreadcrumb(arbre, "inexistant"), []);
  });

  it("ne boucle pas indéfiniment sur un cycle en base", () => {
    // Un cycle ne devrait jamais être écrit, mais une page qui ne répond plus
    // serait pire qu'un fil d'Ariane tronqué.
    const cycle = [noeud("x", "y"), noeud("y", "x")];
    const chemin = buildBreadcrumb(cycle, "x");
    assert.ok(chemin.length <= MAX_FOLDER_DEPTH + 2);
  });
});

describe("depthOf", () => {
  it("compte les niveaux depuis la racine", () => {
    assert.equal(depthOf(arbre, null), 0);
    assert.equal(depthOf(arbre, "a"), 1);
    assert.equal(depthOf(arbre, "c"), 3);
  });
});

describe("isDescendant", () => {
  it("reconnaît un descendant direct et indirect", () => {
    assert.equal(isDescendant(arbre, "b", "a"), true);
    assert.equal(isDescendant(arbre, "c", "a"), true);
  });

  it("considère un dossier comme son propre descendant", () => {
    // C'est ce qui interdit de déplacer un dossier dans lui-même.
    assert.equal(isDescendant(arbre, "a", "a"), true);
  });

  it("refuse une branche voisine", () => {
    assert.equal(isDescendant(arbre, "d", "a"), false);
    assert.equal(isDescendant(arbre, "a", "c"), false);
  });
});

describe("descendantIds", () => {
  it("renvoie le dossier et tout son sous-arbre", () => {
    assert.deepEqual(descendantIds(arbre, "a").sort(), ["a", "b", "c"]);
    assert.deepEqual(descendantIds(arbre, "d"), ["d"]);
  });

  it("ne boucle pas sur un cycle", () => {
    const cycle = [noeud("x", "y"), noeud("y", "x")];
    const ids = descendantIds(cycle, "x");
    assert.deepEqual(ids.sort(), ["x", "y"]);
  });
});
