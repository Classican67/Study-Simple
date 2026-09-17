import type { BlocHorsLigne, DossierHorsLigne, Envoi, Epingle, NoteHorsLigne, PaquetHorsLigne } from "@/lib/hors-ligne/modele";

/**
 * Ce que l'appareil garde pour travailler sans le serveur, dans IndexedDB.
 *
 * Une base à part de celle des brouillons de notes (`lib/brouillons.ts`) : les
 * deux n'ont ni le même rythme ni la même durée de vie. Un brouillon ne vit
 * que le temps d'un envoi ; un paquet épinglé reste des mois.
 *
 * Six magasins :
 *
 * - `epingles` — ce que la personne a choisi de garder ;
 * - `paquets`  — ce que le serveur a rendu pour ces choix, cartes comprises ;
 * - `notes`    — les notes gardées, sans le contenu de leurs blocs ;
 * - `blocs`    — ce contenu, bloc par bloc : une page manuscrite dense pèse
 *                plusieurs mégaoctets, et la mise à jour d'un bloc ne doit pas
 *                réécrire la note entière. Ce qu'on écrit hors ligne ne passe
 *                pas par ici mais par le journal des brouillons, qui sait déjà
 *                le rejouer ;
 * - `envois`   — réponses et sessions pas encore confirmées par le serveur ;
 * - `meta`     — le compte, l'arbre des dossiers, la date de synchronisation.
 *
 * Si IndexedDB est refusé (navigation privée, réglage d'entreprise), tout se
 * replie en mémoire : la révision en ligne continue de marcher, simplement
 * sans survivre à la fermeture de l'onglet.
 */

const BASE = "fiches-hors-ligne";
const MAGASINS = ["epingles", "paquets", "notes", "blocs", "envois", "meta"] as const;
type Magasin = (typeof MAGASINS)[number];

let ouverture: Promise<IDBDatabase | null> | null = null;

function ouvrir(): Promise<IDBDatabase | null> {
  if (ouverture) return ouverture;
  ouverture = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    let demande: IDBOpenDBRequest;
    try {
      // Version 2 : ajout des magasins des notes et de leurs blocs. La mise à niveau ne fait que
      // créer ce qui manque, les paquets déjà gardés restent en place.
      demande = indexedDB.open(BASE, 2);
    } catch {
      return resolve(null);
    }
    demande.onupgradeneeded = () => {
      const db = demande.result;
      for (const nom of MAGASINS) if (!db.objectStoreNames.contains(nom)) db.createObjectStore(nom);
    };
    demande.onsuccess = () => {
      const db = demande.result;
      // Une version plus récente de l'app veut migrer la base : on la lui
      // rend, plutôt que de la bloquer jusqu'à la fermeture de cet onglet.
      db.onversionchange = () => {
        db.close();
        ouverture = null;
      };
      resolve(db);
    };
    demande.onerror = () => resolve(null);
    demande.onblocked = () => resolve(null);
  });
  return ouverture;
}

const memoire: Record<Magasin, Map<string, unknown>> = {
  epingles: new Map(),
  paquets: new Map(),
  notes: new Map(),
  blocs: new Map(),
  envois: new Map(),
  meta: new Map(),
};

/**
 * Une transaction sur un ou plusieurs magasins, résolue **à la fin** de la
 * transaction : c'est là que l'écriture est durable. Confirmer plus tôt
 * promettrait une réponse enregistrée que le disque n'a pas encore.
 */
function transaction<T>(
  magasins: Magasin[],
  mode: IDBTransactionMode,
  travail: (stores: Record<Magasin, IDBObjectStore>, tenir: (valeur: T) => void) => void,
  repli: () => T,
): Promise<T> {
  return ouvrir().then(
    (db) =>
      new Promise<T>((resolve) => {
        if (!db) return resolve(repli());
        let valeur: T | undefined;
        let tenu = false;
        try {
          const tx = db.transaction(magasins, mode);
          tx.oncomplete = () => resolve(tenu ? (valeur as T) : repli());
          tx.onerror = () => resolve(repli());
          tx.onabort = () => resolve(repli());
          const stores = Object.fromEntries(magasins.map((m) => [m, tx.objectStore(m)])) as Record<
            Magasin,
            IDBObjectStore
          >;
          travail(stores, (v) => {
            valeur = v;
            tenu = true;
          });
        } catch {
          resolve(repli());
        }
      }),
  );
}

function toutLire<T>(magasin: Magasin): Promise<T[]> {
  return transaction<T[]>(
    [magasin],
    "readonly",
    (s, tenir) => {
      const r = s[magasin].getAll();
      r.onsuccess = () => tenir((r.result as T[]) ?? []);
    },
    () => [...memoire[magasin].values()] as T[],
  );
}

function lireUn<T>(magasin: Magasin, cle: string): Promise<T | undefined> {
  return transaction<T | undefined>(
    [magasin],
    "readonly",
    (s, tenir) => {
      const r = s[magasin].get(cle);
      r.onsuccess = () => tenir(r.result as T | undefined);
    },
    () => memoire[magasin].get(cle) as T | undefined,
  );
}

async function ecrire(magasin: Magasin, entrees: [string, unknown][], effacees: string[] = []) {
  for (const [cle, valeur] of entrees) memoire[magasin].set(cle, valeur);
  for (const cle of effacees) memoire[magasin].delete(cle);
  await transaction<true>(
    [magasin],
    "readwrite",
    (s, tenir) => {
      for (const [cle, valeur] of entrees) s[magasin].put(valeur, cle);
      for (const cle of effacees) s[magasin].delete(cle);
      tenir(true);
    },
    () => true,
  );
}

// --- Épingles ----------------------------------------------------------------

export const lireEpingles = () => toutLire<Epingle>("epingles");

export const poserEpingle = (epingle: Epingle) =>
  ecrire("epingles", [[`${epingle.genre}:${epingle.id}`, epingle]]);

export const retirerEpingles = (cles: string[]) => ecrire("epingles", [], cles);

/**
 * Marque des épingles comme résolues — **seulement si elles existent encore**.
 *
 * Une synchronisation dure le temps d'un aller-retour ; si la personne retire
 * l'épingle pendant ce temps, la réécrire à la fin la ferait revenir.
 */
export async function resoudreEpingles(cles: string[], le: number) {
  for (const cle of cles) {
    const e = memoire.epingles.get(cle) as Epingle | undefined;
    if (e && e.resolueLe === null) memoire.epingles.set(cle, { ...e, resolueLe: le });
  }
  await transaction<true>(
    ["epingles"],
    "readwrite",
    (s, tenir) => {
      for (const cle of cles) {
        const lecture = s.epingles.get(cle);
        lecture.onsuccess = () => {
          const e = lecture.result as Epingle | undefined;
          if (e && e.resolueLe === null) s.epingles.put({ ...e, resolueLe: le }, cle);
        };
      }
      tenir(true);
    },
    () => true,
  );
}

// --- Paquets -----------------------------------------------------------------

export const lirePaquets = () => toutLire<PaquetHorsLigne>("paquets");
export const lirePaquet = (id: string) => lireUn<PaquetHorsLigne>("paquets", id);

export const ecrirePaquets = (paquets: PaquetHorsLigne[], effaces: string[] = []) =>
  ecrire(
    "paquets",
    paquets.map((p) => [p.id, p]),
    effaces,
  );

// --- Notes -------------------------------------------------------------------

/** Une note telle qu'elle est rangée : ses blocs sans leur contenu. */
export type NoteRangee = Omit<NoteHorsLigne, "blocs"> & { blocs: Omit<BlocHorsLigne, "content">[] };
type BlocRange = { noteId: string; kind: string; content: string };

/** Les notes gardées, sans le contenu des blocs : de quoi lister, pas de quoi ouvrir. */
export const lireNotes = () => toutLire<NoteRangee>("notes");

export async function lireNote(id: string): Promise<NoteHorsLigne | undefined> {
  const rangee = await lireUn<NoteRangee>("notes", id);
  if (!rangee) return undefined;
  const blocs = await Promise.all(rangee.blocs.map((b) => lireUn<BlocRange>("blocs", b.id)));
  // Un bloc manquant (écriture interrompue) rend la note incomplète : mieux
  // vaut dire qu'elle n'est pas là que montrer une note amputée.
  if (blocs.some((b) => !b)) return undefined;
  return { ...rangee, blocs: rangee.blocs.map((b, i) => ({ ...b, content: blocs[i]!.content })) };
}

/**
 * Range des notes entières et en retire d'autres, en une transaction : une
 * note ne doit jamais rester avec la liste de blocs de sa nouvelle version et
 * le contenu de l'ancienne.
 */
export async function ecrireNotes(notes: NoteHorsLigne[], effacees: string[] = []) {
  const touchees = [...notes.map((n) => n.id), ...effacees];
  for (const n of notes) {
    memoire.notes.set(n.id, { ...n, blocs: n.blocs.map(({ id, kind }) => ({ id, kind })) });
    for (const b of n.blocs) memoire.blocs.set(b.id, { noteId: n.id, kind: b.kind, content: b.content });
  }
  for (const id of effacees) memoire.notes.delete(id);
  await transaction<true>(
    ["notes", "blocs"],
    "readwrite",
    (st, tenir) => {
      for (const id of touchees) {
        const lecture = st.notes.get(id);
        lecture.onsuccess = () => {
          const ancienne = lecture.result as NoteRangee | undefined;
          const neuve = notes.find((n) => n.id === id);
          const gardes = new Set(neuve?.blocs.map((b) => b.id) ?? []);
          for (const b of ancienne?.blocs ?? []) if (!gardes.has(b.id)) st.blocs.delete(b.id);
          if (!neuve) {
            st.notes.delete(id);
            return;
          }
          for (const b of neuve.blocs) st.blocs.put({ noteId: id, kind: b.kind, content: b.content }, b.id);
          st.notes.put({ ...neuve, blocs: neuve.blocs.map(({ id: bid, kind }) => ({ id: bid, kind })) }, id);
        };
      }
      tenir(true);
    },
    () => true,
  );
}

/**
 * Le serveur vient de confirmer le contenu d'un bloc : la copie gardée le
 * prend, si ce bloc est gardé. Seulement **après** confirmation — une copie
 * qui porterait un brouillon non envoyé le ferait passer, à la réouverture,
 * pour déjà enregistré, et il serait effacé sans être parti.
 */
export async function blocConfirme(blockId: string, content: string) {
  const enMemoire = memoire.blocs.get(blockId) as BlocRange | undefined;
  if (enMemoire) memoire.blocs.set(blockId, { ...enMemoire, content });
  await transaction<true>(
    ["blocs"],
    "readwrite",
    (st, tenir) => {
      const lecture = st.blocs.get(blockId);
      lecture.onsuccess = () => {
        const bloc = lecture.result as BlocRange | undefined;
        if (bloc) st.blocs.put({ ...bloc, content }, blockId);
      };
      tenir(true);
    },
    () => true,
  );
}

// --- Envois ------------------------------------------------------------------

export const lireEnvois = () => toutLire<Envoi>("envois");

/**
 * Pose un envoi et, dans la **même** transaction, la carte qu'il modifie : une
 * réponse enregistrée sans son effet local ferait réapparaître la carte dans
 * la pile au prochain rechargement hors ligne.
 */
export async function noterEnvoi(envoi: Envoi, paquetModifie?: PaquetHorsLigne) {
  memoire.envois.set(envoi.id, envoi);
  if (paquetModifie) memoire.paquets.set(paquetModifie.id, paquetModifie);
  await transaction<true>(
    paquetModifie ? ["envois", "paquets"] : ["envois"],
    "readwrite",
    (s, tenir) => {
      s.envois.put(envoi, envoi.id);
      if (paquetModifie) s.paquets.put(paquetModifie, paquetModifie.id);
      tenir(true);
    },
    () => true,
  );
}

export const oublierEnvois = (ids: string[]) => ecrire("envois", [], ids);

// --- Méta --------------------------------------------------------------------

export type Meta = {
  userId: string | null;
  dossiers: DossierHorsLigne[];
  derniereSynchro: number | null;
};

export async function lireMeta(): Promise<Meta> {
  const [userId, dossiers, derniereSynchro] = await Promise.all([
    lireUn<string>("meta", "userId"),
    lireUn<DossierHorsLigne[]>("meta", "dossiers"),
    lireUn<number>("meta", "derniereSynchro"),
  ]);
  return { userId: userId ?? null, dossiers: dossiers ?? [], derniereSynchro: derniereSynchro ?? null };
}

export const ecrireMeta = (meta: Partial<Meta>) =>
  ecrire(
    "meta",
    Object.entries(meta).filter(([, v]) => v !== undefined),
  );

/**
 * Oublie le contenu gardé : épingles, paquets, notes, arbre des dossiers.
 *
 * Les **envois**, eux, restent : ce sont des réponses que la personne a
 * données et que le serveur n'a pas encore vues. Les jeter à la déconnexion
 * perdrait une révision faite dans le train ; elles repartiront à la
 * prochaine connexion du même compte.
 */
export async function oublierContenu() {
  for (const m of ["epingles", "paquets", "notes", "blocs", "meta"] as const) memoire[m].clear();
  await transaction<true>(
    ["epingles", "paquets", "notes", "blocs", "meta"],
    "readwrite",
    (s, tenir) => {
      s.epingles.clear();
      s.paquets.clear();
      s.notes.clear();
      s.blocs.clear();
      s.meta.clear();
      tenir(true);
    },
    () => true,
  );
}

/** Demande au navigateur de ne pas évincer ce qu'on a choisi de garder. */
export function ancrerLeStockage() {
  try {
    void navigator.storage?.persist?.();
  } catch {
    // Évinçable, mais utilisable.
  }
}
