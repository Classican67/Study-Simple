import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  buildPreview,
  DEFAULT_RATIO,
  defaultContent,
  surfaceRatio,
  isBlockKind,
  MAX_DOCUMENT_PAGES,
  MAX_TABLE_COLS,
  MAX_TABLE_ROWS,
  noteSearchText,
  PAGE_GAP,
  pageAtY,
  isBackdropPage,
  pageBands,
  parseDrawing,
  parsePreview,
  parseTable,
  parseText,
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

describe("aperçu de note", () => {
  const page = (strokes: number) =>
    JSON.stringify({
      ratio: 1.4,
      paper: "blank",
      strokes: Array.from({ length: strokes }, (_, i) => ({
        color: i % 2 ? "rose" : "default",
        size: 2,
        tool: "pen",
        // Coordonnées réalistes : en proportion de la largeur, donc entre 0
        // et le ratio de la page. Des valeurs hors page fausseraient la mesure
        // de poids qui suit.
        points: Array.from({ length: 120 }, (_, k) =>
          k % 3 === 2 ? 0.5 : ((k + i) % 140) / 100,
        ),
      })),
    });

  it("ne fait pas d'aperçu d'un bloc qui n'est pas une page", () => {
    assert.equal(buildPreview("text", "{}"), null);
    assert.equal(buildPreview("table", "{}"), null);
  });

  it("résume un document importé à sa référence", () => {
    const raw = JSON.stringify({
      ratio: 1.414,
      paper: "blank",
      strokes: [],
      backdrop: { file: "a.pdf", page: 3 },
    });
    assert.deepEqual(buildPreview("drawing", raw), {
      kind: "pdf",
      file: "a.pdf",
      page: 3,
      ratio: 1.414,
    });
  });

  it("échantillonne une page manuscrite, sans la tronquer", () => {
    // Garder les premiers traits ne montrerait que le coin d'une page remplie.
    const apercu = buildPreview("drawing", page(400));
    assert.equal(apercu?.kind, "ink");
    if (apercu?.kind !== "ink") return;
    assert.ok(apercu.strokes.length <= 24, `${apercu.strokes.length} traits`);
    assert.ok(apercu.strokes.every((s) => s.points.length <= 24), "points bornés");
    // Les points sont en millièmes entiers : deux fois plus légers.
    assert.ok(apercu.strokes.every((s) => s.points.every(Number.isInteger)), "coordonnées entières");
    // Le dernier trait échantillonné vient bien de la fin de la page.
    const dernier = apercu.strokes.at(-1)!.points[0];
    assert.ok(dernier > 400, `le prélèvement couvre toute la page (${dernier})`);
  });

  it("reste petit, quoi qu'on lui donne", () => {
    // C'est tout l'objet : la liste des notes ne doit pas peser plus que les
    // notes elles-mêmes.
    const taille = JSON.stringify(buildPreview("drawing", page(2000))).length;
    // Le budget : cent notes affichées doivent peser à peine plus qu'une seule
    // page manuscrite chargée en entier (environ 300 Ko).
    assert.ok(taille < 3500, `${taille} octets`);
  });

  it("ne fait pas d'aperçu d'une page vide", () => {
    assert.equal(buildPreview("drawing", JSON.stringify({ strokes: [], ratio: 1 })), null);
  });

  it("relit ce qu'il a écrit", () => {
    for (const brut of [
      JSON.stringify(buildPreview("drawing", page(10))),
      JSON.stringify({ kind: "pdf", file: "x.pdf", page: 1, ratio: 1.4 }),
    ]) {
      assert.ok(parsePreview(brut) !== null, brut.slice(0, 40));
    }
  });

  it("survit à un aperçu abîmé", () => {
    for (const brut of ["", "{", "null", '{"kind":"autre"}', '{"kind":"pdf"}', "[]"]) {
      assert.equal(parsePreview(brut), null, brut);
    }
  });
});


describe("les pages d'un document sur une même surface", () => {
  const doc = (ratios: number[]) => ratios.map((ratio, i) => ({ file: "a.pdf", page: i + 1, ratio }));

  it("empile les pages les unes sous les autres", () => {
    const bandes = pageBands(doc([1, 1.4, 1]));
    assert.deepEqual(
      bandes.map((b) => b.top),
      [0, 1 + PAGE_GAP, 1 + 1.4 + 2 * PAGE_GAP],
    );
  });

  it("donne à la pile la hauteur de ses pages, sans blanc final", () => {
    assert.equal(surfaceRatio(doc([1, 1])), 2 + PAGE_GAP);
    assert.equal(surfaceRatio(doc([1.4])), 1.4);
  });

  it("retombe sur une page ordinaire quand il n'y a pas de document", () => {
    assert.equal(surfaceRatio([]), DEFAULT_RATIO);
    assert.deepEqual(pageBands([]), []);
  });

  it("dit à quelle page appartient une hauteur", () => {
    const bandes = pageBands(doc([1, 1, 1]));
    assert.equal(pageAtY(bandes, 0), 0);
    assert.equal(pageAtY(bandes, 0.99), 0);
    assert.equal(pageAtY(bandes, 1.5), 1);
    assert.equal(pageAtY(bandes, 2.5), 2);
    // Au-delà de la dernière page, c'est encore la dernière.
    assert.equal(pageAtY(bandes, 99), 2);
  });

  it("range le blanc entre deux pages avec la page qui précède", () => {
    const bandes = pageBands(doc([1, 1]));
    // Un trait posé dans la gouttière appartient à l'une des deux, pas à rien.
    assert.equal(pageAtY(bandes, 1 + PAGE_GAP / 2), 1);
  });
});

describe("parseDrawing — les notes d'avant", () => {
  it("relit un fond d'une seule page écrit sous l'ancienne forme", () => {
    // Les premières notes rangeaient une page par bloc, sous `backdrop`.
    const ancien = JSON.stringify({
      strokes: [],
      ratio: 1.414,
      paper: "blank",
      backdrop: { file: "cours.pdf", page: 3 },
    });
    const contenu = parseDrawing(ancien);
    assert.deepEqual(contenu.pages, [{ file: "cours.pdf", page: 3, ratio: 1.414 }]);
    assert.equal(contenu.ratio, 1.414);
  });

  it("lit un document entier sous la nouvelle forme", () => {
    const contenu = parseDrawing(
      JSON.stringify({
        strokes: [],
        paper: "blank",
        pages: [
          { file: "c.pdf", page: 1, ratio: 1.4 },
          { file: "c.pdf", page: 2, ratio: 1.4 },
        ],
      }),
    );
    assert.equal(contenu.pages.length, 2);
    assert.equal(contenu.ratio, 2.8 + PAGE_GAP);
  });

  it("écarte les pages mal formées sans perdre les autres", () => {
    const contenu = parseDrawing(
      JSON.stringify({
        pages: [
          { file: "c.pdf", page: 1, ratio: 1.4 },
          { file: "c.pdf" },
          { page: 2 },
          { file: "c.pdf", page: 0, ratio: 1 },
          { file: "c.pdf", page: 2, ratio: 1.4 },
        ],
      }),
    );
    assert.deepEqual(
      contenu.pages.filter(isBackdropPage).map((p) => p.page),
      [1, 2],
    );
  });

  it("ne garde pas plus de pages qu'un document n'en a le droit", () => {
    const contenu = parseDrawing(
      JSON.stringify({
        pages: Array.from({ length: 500 }, (_, i) => ({ file: "c.pdf", page: i + 1, ratio: 1 })),
      }),
    );
    assert.equal(contenu.pages.length, MAX_DOCUMENT_PAGES);
  });
});
