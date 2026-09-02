import { shuffle } from "@/lib/shuffle";

/**
 * Ordre de passage des cartes en révision.
 *
 * `deck`    — l'ordre du paquet, celui dans lequel les cartes ont été écrites.
 *             Utile quand la suite a un sens : les phases d'un processus, une
 *             chronologie, une démonstration.
 * `shuffle` — mélangé. Évite d'apprendre la séquence plutôt que le contenu :
 *             on finit sinon par reconnaître une réponse à sa seule position.
 */
export type StudyOrder = "deck" | "shuffle";

/**
 * La préférence vit dans un **cookie**, et non dans localStorage : le serveur
 * doit pouvoir la lire pour rendre la bonne carte dès la première image.
 * Autrement, le serveur afficherait une carte et le client une autre — un
 * désaccord d'hydratation visible à l'écran.
 *
 * Ce n'est qu'un réglage d'affichage : ni httpOnly, ni signature nécessaires.
 */
export const STUDY_ORDER_COOKIE = "fiches_study_order";

/**
 * L'ordre du paquet est le défaut.
 *
 * Le mélange mémorise mieux — il empêche de reconnaître une réponse à sa
 * position — mais démarrer sur un ordre imprévisible surprend, surtout juste
 * après avoir écrit ses cartes. Le choix reste à un geste, et il est retenu
 * d'une session à l'autre.
 */
export const DEFAULT_STUDY_ORDER: StudyOrder = "deck";

export function isStudyOrder(value: unknown): value is StudyOrder {
  return value === "deck" || value === "shuffle";
}

/** Applique l'ordre choisi. Ne modifie jamais le tableau reçu. */
export function orderCards<T>(cards: T[], order: StudyOrder): T[] {
  return order === "shuffle" ? shuffle(cards) : [...cards];
}

/**
 * Réordonne la file en cours sans revenir sur les cartes déjà jouées.
 *
 * Deux exigences : la carte affichée ne doit pas changer sous les yeux de
 * l'utilisateur, et repasser en ordre du paquet doit vraiment le restaurer —
 * d'où `referenceIds`, qui porte l'ordre d'origine. Se contenter de la file
 * courante ne ferait que figer le mélange déjà appliqué.
 *
 * Seuls les identifiants circulent : le serveur envoie déjà les cartes une
 * fois, inutile de les dupliquer pour porter un ordre.
 */
export function reorderQueue<T extends { id: string }>(
  queue: T[],
  referenceIds: string[],
  order: StudyOrder,
): T[] {
  if (queue.length <= 1) return [...queue];

  const [current, ...rest] = queue;
  if (order === "shuffle") return [current, ...shuffle(rest)];

  const rank = new Map(referenceIds.map((id, index) => [id, index]));
  const sorted = [...rest].sort(
    (a, b) => (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
  return [current, ...sorted];
}
