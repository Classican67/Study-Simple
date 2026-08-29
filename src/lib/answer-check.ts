/**
 * Comparaison d'une réponse tapée avec la réponse attendue.
 *
 * Le but n'est pas la sévérité orthographique : quelqu'un qui écrit « mitose »
 * sans accent, ou qui tape « mithose », connaît sa réponse. Refuser ces cas
 * apprend à taper, pas à réviser. À l'inverse, un mot différent doit être
 * refusé, sinon l'exercice ne vaut rien.
 *
 * Module pur, sans dépendance : utilisable côté serveur comme dans un test.
 */

/**
 * Ramène une réponse à sa forme comparable : sans accent, sans ponctuation,
 * sans majuscule, sans espaces superflus, et sans article initial.
 */
export function normalize(value: string): string {
  return (
    value
      .normalize("NFD")
      // Retire les diacritiques décomposés par NFD (é → e + ́ ).
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      // La mise en forme n'est pas une réponse : on retire le balisage.
      .replace(/\{c:[a-z]+\}|\{\/c\}/g, "")
      .replace(/[*_~`#]/g, "")
      .replace(/[.,;:!?()[\]"'«»]/g, " ")
      // « la mitose » et « mitose » sont la même réponse.
      .replace(/^\s*(le|la|les|l|un|une|des|the|a|an)\s+/u, "")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Distance de Levenshtein, en n'gardant que deux lignes de la matrice. */
export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let previous = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      current[j] = Math.min(
        current[j - 1] + 1, // insertion
        previous[j] + 1, // suppression
        previous[j - 1] + cost, // substitution
      );
    }
    previous = current;
  }

  return previous[b.length];
}

export type AnswerVerdict = "exact" | "close" | "wrong";

/**
 * Tolérance proportionnelle à la longueur : une faute sur un mot court change
 * le sens (« sur » / « sud »), une faute sur une phrase longue est une coquille.
 */
function allowedDistance(length: number): number {
  if (length <= 4) return 0;
  if (length <= 8) return 1;
  return Math.min(3, Math.floor(length / 8));
}

export function checkAnswer(typed: string, expected: string): AnswerVerdict {
  const a = normalize(typed);
  const b = normalize(expected);

  if (!a) return "wrong";
  if (a === b) return "exact";

  // Une réponse attendue en plusieurs parties séparées par « / » ou « , »
  // accepte n'importe laquelle d'entre elles : les fiches de vocabulaire
  // listent souvent plusieurs traductions.
  const alternatives = b.split(/\s*[/]\s*/).filter(Boolean);
  if (alternatives.length > 1 && alternatives.some((alt) => alt === a)) return "exact";

  const distance = editDistance(a, b);
  if (distance <= allowedDistance(b.length)) return "close";

  return "wrong";
}
