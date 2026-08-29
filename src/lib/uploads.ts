import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import path from "node:path";

import {
  MAX_UPLOAD_BYTES,
  extensionFor,
  isValidUploadName,
} from "@/lib/upload-path";

// Dossier des images. En prod c'est le montage NAS (cf. UPLOAD_DIR dans compose).
// turbopackIgnore : sans lui, l'analyse statique de Turbopack voit un chemin
// dynamique et embarque tout le projet dans la sortie standalone.
export const UPLOAD_DIR = path.resolve(
  /* turbopackIgnore: true */ process.env.UPLOAD_DIR ?? "./data/uploads",
);

// La validation des noms et des types vit dans upload-path.ts, sans
// `server-only`, pour rester testable sans accès disque.
export { MAX_UPLOAD_BYTES, contentTypeFor } from "@/lib/upload-path";

export class UploadError extends Error {}

export async function saveUpload(file: File): Promise<string> {
  const extension = extensionFor(file.type);
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

// Résout un nom de fichier stocké en base vers un chemin absolu dans UPLOAD_DIR.
export function resolveUploadPath(fileName: string): string | null {
  if (!isValidUploadName(fileName)) return null;
  return path.join(UPLOAD_DIR, fileName);
}

export async function deleteUpload(fileName: string) {
  const target = resolveUploadPath(fileName);
  if (!target) return;
  // Le fichier peut déjà être parti (suppression concurrente, ménage manuel
  // sur le NAS) : son absence n'est pas une erreur pour l'appelant.
  await unlink(target).catch(() => {});
}


