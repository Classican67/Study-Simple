/**
 * Les caractères mathématiques d'une carte.
 *
 * Il n'y a **pas** de nouvelle syntaxe : ce sont des caractères Unicode, insérés
 * comme n'importe quelle lettre. Conséquence, et c'est tout l'intérêt : ils
 * survivent partout sans qu'une seule ligne n'ait été touchée ailleurs — dans le
 * balisage enregistré, à la relecture, dans la recherche, dans la comparaison
 * des réponses, à l'export. Une syntaxe de formule, elle, aurait demandé un
 * analyseur, un rendu, et une traduction dans chacun de ces endroits.
 *
 * Ce module est **neutre** : ni `"use client"`, ni React. Une liste exportée
 * depuis un fichier client n'arrive pas comme une vraie valeur dans un
 * composant serveur — on n'y reçoit qu'une référence, et l'appeler échoue à
 * l'exécution sur un message peu parlant.
 *
 * Chaque symbole porte son **nom**, qui n'est pas décoratif : c'est le nom
 * accessible du bouton, et c'est aussi par lui qu'on cherche. Taper « racine »
 * doit trouver √, parce que personne ne sait dire « U+221A ».
 */

export type Symbole = {
  /** Le caractère lui-même. */
  c: string;
  /** Son nom, lu par les technologies d'assistance et cherché par la personne. */
  nom: string;
  /** Mots supplémentaires qui doivent mener à lui. */
  aussi?: string;
};

export type GroupeSymboles = { titre: string; symboles: Symbole[] };

export const GROUPES_MATHS: GroupeSymboles[] = [
  {
    titre: "Opérations et comparaisons",
    symboles: [
      { c: "−", nom: "moins", aussi: "soustraction tiret" },
      { c: "±", nom: "plus ou moins" },
      { c: "∓", nom: "moins ou plus" },
      { c: "×", nom: "fois", aussi: "multiplié multiplication" },
      { c: "÷", nom: "divisé par", aussi: "division" },
      { c: "·", nom: "point médian", aussi: "produit scalaire" },
      { c: "≠", nom: "différent de" },
      { c: "≤", nom: "inférieur ou égal" },
      { c: "≥", nom: "supérieur ou égal" },
      { c: "≈", nom: "environ égal", aussi: "approximativement" },
      { c: "≡", nom: "identique à", aussi: "congru" },
      { c: "≪", nom: "très inférieur à" },
      { c: "≫", nom: "très supérieur à" },
      { c: "∝", nom: "proportionnel à" },
      { c: "‰", nom: "pour mille" },
      { c: "°", nom: "degré" },
    ],
  },
  /*
   * Exposants et indices sont **deux familles**, et non une.
   *
   * Dans une grille, un « ² » et un « ₂ » de quatorze pixels ne se
   * distinguent pas : la capture montrait deux rangées de chiffres identiques
   * sous un seul titre « Puissances et indices ». Le nom du bouton le disait,
   * mais on ne survole pas cent boutons pour lire leurs infobulles. C'est la
   * place dans le panneau, sous son propre titre, qui répond.
   */
  {
    titre: "Exposants",
    symboles: [
      { c: "⁰", nom: "exposant zéro" },
      { c: "¹", nom: "exposant un" },
      { c: "²", nom: "au carré", aussi: "exposant deux" },
      { c: "³", nom: "au cube", aussi: "exposant trois" },
      { c: "⁴", nom: "exposant quatre" },
      { c: "ⁿ", nom: "exposant n" },
      { c: "⁻", nom: "exposant moins" },
      { c: "′", nom: "prime", aussi: "dérivée minute" },
    ],
  },
  {
    titre: "Indices",
    symboles: [
      { c: "₀", nom: "indice zéro" },
      { c: "₁", nom: "indice un" },
      { c: "₂", nom: "indice deux" },
      { c: "₃", nom: "indice trois" },
      { c: "₄", nom: "indice quatre" },
      { c: "ₙ", nom: "indice n" },
      { c: "ᵢ", nom: "indice i" },
      { c: "ₖ", nom: "indice k" },
    ],
  },
  {
    titre: "Analyse",
    symboles: [
      { c: "√", nom: "racine carrée" },
      { c: "∛", nom: "racine cubique" },
      { c: "∑", nom: "somme", aussi: "sigma" },
      { c: "∏", nom: "produit", aussi: "pi majuscule" },
      { c: "∫", nom: "intégrale" },
      { c: "∬", nom: "intégrale double" },
      { c: "∮", nom: "intégrale curviligne" },
      { c: "∂", nom: "dérivée partielle", aussi: "d rond" },
      { c: "∇", nom: "nabla", aussi: "gradient" },
      { c: "∞", nom: "infini" },
      { c: "≅", nom: "isomorphe à", aussi: "congruent" },
      { c: "∅", nom: "ensemble vide" },
    ],
  },
  {
    titre: "Ensembles et logique",
    symboles: [
      { c: "∈", nom: "appartient à" },
      { c: "∉", nom: "n'appartient pas à" },
      { c: "⊂", nom: "inclus dans" },
      { c: "⊄", nom: "non inclus dans" },
      { c: "⊆", nom: "inclus ou égal" },
      { c: "∪", nom: "union" },
      { c: "∩", nom: "intersection" },
      { c: "∀", nom: "quel que soit", aussi: "pour tout" },
      { c: "∃", nom: "il existe" },
      { c: "∄", nom: "il n'existe pas" },
      { c: "¬", nom: "non logique", aussi: "négation" },
      { c: "∧", nom: "et logique" },
      { c: "∨", nom: "ou logique" },
      { c: "ℕ", nom: "entiers naturels" },
      { c: "ℤ", nom: "entiers relatifs" },
      { c: "ℚ", nom: "rationnels" },
      { c: "ℝ", nom: "réels" },
      { c: "ℂ", nom: "complexes" },
    ],
  },
  {
    titre: "Alphabet grec",
    symboles: [
      { c: "α", nom: "alpha" },
      { c: "β", nom: "bêta" },
      { c: "γ", nom: "gamma" },
      { c: "δ", nom: "delta" },
      { c: "ε", nom: "epsilon" },
      { c: "ζ", nom: "dzêta" },
      { c: "η", nom: "êta" },
      { c: "θ", nom: "thêta" },
      { c: "κ", nom: "kappa" },
      { c: "λ", nom: "lambda" },
      { c: "μ", nom: "mu" },
      { c: "ν", nom: "nu" },
      { c: "ξ", nom: "xi" },
      { c: "ρ", nom: "rhô" },
      { c: "σ", nom: "sigma" },
      { c: "τ", nom: "tau" },
      { c: "φ", nom: "phi" },
      { c: "χ", nom: "khi" },
      { c: "ψ", nom: "psi" },
      { c: "ω", nom: "oméga" },
      { c: "Γ", nom: "gamma majuscule" },
      { c: "Δ", nom: "delta majuscule", aussi: "variation" },
      { c: "Θ", nom: "thêta majuscule" },
      { c: "Λ", nom: "lambda majuscule" },
      { c: "Ξ", nom: "xi majuscule" },
      { c: "Π", nom: "pi majuscule" },
      { c: "Σ", nom: "sigma majuscule" },
      { c: "Φ", nom: "phi majuscule" },
      { c: "Ψ", nom: "psi majuscule" },
      { c: "Ω", nom: "oméga majuscule", aussi: "ohm" },
      { c: "π", nom: "pi" },
    ],
  },
  {
    titre: "Géométrie et flèches",
    symboles: [
      { c: "∠", nom: "angle" },
      { c: "⊥", nom: "perpendiculaire à" },
      { c: "∥", nom: "parallèle à" },
      { c: "△", nom: "triangle" },
      { c: "→", nom: "flèche à droite", aussi: "tend vers" },
      { c: "←", nom: "flèche à gauche" },
      { c: "↔", nom: "flèche double sens" },
      { c: "⇒", nom: "implique" },
      { c: "⇔", nom: "équivaut à" },
      { c: "↦", nom: "a pour image" },
      { c: "∴", nom: "donc" },
      { c: "∵", nom: "car" },
    ],
  },
];

/** Tous les symboles, à plat. */
export const SYMBOLES_MATHS: Symbole[] = GROUPES_MATHS.flatMap((g) => g.symboles);

/**
 * Cherche un symbole par son nom.
 *
 * Sans accents ni casse : « bêta » se trouve en tapant « beta », qui est
 * précisément ce qu'on tape quand on cherche β et qu'on n'a pas l'accent
 * circonflexe sous la main. La recherche porte aussi sur le caractère
 * lui-même : collé depuis ailleurs, il se retrouve.
 */
export function chercherSymboles(requete: string): Symbole[] {
  const q = sansAccents(requete.trim());
  if (!q) return [];
  return SYMBOLES_MATHS.filter(
    (s) =>
      s.c === requete.trim() ||
      sansAccents(s.nom).includes(q) ||
      (s.aussi ? sansAccents(s.aussi).includes(q) : false),
  );
}

function sansAccents(texte: string): string {
  return texte
    .toLocaleLowerCase("fr")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}

/** Clé et plafond des symboles récemment posés, gardés dans le navigateur. */
export const MATHS_RECENTS_CLE = "fiches:maths-recents";
export const MATHS_RECENTS_MAX = 12;

/**
 * Les symboles récents vivent dans le navigateur.
 *
 * C'est une commodité propre à l'appareil, pas une donnée de la carte : la
 * perdre — navigation privée, stockage refusé — ne coûte qu'un aller-retour
 * dans la liste. Tout est donc protégé, et l'absence de stockage n'est pas une
 * panne.
 */
export function lireRecents(): string[] {
  try {
    const brut: unknown = JSON.parse(window.localStorage.getItem(MATHS_RECENTS_CLE) ?? "[]");
    if (!Array.isArray(brut)) return [];
    const connus = new Set(SYMBOLES_MATHS.map((s) => s.c));
    return brut
      .filter((c): c is string => typeof c === "string" && connus.has(c))
      .slice(0, MATHS_RECENTS_MAX);
  } catch {
    return [];
  }
}

export function retenirRecent(symbole: string): string[] {
  const liste = [symbole, ...lireRecents().filter((c) => c !== symbole)].slice(0, MATHS_RECENTS_MAX);
  try {
    window.localStorage.setItem(MATHS_RECENTS_CLE, JSON.stringify(liste));
  } catch {
    // Stockage refusé : le symbole est posé quand même, il n'est pas retenu.
  }
  return liste;
}
