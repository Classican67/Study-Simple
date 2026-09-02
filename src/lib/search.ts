/**
 * Recherche dans les cartes — logique pure, sans base ni DOM.
 *
 * Le problème central est l'accentuation : chercher « mitose » doit trouver
 * « Mitosé », et « eleve » doit trouver « élève ». SQLite ne sait pas retirer
 * les accents, et Postgres ne le fait qu'avec une extension. On stocke donc à
 * côté de chaque carte une copie normalisée de son contenu, sur laquelle la
 * comparaison devient une simple inclusion de texte — portable sur les deux
 * moteurs.
 */

/**
 * Repli d'un texte sur sa forme comparable, caractère par caractère.
 *
 * NFKD plutôt que NFD : la décomposition dite « de compatibilité » ramène au
 * passage la ligature « ﬁ » à « fi » et les caractères pleine chasse à leur
 * équivalent ASCII. Ce n'est pas théorique — copier une définition depuis un
 * PDF de cours produit couramment des ligatures, et la carte devenait alors
 * introuvable en tapant le mot normalement.
 *
 * Les trois dernières substitutions sont des lettres qu'Unicode ne décompose
 * pas, faute d'être des ligatures à ses yeux. Sans elles, « coeur » ne trouve
 * pas « cœur » — le cas le plus probable ici.
 */
export function fold(text: string): string {
  return (
    text
      .normalize("NFKD")
      // Retire les diacritiques détachés par la décomposition (é → e + ́ ).
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      // Après la minuscule : « Œ » est déjà devenu « œ ».
      .replace(/œ/g, "oe")
      .replace(/æ/g, "ae")
      .replace(/ß/g, "ss")
  );
}

/**
 * Forme comparable d'un texte : sans accent, sans majuscule, sans balisage de
 * mise en forme, espaces réduits.
 */
export function normalizeForSearch(text: string): string {
  return (
    fold(text)
      // La mise en forme n'est pas du contenu : chercher « gras » ne doit pas
      // remonter toutes les cartes qui en contiennent.
      .replace(/\{c:[a-z]+\}|\{\/c\}/g, " ")
      .replace(/[*_~`#]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** Texte indexé d'une carte : les deux faces réunies, normalisées. */
export function buildSearchText(term: string, definition: string): string {
  return normalizeForSearch(`${term} ${definition}`);
}

/**
 * Découpe une requête en mots.
 * Chercher « cellule division » doit trouver les cartes contenant les deux,
 * dans n'importe quel ordre — c'est plus précis qu'un « ou ».
 */
export function searchTerms(query: string): string[] {
  return normalizeForSearch(query).split(" ").filter(Boolean);
}

export type Scorable = { term: string; definition: string };

/**
 * Pertinence d'une carte pour une requête.
 *
 * Un mot trouvé dans le terme compte davantage que dans la définition : c'est
 * le terme qu'on cherche en général. Un terme qui *commence* par la requête
 * passe encore devant — « mito » doit remonter « Mitose » avant une définition
 * qui mentionne la mitose en passant.
 *
 * Renvoie 0 si la carte ne contient pas tous les mots cherchés.
 *
 * Les mots sont renormalisés ici même s'ils viennent en principe de
 * `searchTerms` : un appelant qui passerait la requête brute obtiendrait sinon
 * des résultats faux, sans la moindre erreur pour le signaler.
 */
export function scoreCard(card: Scorable, terms: string[]): number {
  const needles = terms.map(normalizeForSearch).filter(Boolean);
  if (needles.length === 0) return 0;

  const term = normalizeForSearch(card.term);
  const definition = normalizeForSearch(card.definition);

  let score = 0;
  for (const needle of needles) {
    if (term.startsWith(needle)) score += 6;
    else if (new RegExp(`\\b${escapeRegex(needle)}`).test(term)) score += 4;
    else if (term.includes(needle)) score += 3;
    else if (new RegExp(`\\b${escapeRegex(needle)}`).test(definition)) score += 2;
    else if (definition.includes(needle)) score += 1;
    // Un mot absent disqualifie la carte entière.
    else return 0;
  }

  // À score égal, le terme le plus court est le plus précis : « Mitose » passe
  // devant « Mitose et méiose comparées ».
  return score + Math.max(0, 40 - term.length) / 100;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export type Segment = { text: string; match: boolean };

/**
 * Découpe un texte en segments correspondants et non correspondants, pour
 * mettre les occurrences en évidence.
 *
 * La comparaison se fait sur la forme normalisée, mais les segments rendus
 * viennent du texte **d'origine** : on souligne « élève » quand l'utilisateur
 * a tapé « eleve », sans dénaturer l'affichage.
 */
export function highlight(text: string, terms: string[]): Segment[] {
  if (terms.length === 0 || !text) return [{ text, match: false }];

  /*
   * Le repli ne doit pas décaler les indices : on l'applique caractère par
   * caractère en gardant, pour chaque caractère produit, la position de celui
   * dont il vient.
   *
   * Un caractère d'origine peut en produire zéro (un accent détaché) ou
   * plusieurs (« ﬁ » → « f », « i »). Les deux cas sont conservés tels quels :
   * tronquer à un seul caractère, comme le faisait la version précédente,
   * décalait le texte replié par rapport aux mots cherchés, et le surlignage
   * disparaissait silencieusement alors que la carte, elle, ressortait bien.
   */
  const folded: string[] = [];
  const starts: number[] = [];
  for (let i = 0; i < text.length; i++) {
    for (const char of fold(text[i])) {
      folded.push(char);
      starts.push(i);
    }
  }
  const haystack = folded.join("");

  // Intervalles correspondants, en indices du texte d'origine.
  const ranges: [number, number][] = [];
  for (const needle of terms) {
    let from = 0;
    for (;;) {
      const at = haystack.indexOf(needle, from);
      if (at === -1) break;
      /*
       * Fin du surlignage : le début du caractère d'origine suivant, ce qui
       * absorbe ceux qui n'ont rien produit — un accent détaché resterait
       * sinon en dehors du surlignage, juste à côté de sa lettre.
       * Le `max` garantit qu'un caractère qui s'est dédoublé est surligné en
       * entier : on ne peut pas souligner la moitié d'une ligature.
       */
      const last = at + needle.length - 1;
      const after = last + 1 < starts.length ? starts[last + 1] : text.length;
      ranges.push([starts[at], Math.max(starts[last] + 1, after)]);
      from = at + needle.length;
    }
  }
  if (ranges.length === 0) return [{ text, match: false }];

  // Fusion des chevauchements : deux mots voisins ne doivent pas produire deux
  // surlignages accolés.
  ranges.sort((a, b) => a[0] - b[0]);
  const merged: [number, number][] = [ranges[0]];
  for (const [start, end] of ranges.slice(1)) {
    const last = merged[merged.length - 1];
    if (start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }

  const segments: Segment[] = [];
  let cursor = 0;
  for (const [start, end] of merged) {
    if (start > cursor) segments.push({ text: text.slice(cursor, start), match: false });
    segments.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), match: false });

  return segments;
}

/**
 * Extrait un fragment de texte autour de la première occurrence, pour ne pas
 * afficher une définition de dix lignes dans une liste de résultats.
 */
export function excerpt(text: string, terms: string[], radius = 70): string {
  const normalized = normalizeForSearch(text);
  const first = terms
    .map((needle) => normalized.indexOf(needle))
    .filter((index) => index !== -1)
    .sort((a, b) => a - b)[0];

  if (first === undefined || first <= radius) {
    return text.length > radius * 2 ? `${text.slice(0, radius * 2)}…` : text;
  }

  const start = Math.max(0, first - radius);
  const end = Math.min(text.length, first + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${end < text.length ? "…" : ""}`;
}
