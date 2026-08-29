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

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 Mo

/**
 * Tous les noms sont produits par saveUpload : un UUID v4 suivi d'une
 * extension de la liste blanche. On valide donc par liste blanche plutôt que
 * par liste noire, ce qui écarte d'office séparateurs, `../`, encodages
 * exotiques et octets nuls.
 */
export const UPLOAD_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|avif)$/;

export function isValidUploadName(fileName: string): boolean {
  return UPLOAD_NAME_PATTERN.test(fileName);
}

export function extensionFor(mimeType: string): string | undefined {
  return ALLOWED_TYPES[mimeType];
}

export function contentTypeFor(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const extension = dot === -1 ? "" : fileName.slice(dot).toLowerCase();
  const match = Object.entries(ALLOWED_TYPES).find(([, value]) => value === extension);
  return match?.[0] ?? "application/octet-stream";
}
