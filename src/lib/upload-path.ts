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
