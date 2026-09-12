import { parseDrawing, type DrawingContent } from "@/lib/notes";

/**
 * Analyse mémorisée du contenu d'une page manuscrite.
 *
 * Le contenu d'un bloc circule en **texte JSON** : c'est ce qui part au
 * serveur, et c'est ce que garde l'état de l'éditeur. Mais le canevas travaille
 * sur des objets, et l'éditeur se rendait à nouveau à chaque trait posé — donc
 * `JSON.parse` d'une page entière à chaque lettre écrite, et un objet neuf à
 * chaque fois.
 *
 * Deux conséquences, et les deux se voyaient à l'écran :
 *
 * 1. **Le coût de l'analyse.** Une page dense pèse des centaines de
 *    kilooctets ; la relire à chaque trait coûte plus que de le dessiner.
 * 2. **L'identité perdue.** Le canevas garde ses traits en propre et compare la
 *    liste reçue à la sienne pour savoir si le changement vient de
 *    l'extérieur. Un objet neuf à chaque rendu lui faisait croire à un
 *    rechargement, et il repeignait tout — à chaque lettre.
 *
 * `souvenirDessin` règle les deux d'un coup : quand le canevas produit un
 * contenu, on associe d'avance le texte à **l'objet même** qui l'a produit.
 * L'écho revient donc à l'identique, et il n'y a plus rien à faire.
 */

/** Assez pour toutes les pages d'une note ouverte, sans retenir la mémoire. */
const TAILLE_MAX = 24;

const cache = new Map<string, DrawingContent>();

function retenir(raw: string, content: DrawingContent) {
  // Réinsérer remet l'entrée en fin de file : `Map` conserve l'ordre
  // d'insertion, ce qui suffit à en faire une file de moindre usage.
  cache.delete(raw);
  cache.set(raw, content);
  while (cache.size > TAILLE_MAX) {
    const plusAncien = cache.keys().next().value;
    if (plusAncien === undefined) break;
    cache.delete(plusAncien);
  }
}

export function analyserDessin(raw: string): DrawingContent {
  const connu = cache.get(raw);
  if (connu) {
    retenir(raw, connu);
    return connu;
  }
  const content = parseDrawing(raw);
  retenir(raw, content);
  return content;
}

/** Associe un texte à l'objet qui l'a produit, avant même qu'on le relise. */
export function souvenirDessin(raw: string, content: DrawingContent) {
  retenir(raw, content);
}
