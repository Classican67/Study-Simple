import type { TextColor } from "@/components/rich-text";

/**
 * Les couleurs du texte, telles qu'elles sont sur du papier.
 *
 * Les mêmes teintes que `.text-c-*`, en RVB : un PDF ne connaît pas `oklch`.
 */
const COULEURS: Record<TextColor, [number, number, number]> = {
  rose: [0.74, 0.05, 0.27],
  amber: [0.53, 0.3, 0.0],
  emerald: [0.0, 0.41, 0.25],
  blue: [0.0, 0.36, 0.66],
  violet: [0.42, 0.2, 0.78],
};

export const ENCRE_TEXTE: [number, number, number] = [0.1, 0.1, 0.12];

export function couleurTexte(nom: TextColor): [number, number, number] {
  return COULEURS[nom] ?? ENCRE_TEXTE;
}
