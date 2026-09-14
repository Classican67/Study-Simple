import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { PDFDocument, rgb } from "pdf-lib";

import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { boundsOf, translateStroke } from "@/lib/ink";
import {
  isBackdropPage,
  pageAtY,
  pageBands,
  parseDrawing,
  UNTITLED,
  type PageBand,
  type Paper,
  type Stroke,
} from "@/lib/notes";
import {
  PAPER_RGB,
  inkRgb,
  paperGuides,
  strokeOpacity,
  strokeRect,
  strokeToInkList,
  strokeToPdfOperators,
  strokeToSvgPath,
  strokeWidth,
  type PageSize,
} from "@/lib/pdf-export";
import { UPLOAD_DIR } from "@/lib/uploads";
import { isValidUploadName } from "@/lib/upload-path";

/**
 * Export d'une note annotée en PDF.
 *
 *   GET /api/notes/<id>/pdf?mode=flat|annot
 *
 * Deux formes, celles qu'offrent les applications de référence :
 *
 * - **`flat`** — les traits sont fusionnés dans le contenu de la page. Le
 *   document s'affiche à l'identique partout, et personne ne peut déplacer ni
 *   retirer les annotations. C'est la forme à partager, et le défaut.
 * - **`annot`** — les traits deviennent des annotations `/Ink` conformes à
 *   ISO 32000, avec leur flux d'apparence. Elles restent manipulables dans un
 *   lecteur qui le permet. Le flux d'apparence n'est pas optionnel : sans lui,
 *   chaque lecteur décide s'il affiche quelque chose — c'est ainsi que des
 *   fichiers annotés finissent illisibles ailleurs.
 *
 * Le document d'origine n'est jamais modifié : on en copie les pages dans un
 * nouveau document.
 */
export async function GET(request: Request, context: RouteContext<"/api/notes/[noteId]/pdf">) {
  const user = await requireUser();
  const { noteId } = await context.params;
  const mode = new URL(request.url).searchParams.get("mode") === "annot" ? "annot" : "flat";

  const note = await prisma.note.findFirst({
    where: { id: noteId, ownerId: user.id },
    select: {
      title: true,
      blocks: {
        where: { kind: "drawing" },
        orderBy: { position: "asc" },
        select: { content: true },
      },
    },
  });
  if (!note) return NextResponse.json({ error: "Note introuvable." }, { status: 404 });

  const blocs = note.blocks.map((b) => parseDrawing(b.content));

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
        // Une page ajoutée porte son propre fond ; une page du document n'en a
        // pas besoin, son image en tient lieu.
        paper: isBackdropPage(band) ? "blank" : band.paper,
        ratio: band.ratio,
        strokes: parPage[index],
      }),
    );
  }

  if (feuilles.length === 0) {
    return NextResponse.json(
      { error: "Cette note ne contient aucune page manuscrite." },
      { status: 400 },
    );
  }

  const sortie = await PDFDocument.create();
  sortie.setTitle(note.title.trim() || UNTITLED);
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
        const chemin = strokeToSvgPath(stroke, taille);
        if (!chemin) continue;
        const [r, g, b] = inkRgb(stroke.color);
        cible.drawSvgPath(chemin, {
          color: rgb(r, g, b),
          borderWidth: 0,
          opacity: strokeOpacity(stroke),
          // `drawSvgPath` place l'origine en haut à gauche par défaut ; nos
          // coordonnées sont déjà en repère PDF, on neutralise donc le décalage.
          x: 0,
          y: taille.height,
          scale: 1,
        });
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

  const octets = await sortie.save();
  const nom = `${(note.title.trim() || UNTITLED).replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 60) || "note"}.pdf`;

  return new NextResponse(Buffer.from(octets), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${nom}"`,
      // Un export est un instantané : le remettre en cache donnerait un
      // fichier périmé au téléchargement suivant.
      "Cache-Control": "no-store",
    },
  });
}
