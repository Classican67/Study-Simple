/**
 * Préparer une image venue d'ailleurs — collée, déposée — avant de l'envoyer.
 *
 * Une capture d'écran d'iPad pèse plusieurs mégaoctets et une image copiée d'une
 * page web peut être en WebP ou en AVIF. Or un PDF exporté ne sait embarquer que
 * le JPEG et le PNG, et le serveur refuse au-delà de huit mégaoctets : une image
 * acceptée à l'écran disparaîtrait à l'export. On normalise donc ici, là où le
 * navigateur a déjà de quoi la décoder.
 */

import { MAX_UPLOAD_BYTES } from "@/lib/upload-path";

/** Assez de définition pour zoomer six fois sans voir les pixels. */
export const COTE_MAX = 2400;

export type ImagePrete = { file: File; ratio: number };

function charger(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("image illisible"));
    image.src = url;
  });
}

function versFichier(canvas: HTMLCanvasElement, type: string): Promise<File> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (!blob) reject(new Error("image illisible"));
        else resolve(new File([blob], type === "image/png" ? "image.png" : "image.jpg", { type }));
      },
      type,
      0.9,
    );
  });
}

export async function preparerImage(file: File): Promise<ImagePrete> {
  const url = URL.createObjectURL(file);
  try {
    const image = await charger(url);
    const largeur = image.naturalWidth;
    const hauteur = image.naturalHeight;
    if (largeur === 0 || hauteur === 0) throw new Error("image illisible");
    const ratio = hauteur / largeur;

    const format = file.type === "image/jpeg" || file.type === "image/png";
    const cote = Math.max(largeur, hauteur);
    if (format && cote <= COTE_MAX && file.size <= MAX_UPLOAD_BYTES) return { file, ratio };

    const echelle = Math.min(1, COTE_MAX / cote);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(largeur * echelle);
    canvas.height = Math.round(hauteur * echelle);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("image illisible");

    /*
     * Le PNG garde la transparence d'un schéma détouré. Mais une capture d'écran
     * re-encodée en PNG peut rester au-dessus de la limite : c'est alors le JPEG
     * qui passe, sur fond blanc — il n'a pas de transparence, et le noir qu'il
     * mettrait à la place serait pire.
     */
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await versFichier(canvas, "image/png");
    if (png.size <= MAX_UPLOAD_BYTES) return { file: png, ratio };

    context.globalCompositeOperation = "destination-over";
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return { file: await versFichier(canvas, "image/jpeg"), ratio };
  } finally {
    URL.revokeObjectURL(url);
  }
}
