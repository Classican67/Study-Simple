import "server-only";

import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { UPLOAD_DIR } from "@/lib/uploads";
import {
  DOCUMENT_TYPES,
  isDocumentType,
  MAX_DOCUMENT_BYTES,
  needsConversion,
} from "@/lib/upload-path";

/**
 * Import d'un document à annoter.
 *
 * Un seul format est **stocké** : le PDF. Tout le reste est converti à
 * l'import, et le fichier d'origine n'est pas conservé — l'affichage n'a ainsi
 * jamais qu'un format à savoir lire.
 *
 * La conversion est confiée à LibreOffice, installé dans l'image. C'est le seul
 * convertisseur libre dont la fidélité tient la route : il n'existe aucun
 * moteur de rendu `.docx` sérieux en JavaScript pur, et les alternatives sont
 * des services payants, donc hors de propos pour une installation chez soi.
 */

export type ImportError = { error: string };
/**
 * Le format de chaque page est relevé **ici**, à l'import.
 *
 * Il l'était dans le navigateur, juste après l'envoi : pdf.js retéléchargeait
 * alors le document entier pour n'en lire que les dimensions. Sur iPad, un
 * polycopié scanné de trente mégaoctets repartait donc du serveur aussitôt
 * après y être monté — l'import restait en « Conversion… » sans fin. Le serveur
 * a le fichier en main, il le mesure lui-même.
 */
export type ImportOk = { file: string; ratios: number[] };

export async function importDocument(file: File): Promise<ImportOk | ImportError> {
  const type = documentType(file);
  if (!type) {
    return { error: "Format non pris en charge. Importe un PDF ou un document Word." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: `Document trop lourd (${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo maximum).` };
  }

  const entree = Buffer.from(await file.arrayBuffer());

  let pdf: Buffer;
  if (needsConversion(type)) {
    const converti = await toPdf(entree, DOCUMENT_TYPES[type]);
    if ("error" in converti) return converti;
    pdf = converti.buffer;
  } else {
    // Un PDF arrive tel quel, mais on vérifie qu'il en est bien un : le type
    // MIME vient du client et ne prouve rien.
    if (entree.subarray(0, 5).toString("latin1") !== "%PDF-") {
      return { error: "Ce fichier n'est pas un PDF valide." };
    }
    pdf = entree;
  }

  const ratios = await pageRatios(pdf);
  if ("error" in ratios) return ratios;

  const nom = `${randomUUID()}.pdf`;
  await writeFile(path.join(UPLOAD_DIR, nom), pdf);
  return { file: nom, ratios: ratios.ratios };
}

/**
 * Type du document, déduit de l'en-tête HTTP **ou** de l'extension.
 *
 * iOS n'annonce pas toujours de type : un PDF ouvert depuis l'app Fichiers ou
 * reçu par AirDrop arrive régulièrement en `application/octet-stream`, parfois
 * avec un type vide. Se fier au seul en-tête faisait refuser sur iPad des
 * fichiers que le même navigateur acceptait sur Mac. L'extension ne prouve
 * rien non plus — mais un PDF est ensuite vérifié à ses octets, et tout le
 * reste passe par LibreOffice, qui refuse ce qu'il ne sait pas lire.
 */
function documentType(file: File): string | null {
  if (isDocumentType(file.type)) return file.type;
  const point = file.name.lastIndexOf(".");
  const extension = point === -1 ? "" : file.name.slice(point).toLowerCase();
  const trouve = Object.entries(DOCUMENT_TYPES).find(([, ext]) => ext === extension);
  return trouve?.[0] ?? null;
}

/**
 * Format de chaque page : hauteur rapportée à la largeur.
 *
 * Deux pièges, qui donnent des pages à l'envers ou décalées quand on les
 * oublie :
 *
 * - **La rotation.** Un scan est souvent stocké à l'horizontale avec un
 *   `/Rotate 90`. pdf.js affiche la page tournée ; mesurer la boîte sans tenir
 *   compte de l'angle donne le format couché pour une page qui s'affiche
 *   debout.
 * - **La boîte de rognage.** C'est la `CropBox` qui est affichée, pas la
 *   `MediaBox` : un document imposé pour l'impression porte des fonds perdus
 *   que le lecteur ne montre pas.
 */
async function pageRatios(pdf: Buffer): Promise<{ ratios: number[] } | ImportError> {
  try {
    const { PDFDocument } = await import("pdf-lib");
    // `ignoreEncryption` : beaucoup de PDF portent un chiffrement vide qui
    // n'interdit rien mais fait refuser le chargement.
    const doc = await PDFDocument.load(new Uint8Array(pdf), { ignoreEncryption: true });
    const ratios = doc.getPages().map((page) => {
      const { width, height } = page.getCropBox();
      const angle = ((page.getRotation().angle % 360) + 360) % 360;
      const couche = angle === 90 || angle === 270;
      const l = couche ? height : width;
      const h = couche ? width : height;
      return l > 0 ? Number((h / l).toFixed(4)) : 1;
    });
    if (ratios.length === 0) return { error: "Ce PDF ne contient aucune page." };
    return { ratios };
  } catch (error) {
    console.error("[documents] lecture des pages impossible :", error);
    return { error: "Ce PDF n'a pas pu être lu." };
  }
}

/**
 * Conversion vers PDF par LibreOffice.
 *
 * Le module est chargé à la demande : sur une installation où LibreOffice
 * n'est pas présent — un poste de développement, par exemple — l'app doit
 * continuer de fonctionner et se contenter de refuser les documents Word.
 */
async function toPdf(
  input: Buffer,
  extension: string,
): Promise<{ buffer: Buffer } | ImportError> {
  try {
    const libre = await import("libreoffice-convert");
    const convert = promisify(libre.default.convert) as (
      input: Buffer,
      format: string,
      filter: string | undefined,
    ) => Promise<Buffer>;

    // LibreOffice se lance en processus séparé et prend une à trois secondes.
    const buffer = await convert(input, ".pdf", undefined);
    return { buffer };
  } catch (error) {
    const message = String(error);
    // Le message le plus fréquent quand le binaire manque, et le seul cas où
    // l'on peut dire quelque chose d'utile à la personne.
    if (/ENOENT|not found|Could not find/i.test(message)) {
      return {
        error:
          "La conversion des documents Word demande LibreOffice, absent de cette installation. " +
          "Exporte le document en PDF avant de l'importer.",
      };
    }
    console.error(`[documents] conversion ${extension} impossible :`, error);
    return { error: "La conversion de ce document a échoué." };
  }
}
