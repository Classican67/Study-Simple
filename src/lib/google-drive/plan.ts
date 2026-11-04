/**
 * Le plan d'une synchronisation avec Google Drive — sans réseau ni base.
 *
 * La sauvegarde est un **miroir** : chaque chose de l'app (une note, un
 * dossier, un fichier importé) a son fichier dans le Drive, mis à jour sur
 * place quand elle change. Drive garde de lui-même l'historique des versions
 * d'un fichier ; une suite d'instantanés datés aurait renvoyé chaque nuit des
 * centaines de mégaoctets de polycopiés qui n'avaient pas bougé.
 *
 * Ce module compare ce qu'on veut (`Voulu`) à ce qu'on a déjà déposé
 * (`Connu`) et en tire la liste des gestes, **dans l'ordre où ils doivent se
 * faire** :
 *
 * 1. les dossiers, du haut vers le bas — un fichier ne se crée pas dans un
 *    dossier qui n'existe pas encore ;
 * 2. les fichiers ;
 * 3. les fichiers qui n'ont plus lieu d'être, mis à la corbeille ;
 * 4. puis seulement les dossiers vides de sens, du bas vers le haut. Jeter un
 *    dossier jette ce qu'il contient : s'il partait avant que ses fichiers
 *    aient été déplacés, une note simplement rangée ailleurs finirait à la
 *    corbeille avec lui.
 *
 * Il est pur pour une raison précise : c'est lui qui décide de ce qui part à
 * la corbeille du Drive de quelqu'un.
 */

export type Voulu = {
  /** Identité côté app : « note:<id>:pdf », « folder:<id> », « file:<nom> »… */
  key: string;
  name: string;
  /** Clé du dossier parent ; vide pour la racine du Drive. */
  parent: string;
  /** Version du contenu. Un dossier n'en a pas : seuls son nom et sa place comptent. */
  version: string;
  dossier: boolean;
};

export type Connu = {
  key: string;
  driveId: string;
  version: string;
  name: string;
  parent: string;
};

export type Geste =
  /** Rien n'a encore été déposé pour cette clé. */
  | { type: "creer"; voulu: Voulu }
  /** Le contenu a changé : on le renvoie, et l'on corrige nom et place au passage. */
  | { type: "remplacer"; voulu: Voulu; connu: Connu }
  /** Seuls le nom ou la place ont changé : rien à renvoyer. */
  | { type: "deplacer"; voulu: Voulu; connu: Connu }
  /** L'app n'en a plus : à la corbeille, d'où l'on peut encore le reprendre. */
  | { type: "jeter"; connu: Connu };

export function planifier(voulus: Voulu[], connus: Connu[]): Geste[] {
  const parCle = new Map(connus.map((c) => [c.key, c]));
  const voulusParCle = new Map(voulus.map((v) => [v.key, v]));

  const profondeur = profondeurs(voulus);
  const dossiers = voulus
    .filter((v) => v.dossier)
    .sort((a, b) => (profondeur.get(a.key) ?? 0) - (profondeur.get(b.key) ?? 0));
  const fichiers = voulus.filter((v) => !v.dossier);

  const gestes: Geste[] = [];
  for (const voulu of [...dossiers, ...fichiers]) {
    const connu = parCle.get(voulu.key);
    if (!connu) {
      gestes.push({ type: "creer", voulu });
    } else if (!voulu.dossier && connu.version !== voulu.version) {
      gestes.push({ type: "remplacer", voulu, connu });
    } else if (connu.name !== voulu.name || connu.parent !== voulu.parent) {
      gestes.push({ type: "deplacer", voulu, connu });
    }
  }

  // Ce qui n'est plus voulu. Les fichiers d'abord ; les dossiers ensuite, les
  // plus profonds en premier, pour qu'aucun ne parte avec un voisin encore
  // utile — et un dossier jeté dans un dossier jeté ne coûte qu'un geste de
  // trop, jamais une perte.
  const orphelins = connus.filter((c) => !voulusParCle.has(c.key));
  const estDossier = (c: Connu) => connus.some((autre) => autre.parent === c.key) || c.key === RACINE;
  const profondeurConnue = profondeurs(connus);
  const fichiersJetes = orphelins.filter((c) => !estDossier(c));
  const dossiersJetes = orphelins
    .filter(estDossier)
    .sort((a, b) => (profondeurConnue.get(b.key) ?? 0) - (profondeurConnue.get(a.key) ?? 0));
  for (const connu of [...fichiersJetes, ...dossiersJetes]) gestes.push({ type: "jeter", connu });

  return gestes;
}

/** La clé du dossier « Fiches », à la racine du Drive. */
export const RACINE = "root";

/** Profondeur de chaque clé dans l'arbre des parents, bornée contre un cycle. */
function profondeurs(entrees: { key: string; parent: string }[]): Map<string, number> {
  const parent = new Map(entrees.map((e) => [e.key, e.parent]));
  const memo = new Map<string, number>();
  for (const { key } of entrees) {
    let d = 0;
    for (let cur = parent.get(key); cur && d < 64; cur = parent.get(cur)) d++;
    memo.set(key, d);
  }
  return memo;
}

/**
 * Un nom de fichier lisible dans le Drive.
 *
 * Drive accepte presque tout, mais le fichier finira téléchargé sur un disque
 * qui, lui, refuse `/` et `:` ; et un titre vide donnerait « .pdf ».
 */
export function nomDeFichier(titre: string, extension: string, repli: string): string {
  const propre = titre
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${propre || repli}${extension}`;
}
