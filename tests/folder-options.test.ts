import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { MAX_FOLDER_DEPTH, folderOptions, folderPaths, type FolderNode } from "@/lib/folder-tree";

const noeud = (id: string, parentId: string | null = null, name = id): FolderNode => ({
  id,
  name,
  color: "slate",
  parentId,
});

//  racine
//   ├── Zoologie (z)
//   │    └── TP (t)
//   │         └── Semaine 1 (s)
//   └── Écologie (e)
const arbre = [
  noeud("z", null, "Zoologie"),
  noeud("t", "z", "TP"),
  noeud("s", "t", "Semaine 1"),
  noeud("e", null, "Écologie"),
];

describe("folderOptions", () => {
  it("parcourt l'arbre en profondeur, trié en français", () => {
    // Comparés octet par octet, « Écologie » passerait après « Zoologie ».
    assert.deepEqual(
      folderOptions(arbre).map((o) => [o.label, o.depth]),
      [
        ["Écologie", 0],
        ["Zoologie", 0],
        ["TP", 1],
        ["Semaine 1", 2],
      ],
    );
  });

  it("retire toute la branche du dossier déplacé", () => {
    assert.deepEqual(
      folderOptions(arbre, "t").map((o) => o.id),
      ["e", "z"],
    );
  });

  it("refuse un dossier déjà au niveau maximal comme destination", () => {
    const profond = Array.from({ length: MAX_FOLDER_DEPTH }, (_, i) =>
      noeud(`n${i}`, i === 0 ? null : `n${i - 1}`),
    );
    const options = folderOptions(profond);
    assert.equal(options.at(-1)?.disabled, true);
    assert.equal(options[0].disabled, false);
  });
});

describe("folderPaths", () => {
  it("donne le chemin complet de chaque dossier", () => {
    assert.deepEqual(folderPaths(arbre), [
      { id: "e", path: "Écologie" },
      { id: "z", path: "Zoologie" },
      { id: "t", path: "Zoologie / TP" },
      { id: "s", path: "Zoologie / TP / Semaine 1" },
    ]);
  });
});
