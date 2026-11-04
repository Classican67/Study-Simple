/**
 * Ce qui a changé entre deux versions d'un bloc — pour n'envoyer que cela.
 *
 * Un document importé est **un** bloc : ses quarante pages et tout ce qu'on y
 * a écrit tiennent dans le même contenu. L'enregistrement automatique le
 * renvoyait en entier à chaque seconde d'écriture, et il butait sur deux
 * murs : le plafond du bloc (deux mégaoctets, sept pages denses au stylet), où
 * le serveur répondait 413 et la file cessait de réessayer — on annotait sans
 * que rien ne parte plus —, et celui du proxy de Next, qui ne garde que les
 * dix premiers mégaoctets d'un corps de requête.
 *
 * Un trait ajouté, un coup de gomme, une page glissée ne touchent qu'un
 * morceau du texte JSON. On envoie donc le **morceau** : le préfixe et le
 * suffixe communs aux deux versions restent au serveur, seul le milieu
 * voyage. Un trait de plus pèse quelques kilooctets, quel que soit le poids
 * du document.
 *
 * La comparaison porte sur le **texte**, pas sur les traits : elle vaut pour
 * tous les genres de blocs, elle ne demande aucune analyse, et elle ne peut
 * pas se tromper sur ce qu'est « le même trait ». Le serveur vérifie qu'il
 * part bien de la même version que le client (`empreinte`), sans quoi il
 * refuse et le client renvoie tout.
 */

export type Delta = {
  /** Empreinte SHA-256 (hex) de la version de départ. */
  base: string;
  /** Début du morceau remplacé, en unités UTF-16 — celles de `String.slice`. */
  debut: number;
  /** Fin du morceau remplacé dans la version de départ. */
  fin: number;
  inserer: string;
};

/** Le morceau qui diffère, ou `null` si les deux versions sont identiques. */
export function calculerDelta(
  avant: string,
  apres: string,
): { debut: number; fin: number; inserer: string } | null {
  if (avant === apres) return null;
  const borne = Math.min(avant.length, apres.length);
  let debut = 0;
  while (debut < borne && avant.charCodeAt(debut) === apres.charCodeAt(debut)) debut++;
  // Le suffixe commun ne doit pas mordre sur le préfixe : « aa » → « aaa »
  // donnerait sinon un morceau de longueur négative.
  let suffixe = 0;
  const maxSuffixe = borne - debut;
  while (
    suffixe < maxSuffixe &&
    avant.charCodeAt(avant.length - 1 - suffixe) === apres.charCodeAt(apres.length - 1 - suffixe)
  ) {
    suffixe++;
  }
  return { debut, fin: avant.length - suffixe, inserer: apres.slice(debut, apres.length - suffixe) };
}

/** Rejoue un morceau sur la version de départ ; `null` s'il ne s'y applique pas. */
export function appliquerDelta(
  base: string,
  delta: Pick<Delta, "debut" | "fin" | "inserer">,
): string | null {
  const { debut, fin, inserer } = delta;
  if (
    !Number.isInteger(debut) ||
    !Number.isInteger(fin) ||
    typeof inserer !== "string" ||
    debut < 0 ||
    fin < debut ||
    fin > base.length
  ) {
    return null;
  }
  return base.slice(0, debut) + inserer + base.slice(fin);
}

/**
 * En dessous de cette taille, on envoie tout : le calcul et l'empreinte ne
 * valent pas la peine, et un envoi complet ne peut jamais rater sa base.
 */
export const DELTA_SEUIL = 64 * 1024;

/**
 * Le morceau a-t-il pu toucher l'une de ces clés JSON ?
 *
 * Le serveur relit les fichiers d'un bloc à chaque enregistrement, pour
 * effacer ceux d'une page retirée : deux analyses du document entier, avant et
 * après, pour un trait de plus — le poids du polycopié revenait par là. Or un
 * fichier ne figure dans un bloc que sous `"file":"<nom>"` ou
 * `"image":"<nom>"`, et un nom fait au plus cent vingt-huit caractères : si
 * aucune de ces clés n'apparaît **autour** du morceau, avant comme après, la
 * liste des fichiers n'a pas pu changer.
 *
 * La marge englobe la clé et la valeur entières : un morceau tombé au milieu
 * d'un nom voit encore la clé qui le précède.
 */
export function deltaTouche(
  base: string,
  delta: Pick<Delta, "debut" | "fin" | "inserer">,
  cles: string[],
  marge = 160,
): boolean {
  const gauche = base.slice(Math.max(0, delta.debut - marge), delta.debut);
  const droite = base.slice(delta.fin, Math.min(base.length, delta.fin + marge));
  const avant = gauche + base.slice(delta.debut, delta.fin) + droite;
  const apres = gauche + delta.inserer + droite;
  return cles.some((cle) => avant.includes(cle) || apres.includes(cle));
}
