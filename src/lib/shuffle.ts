/**
 * Mélange de Fisher-Yates.
 *
 * L'ordre de saisie ne doit pas devenir un indice de rappel : sans mélange,
 * on finit par apprendre la séquence plutôt que le contenu.
 */
export function shuffle<T>(items: T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}
