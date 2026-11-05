import { alphaParPasse, INK_REF, instrumentOf } from "@/lib/ink";
import { resolveInk } from "@/lib/ink-color";
import { toPlainText } from "@/components/rich-text";
import { peindreZones } from "@/components/note/zones-texte";
import { pathsOf } from "@/lib/ink-paths";
import { ATTRIBUT_MARQUE, type FragmentMarque } from "@/lib/presse-papiers-encre";
import type { FragmentEncre } from "@/lib/fragment-encre";
import { PAPER_COLORS } from "@/lib/notes";

/**
 * L'image d'un fragment : ce que reçoit le presse-papiers du système.
 *
 * Sur le papier de l'app et avec ses encres, quel que soit le thème : en thème
 * sombre, la feuille de style rend l'encre claire, et l'on collerait dans un
 * traitement de texte des mots blancs sur une page blanche.
 */

/** Pixels pour une page entière : assez pour rester net collé en pleine page. */
const DEFINITION = 2000;
const MARGE = 0.012;

function chargerImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    // Une image absente ne doit pas priver du reste du fragment.
    image.onerror = () => resolve(null);
    image.src = url;
  });
}

export async function fragmentEnPng(fragment: FragmentEncre): Promise<Blob> {
  const { cadre } = fragment;
  const largeur = cadre.maxX - cadre.minX + MARGE * 2;
  const hauteur = cadre.maxY - cadre.minY + MARGE * 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(largeur * DEFINITION));
  canvas.height = Math.max(1, Math.round(hauteur * DEFINITION));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("canevas indisponible");

  context.fillStyle = PAPER_COLORS.fond;
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.scale(DEFINITION, DEFINITION);
  context.translate(MARGE - cadre.minX, MARGE - cadre.minY);

  for (const image of fragment.images) {
    const element = await chargerImage(`/api/uploads/${image.file}`);
    if (!element) continue;
    const h = image.w * image.ratio;
    context.save();
    context.translate(image.x + image.w / 2, image.y + h / 2);
    context.rotate(image.angle);
    context.drawImage(element, -image.w / 2, -h / 2, image.w, h);
    context.restore();
  }

  // Une feuille `ink-clair`, le temps de lire ses encres : c'est la teinte que
  // la page aurait sur du papier.
  const temoin = document.createElement("div");
  temoin.className = "ink-clair";
  temoin.hidden = true;
  document.body.appendChild(temoin);
  const styles = getComputedStyle(temoin);

  peindreZones(context, fragment.textes ?? [], toPlainText, resolveInk(styles, "default"));

  context.scale(1 / INK_REF, 1 / INK_REF);
  const ordonnes = [...fragment.strokes].sort(
    (a, b) => Number(instrumentOf(b.tool).dessous) - Number(instrumentOf(a.tool).dessous),
  );
  for (const stroke of ordonnes) {
    const chemins = pathsOf(stroke);
    if (chemins.length === 0) continue;
    context.globalAlpha = alphaParPasse(instrumentOf(stroke.tool).alpha, chemins.length);
    context.fillStyle = resolveInk(styles, stroke.color);
    for (const chemin of chemins) context.fill(chemin);
  }
  temoin.remove();

  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("image vide"))), "image/png");
  });
}

/**
 * Dépose le fragment dans le presse-papiers du système.
 *
 * Refusé sur certains navigateurs, ou quand l'onglet n'a pas le focus : ce n'est
 * pas une erreur, le fragment reste gardé par l'app et se recolle dans l'app.
 *
 * L'image est donnée **sous forme de promesse** : Safari exige que l'écriture
 * parte dans le geste même, or la fabrication de l'image est asynchrone.
 */
export async function deposerFragment(fragment: FragmentMarque): Promise<void> {
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) return;
  try {
    await navigator.clipboard.write([
      new ClipboardItem({
        "image/png": fragmentEnPng(fragment),
        "text/html": new Blob([`<span ${ATTRIBUT_MARQUE}="${fragment.marque}"></span>`], {
          type: "text/html",
        }),
      }),
    ]);
  } catch {
    // Voir plus haut : l'app garde sa copie.
  }
}
