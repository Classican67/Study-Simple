/*
 * Lit un document, page par page, et écrit ce qu'il y trouve.
 *
 * Processus à part, lancé par `lib/documents-index.ts` : rendre une page et la
 * passer à l'OCR occupe le processeur plusieurs secondes, et le faire dans le
 * serveur figerait les enregistrements de ceux qui écrivent pendant ce temps.
 * Un document illisible ne peut pas non plus emporter le serveur avec lui.
 *
 * Usage : node scripts/indexer-document.mjs <chemin> <depuis-la-page>
 * Écrit une ligne JSON par page : { page, ocr, mots: [[texte, x, y, l, h], …] },
 * coordonnées en proportion de la page. Une ligne { fin: true, pages } termine.
 *
 * La couche de texte d'un PDF d'abord : elle est exacte et instantanée. L'OCR
 * n'intervient que sur les pages qui n'en ont pas — les scans.
 *
 * Sans IA générative, sans réseau : les données de langue sont dans
 * `node_modules`, et rien ne sort de la machine.
 */
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** En dessous, la page n'a pas de vraie couche de texte : un numéro, un tampon. */
const TEXTE_MIN = 24;
/** Assez pour lire un corps 10 d'un scan ; au-delà, l'OCR ralentit sans mieux lire. */
const COTE_OCR = 2200;
/** Un mot reconnu sans conviction ferait des résultats fantômes. */
const CONFIANCE_MIN = 45;

const dire = (objet) => process.stdout.write(`${JSON.stringify(objet)}\n`);
const arrondi = (v) => Math.round(v * 10000) / 10000;

let ocr = null;
async function lecteur() {
  if (ocr) return ocr;
  const { createWorker, OEM } = await import("tesseract.js");
  // Hors ligne : `langPath` local, et rien dans le cache du répertoire courant.
  // Une langue absente de ce dossier ne fait pas d'erreur : l'initialisation
  // attend pour toujours. D'où une seule langue, dont l'alphabet couvre aussi
  // l'anglais des termes techniques.
  ocr = await createWorker("fra", OEM.LSTM_ONLY, {
    langPath: path.join(racine, "node_modules/@tesseract.js-data/fra/4.0.0_best_int"),
    cacheMethod: "none",
    gzip: true,
  });
  return ocr;
}

/** Les mots que l'OCR voit sur une image, en proportion de ses dimensions. */
async function lireImage(octets, largeur, hauteur) {
  const moteur = await lecteur();
  const { data } = await moteur.recognize(octets, {}, { blocks: true, text: false });
  const mots = [];
  for (const bloc of data.blocks ?? []) {
    for (const paragraphe of bloc.paragraphs ?? []) {
      for (const ligne of paragraphe.lines ?? []) {
        for (const mot of ligne.words ?? []) {
          const texte = (mot.text ?? "").trim();
          if (!texte || mot.confidence < CONFIANCE_MIN) continue;
          const { x0, y0, x1, y1 } = mot.bbox;
          mots.push([
            texte,
            arrondi(x0 / largeur),
            arrondi(y0 / hauteur),
            arrondi((x1 - x0) / largeur),
            arrondi((y1 - y0) / hauteur),
          ]);
        }
      }
    }
  }
  return mots;
}

async function indexerImage(chemin) {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(await readFile(chemin));
  const echelle = Math.min(1, COTE_OCR / Math.max(image.width, image.height));
  const l = Math.round(image.width * echelle);
  const h = Math.round(image.height * echelle);
  const canvas = createCanvas(l, h);
  const contexte = canvas.getContext("2d");
  contexte.fillStyle = "#ffffff";
  contexte.fillRect(0, 0, l, h);
  contexte.drawImage(image, 0, 0, l, h);
  dire({ page: 1, ocr: true, mots: await lireImage(canvas.toBuffer("image/png"), l, h) });
  dire({ fin: true, pages: 1 });
}

/** Une ligne de la couche de texte, découpée en mots à la proportion des lettres. */
function motsDeLaCouche(contenu, vue, pdfjs) {
  const mots = [];
  for (const item of contenu.items) {
    const chaine = item.str ?? "";
    if (!chaine.trim()) continue;
    const t = pdfjs.Util.transform(vue.transform, item.transform);
    const taille = Math.hypot(t[2], t[3]);
    const x = t[4];
    const y = t[5] - taille;
    const largeur = (item.width ?? 0) * vue.scale;
    const parLettre = chaine.length > 0 ? largeur / chaine.length : 0;
    for (const trouve of chaine.matchAll(/\S+/g)) {
      mots.push([
        trouve[0],
        arrondi((x + trouve.index * parLettre) / vue.width),
        arrondi(y / vue.height),
        arrondi((trouve[0].length * parLettre) / vue.width),
        arrondi((taille * 1.15) / vue.height),
      ]);
    }
  }
  return mots;
}

async function indexerPdf(chemin, depuis) {
  const { createCanvas } = await import("@napi-rs/canvas");
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const octets = new Uint8Array(await readFile(chemin));
  const chargement = pdfjs.getDocument({
    data: octets,
    useSystemFonts: true,
    isEvalSupported: false,
    verbosity: 0,
    standardFontDataUrl: `${path.join(path.dirname(require.resolve("pdfjs-dist/package.json")), "standard_fonts")}/`,
  });
  const doc = await chargement.promise;

  for (let numero = depuis; numero <= doc.numPages; numero++) {
    const page = await doc.getPage(numero);
    const vue = page.getViewport({ scale: 1 });
    const contenu = await page.getTextContent();
    const lettres = contenu.items.reduce((n, item) => n + (item.str ?? "").replace(/\s/g, "").length, 0);

    if (lettres >= TEXTE_MIN) {
      dire({ page: numero, ocr: false, mots: motsDeLaCouche(contenu, vue, pdfjs) });
    } else {
      const echelle = COTE_OCR / Math.max(vue.width, vue.height);
      const rendu = page.getViewport({ scale: echelle });
      const canvas = createCanvas(Math.ceil(rendu.width), Math.ceil(rendu.height));
      await page.render({ canvas, canvasContext: canvas.getContext("2d"), viewport: rendu }).promise;
      const mots = await lireImage(canvas.toBuffer("image/png"), canvas.width, canvas.height);
      dire({ page: numero, ocr: true, mots });
    }
    page.cleanup();
  }
  dire({ fin: true, pages: doc.numPages });
  await chargement.destroy();
}

const [chemin, depuis = "1"] = process.argv.slice(2);
try {
  if (chemin.toLowerCase().endsWith(".pdf")) await indexerPdf(chemin, Number(depuis) || 1);
  else await indexerImage(chemin);
} catch (erreur) {
  dire({ erreur: String(erreur?.message ?? erreur).slice(0, 300) });
  process.exitCode = 1;
} finally {
  await ocr?.terminate().catch(() => {});
}
