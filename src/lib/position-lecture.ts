/**
 * Où l'on en était dans une page, par surface, sur cet appareil.
 *
 * Écrit à chaque défilement : on regroupe donc, et l'on ne garde que les
 * deux cents dernières surfaces — ce n'est pas une archive.
 */

const CLE = "fiches.position";
const MAX_SURFACES = 200;

let positions: Record<string, number> | null = null;
let attente: ReturnType<typeof setTimeout> | null = null;

function lire(): Record<string, number> {
  if (positions) return positions;
  try {
    positions = JSON.parse(localStorage.getItem(CLE) ?? "{}") as Record<string, number>;
  } catch {
    positions = {};
  }
  return positions;
}

export function lirePosition(id: string): number {
  const valeur = lire()[id];
  return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : 0;
}

export function retenirPosition(id: string, position: number) {
  const tout = lire();
  // Supprimée puis remise : `Object.keys` garde l'ordre d'insertion, donc les plus
  // anciennes sont les premières.
  delete tout[id];
  tout[id] = Math.round(position * 1000) / 1000;
  if (attente) return;
  attente = setTimeout(() => {
    attente = null;
    const cles = Object.keys(tout);
    for (const cle of cles.slice(0, Math.max(0, cles.length - MAX_SURFACES))) delete tout[cle];
    try {
      localStorage.setItem(CLE, JSON.stringify(tout));
    } catch {
      // Stockage plein : on perd une position, rien de plus.
    }
  }, 600);
}
