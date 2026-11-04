import { parseDrawing, type DrawingContent, type Stroke } from "@/lib/notes";

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
/**
 * …et borné en **poids**, pas seulement en nombre.
 *
 * Chaque enregistrement d'une page laisse une version de plus dans le cache.
 * Vingt-quatre versions d'une page de trois cents kilooctets, ce n'est rien ;
 * vingt-quatre versions d'un polycopié de trente mégaoctets, c'est sept cents
 * mégaoctets, et Safari ferme l'onglet. La dernière entrée reste toujours :
 * c'est celle dont l'écho va revenir.
 */
const CARACTERES_MAX = 48_000_000;

const cache = new Map<string, DrawingContent>();
let caracteres = 0;

function retenir(raw: string, content: DrawingContent) {
  // Réinsérer remet l'entrée en fin de file : `Map` conserve l'ordre
  // d'insertion, ce qui suffit à en faire une file de moindre usage.
  if (cache.delete(raw)) caracteres -= raw.length;
  cache.set(raw, content);
  caracteres += raw.length;
  while (cache.size > 1 && (cache.size > TAILLE_MAX || caracteres > CARACTERES_MAX)) {
    const plusAncien = cache.keys().next().value;
    if (plusAncien === undefined) break;
    cache.delete(plusAncien);
    caracteres -= plusAncien.length;
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

/**
 * Le texte JSON d'un dessin, **identique** à `JSON.stringify(content)`, sans
 * en payer le prix à chaque fois.
 *
 * Ce qui coûte dans `JSON.stringify`, ce sont les nombres : des centaines de
 * milliers de coordonnées à mettre en texte, soit cent cinquante millisecondes
 * pour vingt mégaoctets — sur le fil principal, à chaque enregistrement, donc
 * entre deux mots. Or un trait ne change jamais une fois posé : la gomme, le
 * déplacement, Annuler produisent des traits **neufs**. Le texte de chacun est
 * donc gardé à côté de lui, et l'enregistrement suivant ne convertit que ce
 * qui est nouveau. Le reste est recollé.
 *
 * `WeakMap` : un trait oublié — effacé, annulé hors de l'historique — emporte
 * son texte avec lui.
 */
const textes = new WeakMap<Stroke, string>();

export function serialiserDessin(content: DrawingContent): string {
  const parts = content.strokes.map((trait) => {
    let texte = textes.get(trait);
    if (texte === undefined) {
      texte = JSON.stringify(trait);
      textes.set(trait, texte);
    }
    return texte;
  });
  // La coque donne l'ordre exact des clés : celui de `JSON.stringify` sur
  // l'objet entier, qu'il faut reproduire au caractère près.
  const coque = JSON.stringify({ ...content, strokes: [] });
  const vide = '"strokes":[]';
  const i = coque.indexOf(vide);
  return `${coque.slice(0, i)}"strokes":[${parts.join(",")}]${coque.slice(i + vide.length)}`;
}
