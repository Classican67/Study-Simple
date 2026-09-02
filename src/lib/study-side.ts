/**
 * Sens de révision : quelle face de la carte porte la question.
 *
 * `term`       — le terme d'abord, on cherche sa définition. C'est le sens de
 *                lecture naturel, celui dans lequel les cartes sont écrites.
 * `definition` — la définition d'abord, on cherche le terme. Reconnaître un
 *                mot qu'on vous montre est bien plus facile que le retrouver
 *                de mémoire : c'est ce second sens qui prépare à répondre à
 *                une question d'examen, ou à parler une langue plutôt qu'à
 *                seulement la lire.
 */
export type StudySide = "term" | "definition";

/**
 * Comme l'ordre de passage, la préférence vit dans un **cookie** : le serveur
 * doit rendre la bonne face dès la première image, sinon la carte change sous
 * les yeux à l'hydratation. Simple réglage d'affichage, ni httpOnly ni signé.
 */
export const STUDY_SIDE_COOKIE = "fiches_study_side";

/** Le sens d'écriture des cartes reste le défaut : c'est le moins surprenant. */
export const DEFAULT_STUDY_SIDE: StudySide = "term";

export function isStudySide(value: unknown): value is StudySide {
  return value === "term" || value === "definition";
}

export type CardFaces = {
  question: string;
  answer: string;
  /**
   * L'image reste attachée à la définition, où que celle-ci se trouve : c'est
   * à côté d'elle qu'elle a été déposée dans l'éditeur, et l'en détacher
   * viderait la face qu'elle illustrait. En sens inverse, elle fait donc
   * partie de la question — un schéma à identifier, ce qui est précisément
   * l'exercice recherché.
   */
  questionImage: string | null;
  answerImage: string | null;
};

export function facesOf(
  card: { term: string; definition: string; imagePath: string | null },
  side: StudySide,
): CardFaces {
  return side === "definition"
    ? {
        question: card.definition,
        answer: card.term,
        questionImage: card.imagePath,
        answerImage: null,
      }
    : {
        question: card.term,
        answer: card.definition,
        questionImage: null,
        answerImage: card.imagePath,
      };
}
