import { nextDueAt } from "@/lib/scheduling";
import type { FolderNode } from "@/lib/folder-tree";

/**
 * Ce que l'appareil garde pour réviser sans le serveur — et les règles pour le
 * tenir juste.
 *
 * Aucune dépendance au navigateur ni à la base : le client, le serveur et les
 * tests s'accordent sur les mêmes fonctions.
 *
 * Trois idées portent tout le reste :
 *
 * 1. **On épingle un choix, pas une copie.** Épingler un dossier, c'est
 *    demander « ce dossier, tel qu'il sera » : un paquet ou une note ajoutés demain y
 *    descendront aussi. Le serveur résout donc les épingles à chaque
 *    synchronisation, au lieu que l'appareil garde une liste figée.
 * 2. **Une réponse est un fait, pas un état.** L'appareil n'envoie jamais
 *    « cette carte est sue » : il envoie « j'ai répondu juste mardi à 18 h 04 ».
 *    Deux appareils qui révisent chacun de leur côté se fusionnent alors sans
 *    conflit, et un envoi rejoué ne compte pas deux fois.
 * 3. **Ce qui n'est pas parti se rejoue par-dessus ce qui arrive.** Une
 *    synchronisation rapporte l'état du serveur, qui ignore encore les
 *    réponses en attente. Les appliquer de nouveau par-dessus évite qu'une
 *    carte déjà révisée hors ligne ne redevienne « à réviser ».
 */

export type GenreEpingle = "paquet" | "dossier" | "note";

export type Epingle = {
  genre: GenreEpingle;
  id: string;
  /** Date de l'épingle, pour l'affichage et l'ordre de la liste. */
  depuis: number;
  /**
   * Première synchronisation qui l'a résolue. Nulle tant que le contenu n'est
   * pas descendu : épinglé dans le métro, il attend le réseau.
   */
  resolueLe: number | null;
};

export const cleEpingle = (genre: GenreEpingle, id: string) => `${genre}:${id}`;

export type CarteHorsLigne = {
  id: string;
  term: string;
  definition: string;
  imagePath: string | null;
  status: string;
  streak: number;
  /** En millisecondes ; nul = jamais répondue, donc à réviser. */
  dueAt: number | null;
  lastSeenAt: number | null;
};

export type PaquetHorsLigne = {
  id: string;
  folderId: string | null;
  title: string;
  description: string;
  color: string;
  /** Empreinte du contenu côté serveur : égale, rien à retélécharger. */
  version: string;
  cartes: CarteHorsLigne[];
};

/** Les deux classements vivent dans la même liste : leurs identifiants ne se croisent pas. */
export type DossierHorsLigne = FolderNode & { kind: "deck" | "note" };

export type BlocHorsLigne = { id: string; kind: string; content: string };

export type NoteHorsLigne = {
  id: string;
  folderId: string | null;
  title: string;
  mastered: boolean;
  /** Vignette de la liste — petite et bornée, cf. `Note.preview`. */
  preview: string;
  /** Date serveur de dernière écriture : c'est elle qui départage un brouillon local. */
  updatedAt: number;
  version: string;
  blocs: BlocHorsLigne[];
  /** Documents et photos que ses pages désignent. */
  fichiers: string[];
};

export type EnvoiReponse = {
  genre: "reponse";
  id: string;
  userId: string;
  cardId: string;
  knew: boolean;
  answeredAt: number;
};

export type EnvoiSession = {
  genre: "session";
  id: string;
  userId: string;
  deckId: string;
  correctCount: number;
  missCount: number;
  finishedAt: number;
};

export type Envoi = EnvoiReponse | EnvoiSession;

/** Au-delà, un lot devient lourd à rejouer en cas d'échec. */
export const TAILLE_LOT = 200;

/**
 * Applique une réponse à une carte, exactement comme le fait le serveur
 * (`appliquerReponse`) — y compris le refus de replanifier depuis une réponse
 * plus ancienne que la dernière connue.
 */
export function appliquerLocalement(carte: CarteHorsLigne, envoi: EnvoiReponse): CarteHorsLigne {
  if (carte.lastSeenAt !== null && envoi.answeredAt < carte.lastSeenAt) return carte;
  const streak = envoi.knew ? carte.streak + 1 : 0;
  return {
    ...carte,
    streak,
    status: envoi.knew ? "known" : "learning",
    dueAt: nextDueAt(streak, new Date(envoi.answeredAt)).getTime(),
    lastSeenAt: envoi.answeredAt,
  };
}

/**
 * Rejoue les réponses encore en attente sur un paquet qui vient d'arriver du
 * serveur. Rend le paquet inchangé (même objet) si aucune ne le concerne.
 */
export function rebaser(paquet: PaquetHorsLigne, envois: readonly Envoi[]): PaquetHorsLigne {
  const reponses = envois
    .filter((e): e is EnvoiReponse => e.genre === "reponse")
    .sort((a, b) => a.answeredAt - b.answeredAt);
  if (reponses.length === 0) return paquet;

  const parCarte = new Map<string, EnvoiReponse[]>();
  for (const r of reponses) parCarte.set(r.cardId, [...(parCarte.get(r.cardId) ?? []), r]);

  let touche = false;
  const cartes = paquet.cartes.map((carte) => {
    const siennes = parCarte.get(carte.id);
    if (!siennes) return carte;
    touche = true;
    return siennes.reduce(appliquerLocalement, carte);
  });
  return touche ? { ...paquet, cartes } : paquet;
}

export type Disponibilite =
  /** Rien sur l'appareil. */
  | { etat: "absent" }
  /** Épinglé directement : on peut le retirer d'un geste. */
  | { etat: "epingle" }
  /** Présent parce qu'un dossier parent l'est : c'est lui qu'il faut retirer. */
  | { etat: "herite"; via: DossierHorsLigne };

/**
 * Pourquoi un élément est — ou n'est pas — sur l'appareil.
 *
 * L'épingle directe l'emporte sur l'héritage : c'est elle que la personne a
 * posée, et c'est elle que le bouton doit pouvoir retirer.
 */
export function disponibilite(
  genre: GenreEpingle,
  id: string,
  contexte: {
    epingles: ReadonlySet<string>;
    dossiers: readonly DossierHorsLigne[];
    /** Dossier du paquet, pour un paquet. */
    folderId?: string | null;
  },
): Disponibilite {
  if (contexte.epingles.has(cleEpingle(genre, id))) return { etat: "epingle" };

  const parId = new Map(contexte.dossiers.map((d) => [d.id, d]));
  // Un paquet ou une note hérite du dossier qui le contient ; un dossier, de
  // ses parents seulement.
  let courant = genre === "dossier" ? parId.get(id)?.parentId : contexte.folderId;
  // Borne contre un cycle écrit malgré tout en base.
  for (let garde = 0; courant && garde < 32; garde++) {
    const dossier = parId.get(courant);
    if (!dossier) break;
    if (contexte.epingles.has(cleEpingle("dossier", dossier.id))) return { etat: "herite", via: dossier };
    courant = dossier.parentId;
  }
  return { etat: "absent" };
}

/** Une carte est à réviser si elle n'a jamais été vue, ou si son échéance est passée. */
export function estDue(carte: Pick<CarteHorsLigne, "dueAt">, now: number = Date.now()): boolean {
  return carte.dueAt === null || carte.dueAt <= now;
}

/** Les fichiers dont les paquets et les notes gardés ont besoin, sans doublon. */
export function fichiersNecessaires(
  paquets: readonly PaquetHorsLigne[],
  notes: readonly Pick<NoteHorsLigne, "fichiers">[] = [],
): string[] {
  const noms = new Set<string>();
  for (const paquet of paquets) for (const carte of paquet.cartes) if (carte.imagePath) noms.add(carte.imagePath);
  for (const note of notes) for (const nom of note.fichiers) noms.add(nom);
  return [...noms];
}

/**
 * Identifiant d'envoi. `crypto.randomUUID` n'existe qu'en contexte sécurisé :
 * servie en http:// sur le réseau local (COOKIE_SECURE=false), l'app n'y a pas
 * droit, alors que la révision doit continuer d'y fonctionner.
 */
export function nouvelIdentifiant(): string {
  const c = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const octets = new Uint8Array(16);
  c.getRandomValues(octets);
  octets[6] = (octets[6] & 0x0f) | 0x40;
  octets[8] = (octets[8] & 0x3f) | 0x80;
  const hex = [...octets].map((o) => o.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/*
 * Noms des caches partagés avec le service worker (`public/sw.js`), qui ne
 * peut pas importer ce module. `tests/hors-ligne.test.ts` vérifie que les deux
 * fichiers ne se séparent pas.
 */
export const CACHE_FICHIERS = "fiches-fichiers";
export const CACHE_COQUILLE = "fiches-coquille";
/** Page servie à la place de toute navigation qui ne trouve pas le serveur. */
export const ADRESSE_COQUILLE = "/offline";

/**
 * Paquets que plus aucune épingle ne couvre.
 *
 * Retirer une épingle doit libérer la place **tout de suite**, y compris sans
 * réseau : attendre la synchronisation laisserait un paquet « retiré » encore
 * consultable dans le train, ce qui contredit le bouton qu'on vient de toucher.
 */
export function orphelins(
  genre: "paquet" | "note",
  elements: readonly { id: string; folderId: string | null }[],
  epingles: ReadonlySet<string>,
  dossiers: readonly DossierHorsLigne[],
): string[] {
  return elements
    .filter((e) => disponibilite(genre, e.id, { epingles, dossiers, folderId: e.folderId }).etat === "absent")
    .map((e) => e.id);
}
