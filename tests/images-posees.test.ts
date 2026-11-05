import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  collerFragment,
  cadreCommun,
  extraireFragment,
  retirerSelection,
  transformerSelection,
  transformerTraitEntier,
} from "@/lib/fragment-encre";
import { TRANSFO_NEUTRE, transformerPoint, type Transfo } from "@/lib/ink";
import { fragmentDuCollage, ATTRIBUT_MARQUE } from "@/lib/presse-papiers-encre";
import {
  blockFiles,
  buildPreview,
  cadreImage,
  centreImage,
  contenusImprimables,
  imageEnDessin,
  insertPage,
  noteSearchText,
  pageAtY,
  pageBands,
  parseDrawing,
  parseImageBlock,
  pointSurImage,
  removePage,
  surfaceRatio,
  transformerImage,
  type DrawingContent,
  type ImagePosee,
  type NotePage,
  type Stroke,
} from "@/lib/notes";

const image = (bout: Partial<ImagePosee> = {}): ImagePosee => ({
  id: "a",
  file: "photo.jpg",
  x: 0.2,
  y: 0.1,
  w: 0.4,
  ratio: 0.5,
  angle: 0,
  ...bout,
});

const trait = (y: number): Stroke => ({
  color: "ink",
  size: 2,
  tool: "pen",
  points: [0.1, y, 0.5, 0.2, y, 0.5],
});

const surface = (bout: Partial<DrawingContent> = {}): DrawingContent => ({
  strokes: [],
  ratio: 0.75,
  paper: "blank",
  pages: [],
  images: [],
  textes: [],
  ...bout,
});

const proche = (a: number, b: number, marge = 1e-3) =>
  assert.ok(Math.abs(a - b) < marge, `${a} devrait valoir ${b}`);

describe("images posées — lecture", () => {
  it("relit une image telle qu'elle a été enregistrée", () => {
    const lue = parseDrawing(JSON.stringify(surface({ images: [image({ angle: 0.5 })] })));
    assert.deepEqual(lue.images, [image({ angle: 0.5 })]);
  });

  it("une note d'avant les images posées s'ouvre sans rien perdre", () => {
    const ancienne = JSON.stringify({ strokes: [trait(0.1)], ratio: 0.75, paper: "ruled", pages: [] });
    const lue = parseDrawing(ancienne);
    assert.deepEqual(lue.images, []);
    assert.equal(lue.strokes.length, 1);
  });

  it("la clef neuve vient après les traits : une note d'avant ne se renvoie pas entière", () => {
    const ancienne = JSON.stringify({ strokes: [trait(0.1)], ratio: 0.75, paper: "ruled", pages: [] });
    const cles = Object.keys(parseDrawing(ancienne));
    assert.ok(cles.indexOf("images") > cles.indexOf("strokes"), cles.join());
  });

  it("écarte ce qui ne s'afficherait pas, sans faire échouer la page", () => {
    const lue = parseDrawing(
      JSON.stringify({
        strokes: [],
        ratio: 0.75,
        images: [{ file: "", x: 0, y: 0, w: 1, ratio: 1 }, { file: "a.jpg", x: "?", y: 0, w: 1, ratio: 1 }, null, image()],
      }),
    );
    assert.equal(lue.images.length, 1);
  });

  it("borne une largeur absurde, et invente un identifiant manquant", () => {
    const lue = parseDrawing(
      JSON.stringify({ images: [{ file: "a.jpg", x: 0, y: 0, w: 9000, ratio: 1 }] }),
    );
    assert.equal(lue.images[0].w, 3);
    assert.ok(lue.images[0].id.length > 0);
  });
});

describe("images posées — fichiers et aperçu", () => {
  it("désigne son fichier, pour qu'il ne soit pas effacé et parte en sauvegarde", () => {
    const contenu = JSON.stringify(surface({ images: [image({ file: "a.jpg" }), image({ id: "b", file: "b.png" })] }));
    assert.deepEqual(blockFiles("drawing", contenu).sort(), ["a.jpg", "b.png"]);
  });

  it("la vignette d'une page sans trait montre l'image", () => {
    const apercu = buildPreview("drawing", JSON.stringify(surface({ images: [image()] })));
    assert.deepEqual(apercu, { kind: "image", file: "photo.jpg", ratio: 0.5 });
  });
});

describe("images posées — géométrie", () => {
  it("le centre ne bouge pas quand on tourne", () => {
    const avant = image();
    const apres = transformerImage(avant, {
      ...TRANSFO_NEUTRE,
      cx: centreImage(avant).x,
      cy: centreImage(avant).y,
      angle: Math.PI / 3,
    });
    proche(centreImage(apres).x, centreImage(avant).x);
    proche(centreImage(apres).y, centreImage(avant).y);
    proche(apres.angle, Math.PI / 3);
  });

  it("agrandir garde les proportions, et le centre du geste", () => {
    const avant = image();
    const c = centreImage(avant);
    const apres = transformerImage(avant, { ...TRANSFO_NEUTRE, cx: c.x, cy: c.y, echelle: 2 });
    proche(apres.w, 0.8);
    assert.equal(apres.ratio, avant.ratio);
    proche(centreImage(apres).x, c.x);
  });

  it("une image transformée reste alignée sur les traits transformés pareil", () => {
    const t: Transfo = { cx: 0.5, cy: 0.5, echelle: 1.5, angle: 0.4, dx: 0.1, dy: -0.05 };
    const avant = image();
    const attendu = transformerPoint(centreImage(avant), t);
    const apres = centreImage(transformerImage(avant, t));
    proche(apres.x, attendu.x);
    proche(apres.y, attendu.y);
  });

  it("le cadre d'une image tournée d'un quart de tour échange ses dimensions", () => {
    const cadre = cadreImage(image({ angle: Math.PI / 2 }));
    proche(cadre.maxX - cadre.minX, 0.2);
    proche(cadre.maxY - cadre.minY, 0.4);
  });

  it("toucher une image tournée se juge dans son repère", () => {
    const tournee = image({ angle: Math.PI / 2 });
    const c = centreImage(tournee);
    // Sur l'image droite ce point est dedans ; une fois tournée, il est dehors.
    assert.equal(pointSurImage({ x: c.x + 0.18, y: c.y }, image()), true);
    assert.equal(pointSurImage({ x: c.x + 0.18, y: c.y }, tournee), false);
    assert.equal(pointSurImage({ x: c.x, y: c.y + 0.18 }, tournee), true);
  });

  it("un tour complet ne laisse pas d'angle qui grossit", () => {
    const avant = image({ angle: 3 });
    const apres = transformerImage(avant, { ...TRANSFO_NEUTRE, angle: 1 });
    assert.ok(apres.angle >= -Math.PI && apres.angle <= Math.PI);
  });
});

describe("images posées — pages", () => {
  const pile: NotePage[] = [
    { paper: "blank", ratio: 1 },
    { paper: "blank", ratio: 1 },
  ];
  const bandes = pageBands(pile);
  const surDeuxieme = image({ y: bandes[1].top + 0.2 });

  it("descend avec sa page quand on glisse une feuille avant elle", () => {
    const avant = surface({ pages: pile, ratio: surfaceRatio(pile), images: [surDeuxieme] });
    const apres = insertPage(avant, 0, "ruled");
    const page = pageAtY(pageBands(apres.pages), centreImage(apres.images[0]).y);
    assert.equal(page, 2);
  });

  it("une image plus haut que la feuille ajoutée ne bouge pas", () => {
    const avant = surface({ pages: pile, ratio: surfaceRatio(pile), images: [image()] });
    const apres = insertPage(avant, 0, "ruled");
    assert.equal(apres.images[0].y, image().y);
  });

  it("part avec sa page, et ce qui suit remonte", () => {
    const trois: NotePage[] = [...pile, { paper: "blank", ratio: 1 }];
    const b = pageBands(trois);
    const avant = surface({
      pages: trois,
      ratio: surfaceRatio(trois),
      images: [image({ id: "milieu", y: b[1].top + 0.2 }), image({ id: "fin", y: b[2].top + 0.2 })],
    });
    const apres = removePage(avant, 1);
    assert.deepEqual(apres.images.map((i) => i.id), ["fin"]);
    assert.equal(pageAtY(pageBands(apres.pages), centreImage(apres.images[0]).y), 1);
  });
});

describe("fragment : extraire et reposer", () => {
  const depart = surface({ strokes: [trait(0.1), trait(0.2), trait(0.3)], images: [image()] });

  it("extrait les traits et les images retenus, et eux seuls", () => {
    const fragment = extraireFragment(depart, [1], ["a"]);
    assert.equal(fragment?.strokes.length, 1);
    assert.equal(fragment?.images.length, 1);
  });

  it("rien de retenu, rien à copier", () => {
    assert.equal(extraireFragment(depart, [], []), null);
    assert.equal(extraireFragment(depart, [9], ["zzz"]), null);
  });

  it("retire la sélection sans toucher au reste", () => {
    const apres = retirerSelection(depart, [0, 2], ["a"]);
    assert.deepEqual(apres.strokes, [trait(0.2)]);
    assert.deepEqual(apres.images, []);
  });

  it("une image collée reçoit un nouvel identifiant, et garde son fichier", () => {
    const fragment = extraireFragment(depart, [], ["a"])!;
    const pose = collerFragment(depart, fragment, { x: 0.5, y: 0.5 });
    assert.equal(pose.content.images.length, 2);
    assert.notEqual(pose.ids[0], "a");
    assert.equal(pose.content.images[1].file, "photo.jpg");
  });

  it("le collage est centré sur le point visé", () => {
    const fragment = extraireFragment(depart, [0], [])!;
    const pose = collerFragment(surface(), fragment, { x: 0.5, y: 0.4 });
    const cadre = cadreCommun(pose.content.strokes, [])!;
    proche((cadre.minX + cadre.maxX) / 2, 0.5);
    proche((cadre.minY + cadre.maxY) / 2, 0.4);
  });

  it("ce qui est collé est retenu : on peut le placer tout de suite", () => {
    const fragment = extraireFragment(depart, [0, 1], [])!;
    const pose = collerFragment(depart, fragment, { x: 0.5, y: 0.5 });
    assert.deepEqual(pose.rangs, [3, 4]);
  });

  it("ne sort pas de la largeur de la page", () => {
    const fragment = extraireFragment(depart, [0], [])!;
    const pose = collerFragment(surface(), fragment, { x: 0.99, y: 0.2 });
    const cadre = cadreCommun(pose.content.strokes, [])!;
    assert.ok(cadre.maxX <= 1.0001, String(cadre.maxX));
  });

  it("une surface simple s'allonge pour recevoir ce qu'on colle plus bas", () => {
    const fragment = extraireFragment(depart, [0], [])!;
    const pose = collerFragment(surface(), fragment, { x: 0.5, y: 2 });
    assert.ok(pose.content.ratio > 2);
  });

  it("une pile garde sa hauteur : le collage y est ramené", () => {
    const pages: NotePage[] = [{ paper: "blank", ratio: 1 }];
    const pile = surface({ pages, ratio: surfaceRatio(pages) });
    const fragment = extraireFragment(depart, [0], [])!;
    const pose = collerFragment(pile, fragment, { x: 0.5, y: 5 });
    assert.equal(pose.content.ratio, 1);
    assert.ok(cadreCommun(pose.content.strokes, [])!.maxY <= 1.0001);
  });

  it("un trait agrandi garde son allure : son épaisseur suit", () => {
    const apres = transformerTraitEntier(trait(0.1), { ...TRANSFO_NEUTRE, echelle: 2 });
    assert.equal(apres.size, 4);
  });

  it("une épaisseur agrandie reste relisible", () => {
    const epais = { ...trait(0.1), size: 40 };
    assert.equal(transformerTraitEntier(epais, { ...TRANSFO_NEUTRE, echelle: 3 }).size, 60);
  });

  it("déplacer sans agrandir ne touche pas à l'épaisseur", () => {
    const apres = transformerTraitEntier(trait(0.1), { ...TRANSFO_NEUTRE, dx: 0.1 });
    assert.equal(apres.size, 2);
    proche(apres.points[0], 0.2);
  });

  it("transforme toute la sélection d'un même geste, et elle seule", () => {
    const apres = transformerSelection(depart, [0], ["a"], { ...TRANSFO_NEUTRE, dx: 0.1 });
    proche(apres.strokes[0].points[0], 0.2);
    assert.equal(apres.strokes[1], depart.strokes[1]);
    proche(apres.images[0].x, 0.3);
  });
});

describe("le presse-papiers ne recolle que ce qui est à lui", () => {
  it("un HTML sans marque n'est pas un fragment", () => {
    assert.equal(fragmentDuCollage("<p>bonjour</p>"), null);
    assert.equal(fragmentDuCollage(`<span ${ATTRIBUT_MARQUE}="abc"></span>`), null);
  });
});

describe("bloc image", () => {
  const brut = JSON.stringify({ file: "a.jpg", ratio: 0.5, largeur: 0.6, align: "right", legende: "Fig. 1" });

  it("se relit tel quel", () => {
    assert.deepEqual(parseImageBlock(brut), {
      file: "a.jpg",
      ratio: 0.5,
      largeur: 0.6,
      align: "right",
      legende: "Fig. 1",
    });
  });

  it("un contenu abîmé donne une image pleine largeur, pas une exception", () => {
    const lu = parseImageBlock('{"file":"a.jpg","largeur":"grande","align":"haut"');
    assert.deepEqual(lu, { file: "", ratio: 1, largeur: 1, align: "center", legende: "" });
  });

  it("une largeur hors bornes est ramenée dedans", () => {
    assert.equal(parseImageBlock(JSON.stringify({ file: "a", largeur: 0.01 })).largeur, 0.15);
    assert.equal(parseImageBlock(JSON.stringify({ file: "a", largeur: 8 })).largeur, 1);
  });

  it("désigne son fichier, garde sa légende cherchable, et donne l'aperçu", () => {
    assert.deepEqual(blockFiles("image", brut), ["a.jpg"]);
    assert.deepEqual(buildPreview("image", brut), { kind: "image", file: "a.jpg", ratio: 0.5 });
    assert.ok(noteSearchText("", [{ kind: "image", content: brut }], (t) => t).includes("Fig. 1"));
  });

  it("devient une feuille du PDF, à sa largeur et à sa place", () => {
    const page = parseDrawing(imageEnDessin(brut)!);
    assert.equal(page.pages.length, 1);
    const posee = page.images[0];
    proche(posee.w, 0.9 * 0.6);
    proche(posee.x + posee.w, 0.95);
    assert.ok(page.ratio >= posee.y + posee.w * posee.ratio, "l'image tient sur sa page");
  });

  it("un bloc sans image ne fait pas de page blanche", () => {
    assert.deepEqual(contenusImprimables([{ kind: "image", content: "{}" }]), []);
  });

  it("garde l'ordre de la note", () => {
    const contenus = contenusImprimables([
      { kind: "drawing", content: "A" },
      { kind: "text", content: "B" },
      { kind: "image", content: brut },
    ]);
    assert.equal(contenus.length, 2);
    assert.equal(contenus[0], "A");
  });
});
