import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  PAGE_GAP,
  PAPER_STEPS,
  buildPreview,
  notePreview,
  insertDocumentPages,
  insertImagePage,
  MAX_DOCUMENT_PAGES,
  MAX_RATIO,
  insertPage,
  isBackdropPage,
  isImagePage,
  pageBands,
  PAPER_COLORS,
  blockFiles,
  pageKind,
  paperStepPx,
  parseDrawing,
  parsePreview,
  removePage,
  surfaceRatio,
  type BlankPage,
  type DrawingContent,
  type NotePage,
  type Stroke,
} from "@/lib/notes";
import { paperGuides } from "@/lib/pdf-export";

/**
 * Pages ajoutées dans un document importé.
 *
 * C'est la feuille qu'on glisse dans un polycopié quand le cours déborde. Tout
 * le risque est là : les traits sont repérés d'un bout à l'autre de la pile —
 * c'est ce qui permet d'annoter à cheval sur deux pages — donc glisser une
 * feuille au milieu doit **faire descendre avec leur page** toutes les
 * annotations qui suivent. Sans cela, chacune tombe sur la page d'à côté, et
 * rien à l'écran ne dit pourquoi.
 */

/** Un trait horizontal à la hauteur `y`, large de deux centièmes. */
const trait = (y: number): Stroke => ({
  color: "default",
  size: 2,
  tool: "pen",
  points: [0.1, y, 0.5, 0.12, y, 0.5],
});

const contenu = (pages: NotePage[], strokes: Stroke[] = []): DrawingContent => ({
  strokes,
  ratio: surfaceRatio(pages),
  paper: "blank",
  pages,
});

const doc = (n: number, ratio = 1.4): NotePage[] =>
  Array.from({ length: n }, (_, i) => ({ file: "cours.pdf", page: i + 1, ratio }));

describe("insertPage", () => {
  it("glisse la feuille juste après la page visée", () => {
    const suivant = insertPage(contenu(doc(3)), 0, "ruled");
    assert.equal(suivant.pages.length, 4);
    assert.deepEqual(
      suivant.pages.map((p) => (isBackdropPage(p) ? `doc${p.page}` : `ajout:${(p as BlankPage).paper}`)),
      ["doc1", "ajout:ruled", "doc2", "doc3"],
    );
  });

  it("lui donne le format de sa voisine", () => {
    // Une feuille glissée dans un polycopié A4 est une feuille A4 : sinon la
    // pile se met à bégayer d'une page à l'autre.
    const suivant = insertPage(contenu(doc(2, 1.414)), 0, "grid");
    assert.equal(suivant.pages[1].ratio, 1.414);
  });

  it("recalcule la hauteur de la pile", () => {
    const suivant = insertPage(contenu(doc(2, 1)), 1, "dots");
    assert.equal(suivant.ratio, 3 + 2 * PAGE_GAP);
  });

  it("fait descendre les traits des pages suivantes, et seulement eux", () => {
    const bandes = pageBands(doc(3, 1));
    // Un trait sur chaque page, repéré dans la pile.
    const avant = contenu(doc(3, 1), [
      trait(bandes[0].top + 0.5),
      trait(bandes[1].top + 0.5),
      trait(bandes[2].top + 0.5),
    ]);
    const suivant = insertPage(avant, 0, "ruled");
    const decalage = 1 + PAGE_GAP;

    const y = (s: Stroke) => Number(s.points[1].toFixed(4));
    assert.equal(y(suivant.strokes[0]), y(avant.strokes[0]), "la page 1 ne bouge pas");
    assert.equal(
      y(suivant.strokes[1]),
      Number((y(avant.strokes[1]) + decalage).toFixed(4)),
      "la page 2 descend d'une page",
    );
    assert.equal(
      y(suivant.strokes[2]),
      Number((y(avant.strokes[2]) + decalage).toFixed(4)),
      "la page 3 aussi",
    );
  });

  it("laisse chaque trait sur sa page, après comme avant", () => {
    /*
     * La vérification qui compte : ce n'est pas le décalage qui nous intéresse,
     * c'est que le trait reste sur la page où on l'avait posé. On le mesure en
     * demandant à quelle page il appartient, avant et après.
     */
    const pages = doc(4, 1);
    const bandes = pageBands(pages);
    const avant = contenu(
      pages,
      bandes.map((b) => trait(b.top + 0.5)),
    );
    const suivant = insertPage(avant, 1, "grid");
    const nouvellesBandes = pageBands(suivant.pages);

    const pageDe = (bs: ReturnType<typeof pageBands>, s: Stroke) => {
      for (let i = 0; i < bs.length; i++) {
        if (s.points[1] < bs[i].top + bs[i].ratio) return i;
      }
      return bs.length - 1;
    };

    assert.deepEqual(
      suivant.strokes.map((s) => pageDe(nouvellesBandes, s)),
      // Les pages 3 et 4 d'origine ont pris les rangs 3 et 4 : la feuille
      // ajoutée s'est intercalée au rang 2.
      [0, 1, 3, 4],
      "chaque trait est resté sur sa page",
    );
    assert.deepEqual(
      avant.strokes.map((s) => pageDe(bandes, s)),
      [0, 1, 2, 3],
    );
  });

  it("glisse une feuille avant la première page", () => {
    const bandes = pageBands(doc(2, 1));
    const avant = contenu(doc(2, 1), [trait(bandes[0].top + 0.5)]);
    const suivant = insertPage(avant, -1, "ruled");
    assert.equal(isBackdropPage(suivant.pages[0]), false);
    assert.equal(
      Number(suivant.strokes[0].points[1].toFixed(4)),
      Number((0.5 + 1 + PAGE_GAP).toFixed(4)),
      "le trait de l'ancienne première page descend avec elle",
    );
  });

  it("ne fait rien sur une surface sans pages", () => {
    // Une page simple n'est pas une pile : pour en ajouter une, on ajoute un
    // bloc — ce que la note sait déjà faire.
    const simple = contenu([]);
    assert.equal(insertPage(simple, 0, "ruled"), simple);
  });

  it("refuse de dépasser le nombre de pages permis", () => {
    const plein = contenu(doc(200, 1));
    assert.equal(insertPage(plein, 0, "ruled"), plein);
  });
});

describe("removePage", () => {
  it("retire la page ajoutée et ce qui était écrit dessus", () => {
    const pages: NotePage[] = [...doc(1, 1), { paper: "ruled", ratio: 1 }, ...doc(1, 1)];
    const bandes = pageBands(pages);
    const avant = contenu(pages, [
      trait(bandes[0].top + 0.5),
      trait(bandes[1].top + 0.5),
      trait(bandes[2].top + 0.5),
    ]);
    const suivant = removePage(avant, 1);

    assert.equal(suivant.pages.length, 2);
    assert.equal(suivant.strokes.length, 2, "le trait de la page retirée est parti avec elle");
    assert.equal(
      Number(suivant.strokes[1].points[1].toFixed(4)),
      Number((bandes[2].top + 0.5 - (1 + PAGE_GAP)).toFixed(4)),
      "la page qui suivait remonte",
    );
  });

  it("refuse de retirer une page du document", () => {
    // La pile resterait en désaccord avec le fichier, et l'export irait
    // chercher une page qui n'y est plus.
    const avant = contenu(doc(3));
    assert.equal(removePage(avant, 1), avant);
  });

  it("refuse de vider la pile", () => {
    const avant = contenu([{ paper: "grid", ratio: 1 }]);
    assert.equal(removePage(avant, 0), avant);
  });

  it("annule exactement une insertion", () => {
    const pages = doc(3, 1);
    const bandes = pageBands(pages);
    const avant = contenu(
      pages,
      bandes.map((b) => trait(b.top + 0.4)),
    );
    const apres = removePage(insertPage(avant, 1, "dots"), 2);
    assert.deepEqual(apres.pages, avant.pages);
    assert.deepEqual(
      apres.strokes.map((s) => Number(s.points[1].toFixed(6))),
      avant.strokes.map((s) => Number(s.points[1].toFixed(6))),
    );
  });
});

describe("relecture d'une pile mêlée", () => {
  it("relit les pages ajoutées comme les pages de document", () => {
    const contenuRelu = parseDrawing(
      JSON.stringify({
        pages: [
          { file: "c.pdf", page: 1, ratio: 1.4 },
          { paper: "ruled", ratio: 1.4 },
          { paper: "inconnu", ratio: 1 },
          { paper: "dots" },
        ],
      }),
    );
    assert.deepEqual(
      contenuRelu.pages.map((p) => (isBackdropPage(p) ? "doc" : (p as BlankPage).paper)),
      // Le fond inconnu est écarté, comme tout champ non reconnu ; une page
      // sans format prend celui par défaut.
      ["doc", "ruled", "dots"],
    );
    assert.equal(contenuRelu.pages[2].ratio > 0, true);
  });

  it("donne à la pile mêlée la hauteur de toutes ses pages", () => {
    const relu = parseDrawing(
      JSON.stringify({
        pages: [
          { file: "c.pdf", page: 1, ratio: 1 },
          { paper: "grid", ratio: 1 },
        ],
      }),
    );
    assert.equal(relu.ratio, 2 + PAGE_GAP);
  });
});

/**
 * Les fonds à l'export.
 *
 * Une page à lignes sortait blanche du PDF : l'écran les dessinait en CSS et
 * l'export les ignorait. Ce qui était écrit entre les lignes se retrouvait
 * suspendu dans le vide.
 */
describe("paperGuides", () => {
  const page = { width: 595, height: 842 };

  it("ne dessine rien sur du papier uni", () => {
    const g = paperGuides("blank", page);
    assert.deepEqual(g.lines, []);
    assert.deepEqual(g.dots, []);
  });

  it("compte les lignes depuis le haut de la page", () => {
    /*
     * L'origine du PDF est en bas, mais un cahier se remplit du haut : la
     * première ligne est à un interligne **sous le bord supérieur**. Les
     * compter depuis le bas décalerait tout le réglage d'un reste de division,
     * et l'écriture ne tomberait plus entre les lignes.
     */
    const g = paperGuides("ruled", page);
    const pas = PAPER_STEPS.ruled * page.width;
    assert.equal(Math.abs(g.lines[0][1] - (page.height - pas)) < 1e-9, true);
    assert.equal(g.lines[0][0], 0);
    assert.equal(g.lines[0][2], page.width);
    // Toutes horizontales, et régulièrement espacées.
    for (const [, y1, , y2] of g.lines) assert.equal(y1, y2);
    assert.equal(g.lines.length, Math.ceil(page.height / pas) - 1);
  });

  it("ajoute les verticales pour les carreaux", () => {
    const g = paperGuides("grid", page);
    const verticales = g.lines.filter(([x1, , x2]) => x1 === x2);
    const horizontales = g.lines.filter(([, y1, , y2]) => y1 === y2);
    assert.equal(horizontales.length > 0, true);
    assert.equal(verticales.length > 0, true);
    const pas = PAPER_STEPS.grid * page.width;
    assert.equal(Math.abs(verticales[0][0] - pas) < 1e-9, true);
  });

  it("centre les points dans leur carreau, comme le dégradé CSS", () => {
    // `radial-gradient` centre son point au milieu de sa tuile. Les compter
    // depuis le coin donnerait une grille décalée d'un demi-carreau par rapport
    // à l'écran — un défaut qu'on ne voit qu'en superposant les deux.
    const g = paperGuides("dots", page);
    const pas = PAPER_STEPS.dots * page.width;
    assert.equal(g.lines.length, 0);
    assert.equal(Math.abs(g.dots[0][0] - pas / 2) < 1e-9, true);
    assert.equal(Math.abs(g.dots[0][1] - (page.height - pas / 2)) < 1e-9, true);
  });

  it("donne aux traits la finesse d'un pixel sur une page de mille", () => {
    const g = paperGuides("ruled", page);
    assert.equal(g.thickness, page.width / 1000);
  });
});

/**
 * L'écran et le papier tirent leurs interlignes de la même source.
 *
 * La feuille de style les calcule en CSS, l'export les redessine en PDF : deux
 * séries de nombres qui se séparent silencieusement, et ce qu'on écrit entre
 * deux lignes cesse d'être entre les lignes sur le papier.
 */
describe("interlignes", () => {
  const css = readFileSync(path.join(process.cwd(), "src/app/globals.css"), "utf8");

  it("s'arrête sur un pixel de l'écran, pas entre deux", () => {
    /*
     * Une proportion exacte tombe entre deux pixels — 25,4291 px pour une page
     * de mille soixante-huit — et le navigateur étale alors chaque trait sur
     * deux rangées, différemment selon l'orientation : les verticales d'un
     * quadrillage sortaient plus épaisses que les horizontales, et les carreaux
     * n'étaient pas carrés.
     */
    for (const densite of [1, 2, 3]) {
      const pas = paperStepPx("grid", 1068, densite);
      assert.equal(
        Math.round(pas * densite) === pas * densite,
        true,
        `${pas} px à la densité ${densite} ne tombe pas sur un pixel`,
      );
    }
  });

  it("sans s'éloigner des sept millimètres d'un cahier", () => {
    // L'arrondi ne doit pas déformer le cahier : moins d'un pour cent d'écart.
    for (const [fond, fraction] of [["ruled", 7 / 210], ["grid", 5 / 210]] as const) {
      const exact = fraction * 1068;
      const pas = paperStepPx(fond, 1068, 2);
      assert.ok(Math.abs(pas - exact) / exact < 0.01, `${fond} : ${pas} pour ${exact}`);
    }
  });

  it("carreaux et points ont le même pas : un carreau est carré", () => {
    assert.equal(paperStepPx("grid", 1068, 2), paperStepPx("dots", 1068, 2));
  });

  it("le papier uni n'a pas de réglage", () => {
    assert.equal(paperStepPx("blank", 1068, 2), 0);
  });

  it("et une page sans largeur non plus", () => {
    assert.equal(paperStepPx("ruled", 0, 2), 0);
  });

  it("la feuille de style emploie les couleurs de PAPER_COLORS", () => {
    // Une page imprimée doit ressembler à celle qu'on avait sous les yeux : le
    // fond et le réglage viennent de la même source des deux côtés.
    assert.ok(
      new RegExp(`--paper-fond:\\s*${PAPER_COLORS.fond}`, "i").test(css),
      `globals.css doit déclarer --paper-fond: ${PAPER_COLORS.fond}`,
    );
    assert.ok(
      new RegExp(`--paper-trait:\\s*${PAPER_COLORS.trait}`, "i").test(css),
      `globals.css doit déclarer --paper-trait: ${PAPER_COLORS.trait}`,
    );
  });

  it("et le papier est un blanc cassé, pas un blanc d'écran", () => {
    // Un blanc pur fatigue à la lecture et n'appartient à aucun cahier.
    assert.notEqual(PAPER_COLORS.fond.toLowerCase(), "#ffffff");
    const [r, , b] = [1, 3, 5].map((i) => Number.parseInt(PAPER_COLORS.fond.slice(i, i + 2), 16));
    assert.ok(r > b, "le papier doit tirer vers le chaud, pas vers le bleu");
  });

  it("et les pas sont ceux d'un vrai cahier sur une page A4", () => {
    // 210 mm de large : 7 mm pour des lignes, 5 mm pour des carreaux.
    assert.equal(Math.round(PAPER_STEPS.ruled * 210), 7);
    assert.equal(Math.round(PAPER_STEPS.grid * 210), 5);
    assert.equal(Math.round(PAPER_STEPS.dots * 210), 5);
    assert.equal(PAPER_STEPS.blank, 0);
  });
});

/**
 * Une photo est une page, pas un bloc d'image à côté.
 *
 * C'est ce choix qui lui donne le stylet, le zoom, le volet des pages et
 * l'export sans qu'on ait à les réécrire. Il a un coût : **trois** genres de
 * page cohabitent désormais dans la même pile, et en oublier un est l'erreur
 * naturelle. `pageKind` existe pour qu'elle soit impossible à commettre en
 * silence — un `switch` incomplet ne compile pas.
 */
describe("pages photographiées", () => {
  it("se relisent, et se distinguent des autres", () => {
    const relu = parseDrawing(
      JSON.stringify({
        pages: [
          { file: "cours.pdf", page: 1, ratio: 1.4 },
          { image: "a29d00c2-5afd-4b0f-afb0-1de8f3647367.jpg", ratio: 0.6667 },
          { paper: "ruled", ratio: 1.4 },
        ],
      }),
    );
    assert.deepEqual(relu.pages.map(pageKind), ["document", "image", "blank"]);
    assert.equal(isImagePage(relu.pages[1]) && relu.pages[1].image.endsWith(".jpg"), true);
    assert.equal(relu.pages[1].ratio, 0.6667);
  });

  it("donnent leur format à la page", () => {
    // Une photo n'est ni A4 ni carrée : la page prend **son** format, sinon
    // elle apparaîtrait avec des bandes ou déformée.
    const relu = parseDrawing(JSON.stringify({ pages: [{ image: "p.jpg", ratio: 0.5625 }] }));
    assert.equal(relu.ratio, 0.5625);
  });

  it("servent d'aperçu à la note", () => {
    const apercu = buildPreview(
      "drawing",
      JSON.stringify({ pages: [{ image: "p.jpg", ratio: 0.75 }], strokes: [] }),
    );
    assert.deepEqual(apercu, { kind: "image", file: "p.jpg", ratio: 0.75 });
    // Et l'aperçu se relit tel qu'il a été écrit.
    assert.deepEqual(parsePreview(JSON.stringify(apercu)), apercu);
  });

  it("se retirent d'une pile, contrairement aux pages du document", () => {
    // Une photo n'appartient qu'à cette note : la retirer ne met rien en
    // désaccord. Une page du document, si — le fichier, lui, la garde.
    const pages: NotePage[] = [
      { file: "cours.pdf", page: 1, ratio: 1 },
      { image: "p.jpg", ratio: 1 },
    ];
    const avant = contenu(pages);
    assert.equal(removePage(avant, 1).pages.length, 1);
    assert.equal(removePage(avant, 0), avant);
  });

  it("acceptent qu'on glisse une feuille après elles", () => {
    const avant = contenu([{ image: "p.jpg", ratio: 0.75 }, { image: "q.jpg", ratio: 0.75 }]);
    const suivant = insertPage(avant, 0, "grid");
    assert.deepEqual(suivant.pages.map(pageKind), ["image", "blank", "image"]);
    // La feuille reprend le format de sa voisine — celui de la photo.
    assert.equal(suivant.pages[1].ratio, 0.75);
  });

  it("écartent un nom de photo vide", () => {
    const relu = parseDrawing(JSON.stringify({ pages: [{ image: "", ratio: 1 }] }));
    assert.deepEqual(relu.pages, []);
  });
});

/**
 * Ce qu'une note emporte avec elle.
 *
 * Un document importé et une photo vivent sur le disque ; le bloc n'en garde
 * que le nom. Supprimer la note sans les effacer laissait des fichiers que plus
 * rien ne désigne. C'est cette fonction qui décide de ce qui sera effacé — une
 * erreur ici efface ce qu'il ne fallait pas.
 */
describe("blockFiles", () => {
  it("relève le document et la photo d'une pile", () => {
    const content = JSON.stringify({
      pages: [
        { file: "cours.pdf", page: 1, ratio: 1 },
        { file: "cours.pdf", page: 2, ratio: 1 },
        { image: "photo.jpg", ratio: 0.75 },
        { paper: "ruled", ratio: 1 },
      ],
      strokes: [],
    });
    // Le document n'est compté qu'une fois, même servant à plusieurs pages.
    assert.deepEqual(blockFiles("drawing", content).sort(), ["cours.pdf", "photo.jpg"]);
  });

  it("ne relève rien d'un bloc sans fond", () => {
    assert.deepEqual(blockFiles("drawing", JSON.stringify({ pages: [], strokes: [] })), []);
  });

  it("ni d'un bloc qui n'est pas une page manuscrite", () => {
    // Un texte peut contenir n'importe quoi : on ne va pas y chercher des
    // noms de fichiers à effacer.
    assert.deepEqual(blockFiles("text", JSON.stringify({ markup: "cours.pdf" })), []);
  });

  it("ni d'un contenu abîmé", () => {
    assert.deepEqual(blockFiles("drawing", "{ pas du json"), []);
  });
});

describe("insertDocumentPages", () => {
  const PDF = "6f1c2b0e-3d4a-4b5c-9d8e-7f6a5b4c3d2e.pdf";

  it("glisse toutes les pages du document après la page visée, dans l'ordre", () => {
    const suivant = insertDocumentPages(contenu(doc(2, 1.4)), 0, PDF, [1.3, 0.7, 1.4]);
    assert.deepEqual(suivant.pages.map(pageKind), ["document", "document", "document", "document", "document"]);
    assert.deepEqual(
      suivant.pages.slice(1, 4).map((p) => [(p as { file: string }).file, (p as { page: number }).page, p.ratio]),
      [
        [PDF, 1, 1.3],
        [PDF, 2, 0.7],
        [PDF, 3, 1.4],
      ],
    );
    assert.equal(suivant.ratio, surfaceRatio(suivant.pages));
  });

  it("fait descendre les traits suivants de la hauteur de toutes les pages ajoutées", () => {
    const avant = contenu(doc(2, 1), [trait(0.5), trait(1 + PAGE_GAP + 0.5)]);
    const suivant = insertDocumentPages(avant, 0, PDF, [1.2, 0.8]);
    assert.deepEqual(suivant.strokes[0].points, avant.strokes[0].points);
    const attendu = avant.strokes[1].points[1] + 1.2 + PAGE_GAP + 0.8 + PAGE_GAP;
    assert.ok(Math.abs(suivant.strokes[1].points[1] - attendu) < 1e-9);
  });

  it("fait d'une page manuscrite simple une pile, sans déplacer ce qui y est écrit", () => {
    const simple: DrawingContent = { strokes: [trait(0.3)], ratio: 0.9, paper: "ruled", pages: [] };
    const suivant = insertDocumentPages(simple, 0, PDF, [1.4]);
    assert.deepEqual(suivant.pages.map(pageKind), ["blank", "document"]);
    assert.deepEqual(suivant.strokes, simple.strokes);
    assert.deepEqual(blockFiles("drawing", JSON.stringify(suivant)), [PDF]);
  });

  it("refuse tout le document plutôt que de le tronquer au-delà du maximum", () => {
    const plein = contenu(doc(MAX_DOCUMENT_PAGES - 1, 1));
    assert.equal(insertDocumentPages(plein, 0, PDF, [1, 1]), plein);
    assert.equal(insertDocumentPages(plein, 0, PDF, [1]).pages.length, MAX_DOCUMENT_PAGES);
  });

  it("borne un format aberrant, comme à l'import d'un document seul", () => {
    const suivant = insertDocumentPages(contenu(doc(1, 1)), 0, PDF, [0.01, 99]);
    assert.deepEqual(suivant.pages.slice(1).map((p) => p.ratio), [0.2, MAX_RATIO]);
  });
});

describe("insertImagePage", () => {
  const PHOTO = "2b99d23b-1b21-481f-8748-23a00e9e9eb7.jpg";

  it("glisse la photo après la page visée, avec son propre format", () => {
    const suivant = insertImagePage(contenu(doc(2, 1.4)), 0, PHOTO, 0.6);
    assert.deepEqual(suivant.pages.map(pageKind), ["document", "image", "document"]);
    assert.equal(suivant.pages[1].ratio, 0.6);
    assert.equal(suivant.ratio, surfaceRatio(suivant.pages));
  });

  it("fait descendre les traits des pages suivantes de la hauteur de la photo", () => {
    const avant = contenu(doc(2, 1), [trait(0.5), trait(1 + PAGE_GAP + 0.5)]);
    const suivant = insertImagePage(avant, 0, PHOTO, 0.6);
    assert.deepEqual(suivant.strokes[0].points, avant.strokes[0].points);
    assert.ok(Math.abs(suivant.strokes[1].points[1] - (avant.strokes[1].points[1] + 0.6 + PAGE_GAP)) < 1e-9);
  });

  it("fait d'une page manuscrite simple une pile, sans déplacer ce qui y est écrit", () => {
    const simple: DrawingContent = { strokes: [trait(0.3)], ratio: 0.9, paper: "grid", pages: [] };
    const suivant = insertImagePage(simple, 0, PHOTO, 1.2);
    assert.deepEqual(suivant.pages, [{ paper: "grid", ratio: 0.9 }, { image: PHOTO, ratio: 1.2 }]);
    assert.deepEqual(suivant.strokes, simple.strokes);
    assert.equal(suivant.ratio, surfaceRatio(suivant.pages));
  });

  it("se relit telle qu'elle a été écrite, et désigne son fichier", () => {
    const suivant = insertImagePage({ strokes: [], ratio: 0.75, paper: "ruled", pages: [] }, 0, PHOTO, 0.6);
    assert.deepEqual(parseDrawing(JSON.stringify(suivant)).pages.map(pageKind), ["blank", "image"]);
    assert.deepEqual(blockFiles("drawing", JSON.stringify(suivant)), [PHOTO]);
  });

  it("s'annule en retirant la photo, chaque trait retrouvant sa place", () => {
    const avant = contenu(doc(2, 1), [trait(0.5), trait(1 + PAGE_GAP + 0.5)]);
    const apres = removePage(insertImagePage(avant, 0, PHOTO, 0.6), 1);
    assert.deepEqual(apres.pages, avant.pages);
    apres.strokes.forEach((stroke, i) =>
      assert.ok(Math.abs(stroke.points[1] - avant.strokes[i].points[1]) < 1e-9, `trait ${i}`),
    );
  });
});

describe("notePreview", () => {
  const vierge = JSON.stringify({ strokes: [], ratio: 0.75, paper: "blank", pages: [] });
  const polycopie = JSON.stringify(contenu(doc(2, 1.4)));
  const ecrite = JSON.stringify(contenu([], [trait(0.3)]));
  const note = (pages: Record<string, string>) => {
    const lues: string[] = [];
    const lire = (id: string) => {
      lues.push(id);
      return pages[id] ?? null;
    };
    return { ids: Object.keys(pages), lire, lues };
  };

  it("passe la page vierge d'une note neuve pour montrer le document qui suit", async () => {
    const { ids, lire } = note({ a: vierge, b: polycopie });
    const { apercu, source } = await notePreview(ids, lire);
    assert.equal(apercu?.kind, "pdf");
    assert.equal(source, "b");
  });

  it("garde la première page qui montre quelque chose, pas la plus riche", async () => {
    const { ids, lire } = note({ a: vierge, b: ecrite, c: polycopie });
    assert.equal((await notePreview(ids, lire)).apercu?.kind, "ink");
  });

  it("s'arrête de lire dès qu'une page donne l'aperçu", async () => {
    const { ids, lire, lues } = note({ a: polycopie, b: ecrite, c: vierge });
    await notePreview(ids, lire);
    assert.deepEqual(lues, ["a"]);
  });

  it("ne montre rien quand aucune page ne porte rien", async () => {
    const { ids, lire } = note({ a: vierge, b: vierge });
    assert.deepEqual(await notePreview(ids, lire), { apercu: null, source: null });
    assert.deepEqual(await notePreview([], () => null), { apercu: null, source: null });
  });

  it("accepte une lecture asynchrone, comme celle de la base", async () => {
    const { apercu } = await notePreview(["a", "b"], async (id) => (id === "a" ? vierge : polycopie));
    assert.equal(apercu?.kind, "pdf");
  });

  it("donne le même aperçu que buildPreview quand la première page est remplie", async () => {
    const { apercu } = await notePreview(["a"], () => polycopie);
    assert.deepEqual(apercu, buildPreview("drawing", polycopie));
  });
});

describe("aperçu d'une page vierge qui porte une image plus bas", () => {
  it("montre la photo glissée après la page vierge d'une note neuve", () => {
    const pile = insertImagePage(
      { strokes: [], ratio: 0.75, paper: "blank", pages: [] },
      0,
      "2b99d23b-1b21-481f-8748-23a00e9e9eb7.jpg",
      0.6,
    );
    assert.equal(buildPreview("drawing", JSON.stringify(pile))?.kind, "image");
  });

  it("garde l'écriture dès qu'il y a un trait, même avant une photo", () => {
    const pile = insertImagePage(
      { strokes: [trait(0.3)], ratio: 0.75, paper: "blank", pages: [] },
      0,
      "2b99d23b-1b21-481f-8748-23a00e9e9eb7.jpg",
      0.6,
    );
    assert.equal(buildPreview("drawing", JSON.stringify(pile))?.kind, "ink");
  });
});
