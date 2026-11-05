/**
 * Le presse-papiers des pages manuscrites.
 *
 * Le presse-papiers du système ne sait pas porter des traits : il porte du
 * texte et des images. Ce qu'on copie est donc gardé **sur l'appareil**, ce qui
 * le rend disponible d'une note à l'autre et d'un onglet à l'autre, et une
 * image de la sélection part vers le système, pour coller son schéma dans
 * n'importe quelle autre application.
 *
 * La **marque** relie les deux. Elle accompagne l'image dans le presse-papiers
 * du système : si ce qu'on colle la porte encore, c'est notre fragment et on
 * repose de vrais traits. Si elle n'y est plus, c'est que quelque chose d'autre
 * a été copié entre-temps — et c'est cela qu'il faut coller, pas un fragment
 * qu'on a oublié depuis.
 */

import type { FragmentEncre } from "@/lib/fragment-encre";

const CLE = "fiches.encre.fragment";
/** Au-delà, le fragment reste en mémoire : `localStorage` plafonne à 5 Mo. */
const POIDS_MAX = 2_000_000;

export type FragmentMarque = FragmentEncre & { marque: string };

let enMemoire: FragmentMarque | null = null;
let version = 0;
const abonnes = new Set<() => void>();

function prevenir() {
  version += 1;
  for (const abonne of abonnes) abonne();
}

/** Attribut qui porte la marque dans le HTML déposé au presse-papiers. */
export const ATTRIBUT_MARQUE = "data-fiches-encre";

export function garderFragment(fragment: FragmentEncre): FragmentMarque {
  const marque = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const marqueur = { ...fragment, marque };
  enMemoire = marqueur;
  try {
    const texte = JSON.stringify(marqueur);
    if (texte.length <= POIDS_MAX) localStorage.setItem(CLE, texte);
    else localStorage.removeItem(CLE);
  } catch {
    // Stockage plein ou refusé (navigation privée) : la mémoire suffit à
    // coller dans la même note.
  }
  prevenir();
  return marqueur;
}

export function lireFragment(): FragmentMarque | null {
  if (enMemoire) return enMemoire;
  try {
    const texte = localStorage.getItem(CLE);
    if (!texte) return null;
    const lu = JSON.parse(texte) as Partial<FragmentMarque> | null;
    if (!lu || !Array.isArray(lu.strokes) || !Array.isArray(lu.images) || !lu.cadre) return null;
    enMemoire = lu as FragmentMarque;
    return enMemoire;
  } catch {
    return null;
  }
}

/** Le fragment désigné par ce qu'on est en train de coller, s'il est à nous. */
export function fragmentDuCollage(html: string): FragmentMarque | null {
  const trouve = new RegExp(`${ATTRIBUT_MARQUE}="([a-z0-9]+)"`).exec(html);
  if (!trouve) return null;
  const fragment = lireFragment();
  return fragment?.marque === trouve[1] ? fragment : null;
}

/*
 * Pour `useSyncExternalStore` : ce qui se copie dans un autre onglet doit
 * allumer « Coller » ici aussi.
 */
export function abonnerFragment(ecoute: () => void): () => void {
  abonnes.add(ecoute);
  const surStockage = (event: StorageEvent) => {
    if (event.key !== CLE) return;
    enMemoire = null;
    version += 1;
    ecoute();
  };
  window.addEventListener("storage", surStockage);
  return () => {
    abonnes.delete(ecoute);
    window.removeEventListener("storage", surStockage);
  };
}

export function versionFragment(): number {
  return version;
}
