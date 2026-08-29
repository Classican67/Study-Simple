/**
 * Logique d'arborescence des dossiers — sans accès base, donc testable seule.
 *
 * Volontairement séparée de `folders.ts`, qui est marqué `server-only` : ces
 * fonctions ne sont que du calcul sur une liste déjà chargée.
 */

export type FolderNode = {
  id: string;
  name: string;
  color: string;
  parentId: string | null;
};

// Au-delà, le fil d'Ariane devient illisible et le déplacement incompréhensible.
// C'est une limite d'interface, pas de schéma.
export const MAX_FOLDER_DEPTH = 5;

/** Chemin de la racine jusqu'au dossier, inclus. */
export function buildBreadcrumb(folders: FolderNode[], folderId: string | null): FolderNode[] {
  const byId = new Map(folders.map((f) => [f.id, f]));
  const path: FolderNode[] = [];
  let current = folderId ? byId.get(folderId) : undefined;

  // La borne protège aussi d'un cycle qui aurait échappé à la validation :
  // mieux vaut un fil tronqué qu'une page qui ne répond plus.
  while (current && path.length <= MAX_FOLDER_DEPTH + 1) {
    path.unshift(current);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return path;
}

export function depthOf(folders: FolderNode[], folderId: string | null): number {
  return buildBreadcrumb(folders, folderId).length;
}

/**
 * `candidateId` se trouve-t-il dans le sous-arbre de `ancestorId` ?
 *
 * Sert à refuser qu'un dossier soit déplacé dans lui-même ou dans l'un de ses
 * descendants : la branche entière se détacherait de la racine.
 */
export function isDescendant(
  folders: FolderNode[],
  candidateId: string,
  ancestorId: string,
): boolean {
  const byId = new Map(folders.map((f) => [f.id, f]));
  let current = byId.get(candidateId);
  let guard = 0;
  while (current && guard++ <= MAX_FOLDER_DEPTH + 2) {
    if (current.id === ancestorId) return true;
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return false;
}

/** Le dossier lui-même et tous ses descendants. */
export function descendantIds(folders: FolderNode[], folderId: string): string[] {
  const ids = [folderId];
  for (let i = 0; i < ids.length; i++) {
    for (const child of folders) {
      // La garde sur `ids.includes` évite une boucle infinie si un cycle a
      // malgré tout été écrit en base.
      if (child.parentId === ids[i] && !ids.includes(child.id)) ids.push(child.id);
    }
  }
  return ids;
}
