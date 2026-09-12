/**
 * Validation des noms de fichiers images — sans accès disque, donc testable
 * seule. `uploads.ts`, qui écrit réellement, est marqué `server-only`.
 */

// Liste blanche : on ne se fie jamais à l'extension du nom envoyé par le
// client, on impose l'extension à partir du type MIME accepté.
export const ALLOWED_TYPES: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

/**
 * Documents importables dans une page manuscrite, pour les annoter.
 *
 * Seul le PDF est **stocké** : tout le reste est converti à l'import. On ne
 * garde donc jamais qu'un format, ce qui évite d'avoir à savoir lire un
 * traitement de texte au moment de l'affichage.
 */
export const DOCUMENT_TYPES: Record<string, string> = {
  "application/pdf": ".pdf",
  // Convertis en PDF par LibreOffice à l'import : il n'existe aucun moteur de
  // rendu fidèle pour ces formats en JavaScript pur.
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
  "application/msword": ".doc",
  "application/vnd.oasis.opendocument.text": ".odt",
  "application/rtf": ".rtf",
};

/** Formats qui demandent une conversion avant d'être stockés. */
export function needsConversion(mimeType: string): boolean {
  return mimeType in DOCUMENT_TYPES && DOCUMENT_TYPES[mimeType] !== ".pdf";
}

export function isDocumentType(mimeType: string): boolean {
  return mimeType in DOCUMENT_TYPES;
}

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 Mo
/** Un cours scanné dépasse vite huit mégaoctets ; un document reste borné. */
export const MAX_DOCUMENT_BYTES = 40 * 1024 * 1024; // 40 Mo

/**
 * Tous les noms sont produits par saveUpload : un UUID v4 suivi d'une
 * extension de la liste blanche. On valide donc par liste blanche plutôt que
 * par liste noire, ce qui écarte d'office séparateurs, `../`, encodages
 * exotiques et octets nuls.
 */
export const UPLOAD_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|avif|pdf)$/;

export function isValidUploadName(fileName: string): boolean {
  return UPLOAD_NAME_PATTERN.test(fileName);
}

export function extensionFor(mimeType: string): string | undefined {
  return ALLOWED_TYPES[mimeType];
}

export function contentTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  const match = Object.entries(ALLOWED_TYPES).find(([, value]) => value === extension);
  return match?.[0] ?? "application/octet-stream";
}

/**
 * Interprète un en-tête `Range`.
 *
 * On ne gère que la forme à une seule plage : c'est la seule que pdf.js
 * émette, et répondre du multipart pour les autres coûterait plus que de les
 * ignorer — un client qui demande mieux se contente très bien d'un 200.
 */
export function parseRange(
  header: string | null,
  taille: number,
): { debut: number; fin: number } | null | "invalide" {
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, brutDebut, brutFin] = match;
  if (brutDebut === "" && brutFin === "") return "invalide";

  // `bytes=-500` : les cinq cents derniers octets.
  if (brutDebut === "") {
    const longueur = Number(brutFin);
    if (longueur === 0) return "invalide";
    return { debut: Math.max(0, taille - longueur), fin: taille - 1 };
  }

  const debut = Number(brutDebut);
  if (debut >= taille) return "invalide";
  // Une fin absente, ou au-delà du fichier, est ramenée au dernier octet :
  // c'est ce que demande la RFC, et pdf.js s'appuie dessus pour la dernière
  // plage d'un document.
  const fin = brutFin === "" ? taille - 1 : Math.min(Number(brutFin), taille - 1);
  if (fin < debut) return "invalide";
  return { debut, fin };
}
