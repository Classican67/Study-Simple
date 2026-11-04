import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import { PDFDocument, rgb } from "pdf-lib";

import { boundsOf, translateStroke } from "@/lib/ink";
import {
  isBackdropPage,
  isImagePage,
  pageAtY,
  pageKind,
  pageBands,
  parseDrawing,
  UNTITLED,
  type BlankPage,
  type PageBand,
  type Paper,
  type Stroke,
} from "@/lib/notes";
import {
  PAPER_FOND_RGB,
  PAPER_RGB,
  inkRgb,
  paperGuides,
  strokeOpacity,
  strokeRect,
  strokeToInkList,
  strokeToPdfOperators,
  strokeToSvgPaths,
  strokePassOpacity,
  strokeWidth,
  type PageSize,
} from "@/lib/pdf-export";
import { UPLOAD_DIR } from "@/lib/uploads";
import { isValidUploadName } from "@/lib/upload-path";

export type ModePdf = "flat" | "annot";

/**
 * Le PDF d'une note : ses pages manuscrites, avec leur fond et leur encre.
 *
 * Sorti de la route d'export pour servir aussi à la sauvegarde Google Drive :
 * le fichier déposé dans le Drive doit être celui qu'on aurait téléchargé, pas
 * une seconde mise en page qui divergerait au premier changement.
 *
 * `contenus` : le contenu des blocs manuscrits, dans l'ordre de la note.
 * Rend `null` quand il n'y a aucune page à produire.
 */
export async function notePdf(
  titre: string,
  contenus: string[],
  mode: ModePdf,
): Promise<Uint8Array | null> {
  const blocs = contenus.map(parseDrawing);

  /*
   * Les feuilles du PDF à produire.
   *
   * Un bloc manuscrit qui porte un document importé vaut **plusieurs** pages :
   * elles sont empilées sur une même surface, et les traits qu'on y a posés
   * sont repérés d'un bout à l'autre de la pile. Chaque trait revient donc à
   * la page où il tombe, ramené dans le repère de celle-ci — sinon tout ce qui
   * est écrit après la première page sortirait du papier.
   */
  const feuilles: {
    band: PageBand | null;
    /** Fond à redessiner, pour une page sans image de document. */
    paper: Paper;
    ratio: number;
    strokes: Stroke[];
  }[] = [];
  for (const bloc of blocs) {
    const bandes = pageBands(bloc.pages);
    if (bandes.length === 0) {
      feuilles.push({ band: null, paper: bloc.paper, ratio: bloc.ratio, strokes: bloc.strokes });
      continue;
    }

    const parPage: Stroke[][] = bandes.map(() => []);
    for (const stroke of bloc.strokes) {
      const boite = boundsOf(stroke.points);
      if (!boite) continue;
      // Un trait à cheval sur deux pages revient à celle où il est le plus :
      // c'est son milieu qui décide, et le papier rogne le débord.
      const index = pageAtY(bandes, (boite.minY + boite.maxY) / 2);
      parPage[index].push({
        ...stroke,
        points: translateStroke(stroke.points, 0, -bandes[index].top),
      });
    }
    bandes.forEach((band, index) =>
      feuilles.push({
        band,
        // Une page ajoutée porte son propre fond ; une page du document et une
        // photo n'en ont pas besoin, leur image en tient lieu.
        paper: pageKind(band) === "blank" ? (band as BlankPage).paper : "blank",
        ratio: band.ratio,
        strokes: parPage[index],
      }),
    );
  }

  if (feuilles.length === 0) return null;

  const sortie = await PDFDocument.create();
  sortie.setTitle(titre.trim() || UNTITLED);
  sortie.setProducer("Fiches");

  // Un même document sert de fond à plusieurs pages : on ne l'ouvre qu'une fois.
  const sources = new Map<string, PDFDocument>();
  const ouvrir = async (file: string) => {
    const deja = sources.get(file);
    if (deja) return deja;
    // Le nom vient de la base, mais il a pu y être écrit par un client : on le
    // valide comme partout ailleurs avant de toucher au disque.
    if (!isValidUploadName(file)) throw new Error("nom de fichier invalide");
    const octets = await readFile(path.join(UPLOAD_DIR, file));
    const doc = await PDFDocument.load(octets);
    sources.set(file, doc);
    return doc;
  };

  for (const page of feuilles) {
    let cible;

    if (page.band && isBackdropPage(page.band)) {
      const band = page.band;
      try {
        const source = await ouvrir(band.file);
        const index = band.page - 1;
        if (index < 0 || index >= source.getPageCount()) continue;
        const [copiee] = await sortie.copyPages(source, [index]);
        cible = sortie.addPage(copiee);
      } catch (error) {
        // Document manquant ou illisible : on préfère une page blanche aux
        // bonnes dimensions plutôt que d'abandonner tout l'export.
        console.error("[pdf] fond illisible :", error);
        cible = sortie.addPage([595, Math.round(595 * page.ratio)]);
      }
    } else if (page.band && isImagePage(page.band)) {
      /*
       * Une photo annotée : la page **est** la photo.
       *
       * Sans elle, la page sortait blanche et les annotations flottaient dans
       * le vide — le même défaut que pour les fonds de cahier, et pour la même
       * raison : ce que l'écran affiche en HTML, le PDF ne le sait pas.
       */
      const image = page.band.image;
      cible = sortie.addPage([595, Math.round(595 * page.ratio)]);
      try {
        if (!isValidUploadName(image)) throw new Error("nom de fichier invalide");
        const octets = await readFile(path.join(UPLOAD_DIR, image));
        // pdf-lib ne sait embarquer que le JPEG et le PNG. Les photos prises
        // dans l'app sont en JPEG pour cette raison précise ; on se fie aux
        // octets et non à l'extension, qui vient de nous mais pourrait changer.
        const jpeg = octets[0] === 0xff && octets[1] === 0xd8;
        const embarquee = jpeg
          ? await sortie.embedJpg(new Uint8Array(octets))
          : await sortie.embedPng(new Uint8Array(octets));
        // Ajustée au papier en gardant ses proportions : la page a le format
        // de la photo, mais arrondi au millième.
        const echelle = Math.min(
          cible.getWidth() / embarquee.width,
          cible.getHeight() / embarquee.height,
        );
        const l = embarquee.width * echelle;
        const h = embarquee.height * echelle;
        cible.drawImage(embarquee, {
          x: (cible.getWidth() - l) / 2,
          y: (cible.getHeight() - h) / 2,
          width: l,
          height: h,
        });
      } catch (error) {
        // Photo manquante ou illisible : on garde la page et ses annotations
        // plutôt que d'abandonner tout l'export.
        console.error("[pdf] photo illisible :", error);
      }
    } else {
      // Sans document, la page prend la largeur d'un A4 et le format du bloc.
      cible = sortie.addPage([595, Math.round(595 * page.ratio)]);
    }

    const taille: PageSize = { width: cible.getWidth(), height: cible.getHeight() };

    /*
     * Le papier, avant l'encre.
     *
     * Une page à lignes sortait blanche du PDF : l'écran dessinait ses lignes en
     * CSS et l'export les ignorait. Ce qui était écrit entre les lignes se
     * retrouvait suspendu dans le vide.
     */
    /*
     * Le papier lui-même, avant son réglage.
     *
     * Une page sans image de fond sortait d'un blanc d'écran ; celle qu'on
     * avait sous les yeux est un blanc cassé légèrement chaud. Une page de
     * document ou une photo, elles, apportent leur propre fond.
     */
    if (!page.band || pageKind(page.band) === "blank") {
      cible.drawRectangle({
        x: 0,
        y: 0,
        width: taille.width,
        height: taille.height,
        color: rgb(...PAPER_FOND_RGB),
      });
    }

    const repere = paperGuides(page.paper, taille);
    const grisPapier = rgb(...PAPER_RGB);
    for (const [x1, y1, x2, y2] of repere.lines) {
      cible.drawLine({
        start: { x: x1, y: y1 },
        end: { x: x2, y: y2 },
        thickness: repere.thickness,
        color: grisPapier,
      });
    }
    for (const [x, y] of repere.dots) {
      cible.drawCircle({ x, y, size: repere.thickness, color: grisPapier, borderWidth: 0 });
    }

    // Les surligneurs d'abord, comme à l'écran : ils passent sous l'encre.
    const ordonnes = [...page.strokes].sort(
      (a, b) => (a.tool === "highlighter" ? 0 : 1) - (b.tool === "highlighter" ? 0 : 1),
    );

    for (const stroke of ordonnes) {
      if (mode === "flat") {
        // Une mèche par chemin : un crayon en a trois, un crayon de cire quatre,
        // et c'est leur recouvrement inégal qui fait la matière. Les dessiner en
        // un seul chemin rendrait un aplat.
        const chemins = strokeToSvgPaths(stroke, taille);
        if (chemins.length === 0) continue;
        const [r, g, b] = inkRgb(stroke.color);
        for (const chemin of chemins) {
          cible.drawSvgPath(chemin, {
            color: rgb(r, g, b),
            borderWidth: 0,
            opacity: strokePassOpacity(stroke, chemins.length),
            // `drawSvgPath` place l'origine en haut à gauche par défaut ; nos
            // coordonnées sont déjà en repère PDF, on neutralise donc le décalage.
            x: 0,
            y: taille.height,
            scale: 1,
          });
        }
        continue;
      }

      // --- Annotation Ink, avec son flux d'apparence ---------------------
      const rect = strokeRect(stroke, taille);
      const ops = strokeToPdfOperators(stroke, taille);
      if (!rect || !ops) continue;

      const [r, g, b] = inkRgb(stroke.color);
      const opacite = strokeOpacity(stroke);

      // L'apparence est un objet de formulaire dont le repère est celui de la
      // page : `/BBox` couvre la page entière, ce qui évite d'avoir à décaler
      // les coordonnées et d'introduire une source d'erreur de plus.
      const etat = sortie.context.obj({ Type: "ExtGState", CA: opacite, ca: opacite });
      const apparence = sortie.context.stream(`q\n/GS0 gs\n${ops}\nQ`, {
        Type: "XObject",
        Subtype: "Form",
        FormType: 1,
        BBox: [0, 0, taille.width, taille.height],
        Resources: sortie.context.obj({
          ExtGState: sortie.context.obj({ GS0: sortie.context.register(etat) }),
        }),
      });

      const annotation = sortie.context.obj({
        Type: "Annot",
        Subtype: "Ink",
        Rect: rect,
        InkList: [strokeToInkList(stroke, taille)],
        C: [r, g, b],
        CA: opacite,
        BS: sortie.context.obj({ W: strokeWidth(stroke, taille), S: "S" }),
        // Bit 3 : « imprimable ». Sans lui, l'annotation s'affiche mais ne
        // sort pas à l'impression, ce qui déroute tout le monde.
        F: 4,
        T: "Fiches",
        AP: sortie.context.obj({ N: sortie.context.register(apparence) }),
      });
      cible.node.addAnnot(sortie.context.register(annotation));
    }
  }

  return sortie.save();
}
