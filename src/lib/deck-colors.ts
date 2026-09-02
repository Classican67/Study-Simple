/**
 * Palette d'accent des paquets et des dossiers — sans `server-only`, pour que
 * les composants client puissent l'utiliser eux aussi.
 *
 * Doit rester alignée sur PICKER_COLORS (sélecteur de couleur) et sur
 * l'énumération de validation : ces trois listes décrivent la même palette.
 */
export const DECK_COLORS = {
  violet: "oklch(52% 0.21 292)",
  blue: "oklch(52% 0.17 250)",
  emerald: "oklch(50% 0.14 160)",
  amber: "oklch(58% 0.15 70)",
  rose: "oklch(54% 0.19 15)",
  slate: "oklch(52% 0.02 285)",
} as const;

export type DeckColor = keyof typeof DECK_COLORS;

/** Repli sur le violet : une couleur inconnue ne doit pas casser l'affichage. */
export function deckColor(name: string): string {
  return DECK_COLORS[name as DeckColor] ?? DECK_COLORS.violet;
}
