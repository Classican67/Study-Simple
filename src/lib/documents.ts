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
export type ImportOk = { file: string };

export async function importDocument(file: File): Promise<ImportOk | ImportError> {
  if (!isDocumentType(file.type)) {
    return { error: "Format non pris en charge. Importe un PDF ou un document Word." };
  }
  if (file.size > MAX_DOCUMENT_BYTES) {
    return { error: `Document trop lourd (${Math.round(MAX_DOCUMENT_BYTES / 1024 / 1024)} Mo maximum).` };
  }

  const entree = Buffer.from(await file.arrayBuffer());

  let pdf: Buffer;
  if (needsConversion(file.type)) {
    const converti = await toPdf(entree, DOCUMENT_TYPES[file.type]);
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

  const nom = `${randomUUID()}.pdf`;
  await writeFile(path.join(UPLOAD_DIR, nom), pdf);
  return { file: nom };
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
