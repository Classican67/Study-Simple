import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

// Dossier des images. En prod c'est le montage NAS (cf. UPLOAD_DIR dans compose).
// turbopackIgnore : sans lui, l'analyse statique de Turbopack voit un chemin
// dynamique et embarque tout le projet dans la sortie standalone.
export const UPLOAD_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "./data/uploads",
);

export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024; // 8 Mo

// Liste blanche : on ne se fie pas à l'extension du nom envoyé par le client,
// on impose l'extension à partir du type MIME qu'on accepte.
const ALLOWED: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
  "image/gif": ".gif",
  "image/avif": ".avif",
};

export class UploadError extends Error {}

export async function saveUpload(file: File): Promise<string> {
  const extension = ALLOWED[file.type];
  if (!extension) {
    throw new UploadError("Format non supporté (JPEG, PNG, WebP, GIF ou AVIF uniquement)");
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new UploadError("Image trop lourde (8 Mo maximum)");
  }

  await mkdir(UPLOAD_DIR, { recursive: true });

  // Nom généré côté serveur : le nom d'origine n'atteint jamais le disque,
  // ce qui règle d'un coup la traversée de chemin et les collisions.
  const fileName = `${randomUUID()}${extension}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  await writeFile(path.join(/* turbopackIgnore: true */ UPLOAD_DIR, fileName), bytes);

  return fileName;
}

// Tous les noms de fichiers sont produits par saveUpload : un UUID v4 suivi
// d'une extension de la liste blanche. On peut donc valider par liste blanche
// plutôt que par liste noire, et refuser d'office tout ce qui n'a pas cette
// forme exacte — séparateurs, ../, encodages exotiques et octets nuls compris.
const FILE_NAME_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp|gif|avif)$/;

// Résout un nom de fichier stocké en base vers un chemin absolu dans UPLOAD_DIR.
export function resolveUploadPath(fileName: string): string | null {
  if (!FILE_NAME_PATTERN.test(fileName)) return null;
  return path.join(UPLOAD_DIR, fileName);
}

export async function deleteUpload(fileName: string) {
  const target = resolveUploadPath(fileName);
  if (!target) return;
  // Le fichier peut déjà être parti (suppression concurrente, ménage manuel
  // sur le NAS) : son absence n'est pas une erreur pour l'appelant.
  await unlink(target).catch(() => {});
}

export function contentTypeFor(fileName: string): string {
  const extension = path.extname(fileName).toLowerCase();
  const match = Object.entries(ALLOWED).find(([, value]) => value === extension);
  return match?.[0] ?? "application/octet-stream";
}
