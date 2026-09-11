import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  defaultContent,
  isBlockKind,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  parseDrawing,
  parseTable,
  parseText,
  noteSearchText,
} from "@/lib/notes";

describe("isBlockKind", () => {
  it("n'accepte que les trois types connus", () => {
    for (const bon of ["text", "table", "drawing"]) assert.equal(isBlockKind(bon), true);
    for (const mauvais of ["", "Text", "image", null, 1, {}]) {
      assert.equal(isBlockKind(mauvais), false, String(mauvais));
    }
  });
});

describe("lecture tolérante", () => {
  // Un bloc abîmé ne doit pas rendre la note entière illisible.
  const abimes = ["", "null", "[]", "{", '{"style":', "42", '"texte"', '{"style":"h9"}'];

  it("le texte retombe sur un paragraphe vide", () => {
    for (const raw of abimes) {
      const bloc = parseText(raw);
      assert.equal(bloc.style, "p", raw);
      assert.equal(bloc.markup, "", raw);
    }
  });

  it("le tableau retombe sur une grille vide", () => {
    for (const raw of abimes) {
      const bloc = parseTable(raw);
      assert.ok(bloc.rows.length > 0, raw);
      assert.ok(bloc.rows.every((r) => r.length === bloc.rows[0].length), raw);
    }
  });

  it("le dessin retombe sur une page blanche", () => {
    for (const raw of abimes) {
      assert.deepEqual(parseDrawing(raw).strokes, [], raw);
    }
  });
});

describe("parseText", () => {
  it("conserve style et balisage", () => {
    const bloc = parseText(JSON.stringify({ style: "h1", markup: "**Titre**" }));
    assert.equal(bloc.style, "h1");
    assert.equal(bloc.markup, "**Titre**");
  });
});

describe("parseTable", () => {
  it("complète une grille irrégulière", () => {
    // Vient d'un ajout de colonne interrompu : le rendu ne doit pas deviner.
    const bloc = parseTable(JSON.stringify({ rows: [["a", "b"], ["c"]] }));
    assert.deepEqual(bloc.rows, [["a", "b"], ["c", ""]]);
  });

  it("borne les dimensions", () => {
    const enorme = { rows: Array.from({ length: 500 }, () => Array(80).fill("x")) };
    const bloc = parseTable(JSON.stringify(enorme));
    assert.equal(bloc.rows.length, MAX_TABLE_ROWS);
    assert.equal(bloc.rows[0].length, MAX_TABLE_COLS);
  });

  it("remplace une cellule qui n'est pas du texte", () => {
    const bloc = parseTable(JSON.stringify({ rows: [["a", 3, null, { x: 1 }]] }));
    assert.deepEqual(bloc.rows[0], ["a", "", "", ""]);
  });
});

describe("parseDrawing", () => {
  it("garde un trait bien formé", () => {
    const raw = JSON.stringify({
      ratio: 0.5,
      strokes: [{ color: "ink", size: 3, points: [0.1, 0.2, 0.5, 0.3, 0.4, 0.6] }],
    });
    const bloc = parseDrawing(raw);
    assert.equal(bloc.ratio, 0.5);
    assert.equal(bloc.strokes.length, 1);
    assert.equal(bloc.strokes[0].points.length, 6);
  });

  it("tronque au multiple de trois", () => {
    // Un point incomplet décalerait tout le reste du trait.
    const raw = JSON.stringify({ strokes: [{ color: "ink", size: 2, points: [0, 0, 1, 1, 1] }] });
    assert.deepEqual(parseDrawing(raw).strokes[0].points, [0, 0, 1]);
  });

  it("jette un trait qui n'a plus aucun point", () => {
    const raw = JSON.stringify({ strokes: [{ color: "ink", size: 2, points: [0, 1] }] });
    assert.deepEqual(parseDrawing(raw).strokes, []);
  });

  it("écarte les valeurs non numériques", () => {
    const raw = JSON.stringify({
      strokes: [{ color: "ink", size: 2, points: [0, 0, 1, "x", null, 1, 2, 2, 1] }],
    });
    // Les trois valeurs valides restantes forment un point.
    assert.deepEqual(parseDrawing(raw).strokes[0].points, [0, 0, 1, 1, 2, 2]);
  });

  it("ramène un ratio aberrant au défaut", () => {
    for (const ratio of [0, -1, 99, "grand", null]) {
      const bloc = parseDrawing(JSON.stringify({ ratio, strokes: [] }));
      assert.ok(bloc.ratio > 0.1 && bloc.ratio <= 3, String(ratio));
    }
  });
});

describe("defaultContent", () => {
  it("produit un contenu que la lecture accepte", () => {
    assert.equal(parseText(defaultContent("text")).style, "p");
    assert.ok(parseTable(defaultContent("table")).rows.length >= 1);
    assert.deepEqual(parseDrawing(defaultContent("drawing")).strokes, []);
  });
});

describe("parseDrawing — outils et papier", () => {
  it("garde l'outil et le fond de page", () => {
    const raw = JSON.stringify({
      ratio: 2,
      paper: "ruled",
      strokes: [{ color: "amber", size: 8, tool: "highlighter", points: [0, 0, 1, 1, 1, 1] }],
    });
    const bloc = parseDrawing(raw);
    assert.equal(bloc.paper, "ruled");
    assert.equal(bloc.ratio, 2);
    assert.equal(bloc.strokes[0].tool, "highlighter");
  });

  it("traite un trait d'avant le surligneur comme un stylo", () => {
    // Les pages écrites avant l'arrivée de l'outil n'ont pas le champ.
    const raw = JSON.stringify({ strokes: [{ color: "ink", size: 2, points: [0, 0, 1, 1, 1, 1] }] });
    assert.equal(parseDrawing(raw).strokes[0].tool, "pen");
  });

  it("ramène un papier ou un outil inconnu au défaut", () => {
    const raw = JSON.stringify({
      paper: "papyrus",
      strokes: [{ color: "ink", size: 2, tool: "aérographe", points: [0, 0, 1, 1, 1, 1] }],
    });
    const bloc = parseDrawing(raw);
    assert.equal(bloc.paper, "blank");
    assert.equal(bloc.strokes[0].tool, "pen");
  });

  it("accepte une page longue, mais pas infinie", () => {
    // La page s'allonge à mesure qu'on écrit ; elle reste bornée.
    assert.equal(parseDrawing(JSON.stringify({ ratio: 6, strokes: [] })).ratio, 6);
    assert.equal(parseDrawing(JSON.stringify({ ratio: 99, strokes: [] })).ratio, 0.75);
  });
});

describe("noteSearchText", () => {
  const brut = (markup: string) => markup.replace(/\*\*|\*|~~|`/g, "");

  it("réunit le titre, le texte et les cellules", () => {
    const texte = noteSearchText(
      "Thermodynamique",
      [
        { kind: "text", content: JSON.stringify({ style: "p", markup: "**Premier** principe" }) },
        { kind: "table", content: JSON.stringify({ rows: [["Note", "12"], ["Moyenne", "15"]] }) },
      ],
      brut,
    );
    for (const mot of ["Thermodynamique", "Premier", "principe", "Note", "Moyenne", "15"]) {
      assert.ok(texte.includes(mot), `« ${mot} » devrait être indexé — ${texte}`);
    }
  });

  it("ignore les croquis : on ne sait pas lire une écriture manuscrite", () => {
    const texte = noteSearchText(
      "Croquis",
      [{ kind: "drawing", content: JSON.stringify({ strokes: [{ color: "ink", size: 2, points: [0, 0, 1] }] }) }],
      brut,
    );
    assert.equal(texte.trim(), "Croquis");
  });

  it("survit à un bloc abîmé", () => {
    const texte = noteSearchText("Titre", [{ kind: "text", content: "{tronqué" }], brut);
    assert.ok(texte.includes("Titre"));
  });
});
